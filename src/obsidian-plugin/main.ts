import { Plugin, Notice, PluginSettingTab, Setting, Modal, App } from 'obsidian';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';
import { LearningStateManager, StateFileOps } from '../core/learning-state-manager.js';
import { FSRSScheduler } from '../core/fsrs-scheduler.js';
import { SemanticAutoLinker } from '../core/semantic-auto-linker.js';
import { LearningPathTreeGenerator, NoteStyle, AIGenerationResult } from '../core/path-tree-generator.js';
import { LLMClient, LLMConfig, DEFAULT_LLM_CONFIG } from '../core/llm-client.js';
import { ApiKeyResolver, ApiKeySource, ApiKeySourceOptions } from '../core/api-key-resolver.js';

// ── Plugin Settings ──────────────────────────────────────────────

interface LongrnPluginSettings {
	/** 语义模糊匹配的相似度阈值（0-1），越高越严格 */
	semanticThreshold: number;
	/** 快速复习时随机选取的已掌握节点数量 */
	quickReviewCount: number;
	/** 每日待复习笔记的生成上限 */
	dueReviewLimit: number;
	/** 学习路径笔记的输出目录（相对于 Vault 根目录） */
	outputFolder: string;
	// ── Phase 4 配置 ──
	/** 路径树生成深度（1-3） */
	maxGenerationDepth: number;
	/** 每层节点数（3-10） */
	nodesPerLayer: number;
	/** 笔记生成风格 */
	generationStyle: NoteStyle;
	// ── Phase 5 配置 ──
	/** AI 生成开关 */
	aiEnabled: boolean;
	/** OpenAI 兼容 API 端点 */
	apiEndpoint: string;
	/** API Key */
	apiKey: string;
	/** 模型名称 */
	model: string;
	/** 生成温度 */
	temperature: number;
	// ── Phase 5.1 配置 ──
	/** API Key 来源 */
	apiKeySource: ApiKeySource;
	/** localStorage 中的 Key 名称（apiKeySource=obsidian-localstorage 时使用） */
	apiKeyLocalStorageName: string;
	/** Vault 内 JSON 文件路径（apiKeySource=vault-file 时使用） */
	apiKeyVaultFilePath: string;
	/** JSON 文件中的 Key 路径表达式（apiKeySource=vault-file 时使用） */
	apiKeyVaultJsonPath: string;
}

const DEFAULT_SETTINGS: LongrnPluginSettings = {
	semanticThreshold: 0.75,
	quickReviewCount: 5,
	dueReviewLimit: 10,
	outputFolder: 'learning-path',
	maxGenerationDepth: 2,
	nodesPerLayer: 5,
	generationStyle: 'map',
	aiEnabled: false,
	apiEndpoint: DEFAULT_LLM_CONFIG.apiEndpoint,
	apiKey: DEFAULT_LLM_CONFIG.apiKey,
	model: DEFAULT_LLM_CONFIG.model,
	temperature: DEFAULT_LLM_CONFIG.temperature,
	apiKeySource: 'manual',
	apiKeyLocalStorageName: 'deepseekApiKey',
	apiKeyVaultFilePath: '.obsidian/longrn-providers.json',
	apiKeyVaultJsonPath: 'deepseek.apiKey',
};

// ── User Input Modal ─────────────────────────────────────────────

/**
 * Generic text-input modal used to collect the target topic or
 * semantic query from the user before generating a learning path.
 */
class TargetInputModal extends Modal {
	private resolve: (value: string) => void;

	constructor(
		app: App,
		private title: string,
		private placeholder: string,
		private defaultValue: string,
	) {
		super(app);
		this.resolve = () => {};
	}

	/** Returns a Promise that resolves with the user's input (or empty string on cancel). */
	openAndAwait(): Promise<string> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);
		contentEl.createEl('p', {
			text: '请输入要学习的主题或目标概念：',
			cls: 'longrn-modal-desc',
		});

		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.placeholder,
			value: this.defaultValue,
			cls: 'longrn-modal-input',
		});
		input.style.width = '100%';
		input.style.padding = '8px';
		input.style.marginBottom = '12px';
		input.style.fontSize = '14px';

		// Submit on Enter
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.resolve(input.value.trim());
				this.close();
			}
		});

		// Focus after render
		setTimeout(() => input.focus(), 50);

		// Button row
		const btnRow = contentEl.createDiv({ cls: 'longrn-modal-buttons' });
		btnRow.style.display = 'flex';
		btnRow.style.justifyContent = 'flex-end';
		btnRow.style.gap = '8px';

		const cancelBtn = btnRow.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => {
			this.resolve('');
			this.close();
		});

		const submitBtn = btnRow.createEl('button', {
			text: '确定',
			cls: 'mod-cta',
		});
		submitBtn.addEventListener('click', () => {
			this.resolve(input.value.trim());
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Longrn — Obsidian plugin entry point.
 *
 * Registers six commands across three phases:
 * - **Phase 1**: `generate-learning-path` (BFS/DFS path planning)
 * - **Phase 2**: `generate-semantic-path` (embedding-based path planning)
 * - **Phase 3**: `generate-state-aware-path`, `show-review-list`,
 *   `generate-review-note` (learning state + FSRS review scheduling)
 *
 * Also adds a **Setting tab** that documents the plugin's features,
 * learning state model, and usage instructions.
 */
export default class LearningPathPlugin extends Plugin {
	settings!: LongrnPluginSettings;

	/** Get vault base path (DataAdapter.basePath is not in public types) */
	private get vaultBasePath(): string {
		return (this.app.vault.adapter as any).basePath;
	}

	kbBuilder!: KnowledgeBaseBuilder;
	pathPlanner!: PathPlanner;
	noteGenerator!: NoteGenerator;
	stateManager!: LearningStateManager;
	fsrsScheduler!: FSRSScheduler;
	semanticLinker!: SemanticAutoLinker;
	pathTreeGenerator!: LearningPathTreeGenerator;
	llmClient!: LLMClient;

	/**
	 * Create a StateFileOps that uses Obsidian's vault adapter.
	 * This ensures state.json is read/written through Obsidian's vault,
	 * which works correctly with iCloud and triggers proper vault refresh.
	 */
	private get vaultStateFileOps(): StateFileOps {
		const vaultPath = this.vaultBasePath;
		return {
			exists: async (fp: string) => {
				const relPath = fp.startsWith(vaultPath) ? fp.slice(vaultPath.length + 1) : fp;
				return this.app.vault.adapter.exists(relPath);
			},
			mkdir: async (fp: string) => {
				const relPath = fp.startsWith(vaultPath) ? fp.slice(vaultPath.length + 1) : fp;
				if (!(await this.app.vault.adapter.exists(relPath))) {
					await this.app.vault.createFolder(relPath);
				}
			},
			readFile: async (fp: string) => {
				const relPath = fp.startsWith(vaultPath) ? fp.slice(vaultPath.length + 1) : fp;
				return this.app.vault.adapter.read(relPath);
			},
			writeFile: async (fp: string, data: string) => {
				const relPath = fp.startsWith(vaultPath) ? fp.slice(vaultPath.length + 1) : fp;
				await this.app.vault.adapter.write(relPath, data);
			},
		};
	}

	async onload() {
		console.log('Loading Learning Path Plugin (Phase 3.1)');

		await this.loadSettings();

		this.kbBuilder = new KnowledgeBaseBuilder();
		this.pathPlanner = new PathPlanner();
		this.noteGenerator = new NoteGenerator();
		this.fsrsScheduler = new FSRSScheduler();
		this.semanticLinker = new SemanticAutoLinker();
		this.pathTreeGenerator = new LearningPathTreeGenerator();
		this.llmClient = new LLMClient();

		// Initialize state manager after vault is available
		this.app.workspace.onLayoutReady(() => {
			const vaultPath = this.vaultBasePath;
			const fileOps = this.vaultStateFileOps;
			this.stateManager = new LearningStateManager(vaultPath, fileOps);
			console.log('Longrn: state manager initialized');
		});

    // Phase 1
    this.addCommand({
      id: 'generate-learning-path',
      name: '生成学习路径',
      callback: () => void this.generateLearningPath(),
    });

    // Phase 2
    this.addCommand({
      id: 'generate-semantic-path',
      name: '语义生成学习路径',
      callback: () => void this.generateSemanticPath(),
    });

    // Phase 3
    this.addCommand({
      id: 'generate-state-aware-path',
      name: '状态感知学习路径（排除已掌握节点）',
      callback: () => void this.generateStateAwarePath(),
    });

    this.addCommand({
      id: 'show-review-list',
      name: '查看今日待复习列表',
      callback: () => void this.showReviewList(),
    });

    this.addCommand({
      id: 'generate-review-note',
      name: '生成复习笔记',
      callback: () => void this.generateReviewNote(),
    });

    // Phase 4
    this.addCommand({
      id: 'generate-learning-path-tree',
      name: '生成学习路径（不依赖笔记·主题输入）',
      callback: () => void this.generateLearningPathTree(),
    });

    // Phase 5
    this.addCommand({
      id: 'generate-ai-learning-path',
      name: 'AI 生成学习路径（通用 OpenAI 协议）',
      callback: () => void this.generateAILearningPath(),
    });

    // 注册设置页面（插件介绍与使用说明）
    this.addSettingTab(new LongrnSettingTab(this.app, this));
  }

  async buildKnowledgeBase(): Promise<Map<string, Note>> {
    const files = this.app.vault.getMarkdownFiles();
    const notes: Note[] = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const parsed = this.kbBuilder.parseNote(content, file.basename);
      notes.push({
        id: file.path,
        title: parsed.title || file.basename,
        path: file.path,
        content,
        tags: parsed.tags,
        links: parsed.links
      });
    }

    const kb = new Map<string, Note>();
    notes.forEach(note => kb.set(note.title, note));
    return kb;
  }

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Ensures stateManager is initialized (lazy-init if layout hasn't fired yet). */
	private ensureStateManager(): LearningStateManager {
		if (!this.stateManager) {
			const fileOps = this.vaultStateFileOps;
			this.stateManager = new LearningStateManager(this.vaultBasePath, fileOps);
		}
		return this.stateManager;
	}

	/**
	 * Generate notes using Obsidian vault API instead of Node.js `fs`.
	 * This ensures files are properly tracked by Obsidian and work with iCloud.
	 */
	private async generateNotesWithVault(pathSteps: Note[]): Promise<void> {
		const outputFolder = this.settings.outputFolder;

		// Ensure output folder exists via vault API
		const folderExists = await this.app.vault.adapter.exists(outputFolder);
		if (!folderExists) {
			await this.app.vault.createFolder(outputFolder);
		}

		for (let i = 0; i < pathSteps.length; i++) {
			const step = pathSteps[i];
			let content = this.noteGenerator.generateNote(step);
			content = this.noteGenerator.autoLink(content, new Map(pathSteps.map(n => [n.title, n])));

			const safeName = step.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-');
			const fileName = `${outputFolder}/${i + 1}-${safeName}.md`;

			await this.app.vault.create(fileName, content);
		}
	}

	// ===== Phase 1: Learning Path =====

	async generateLearningPath() {
		const modal = new TargetInputModal(
			this.app,
			'生成学习路径',
			'例如: Python数据分析, 机器学习, TypeScript进阶',
			'',
		);
		const target = await modal.openAndAwait();
		if (!target) {
			new Notice('已取消');
			return;
		}

		new Notice(`开始为「${target}」生成学习路径...`);

		try {
			const notes = Array.from((await this.buildKnowledgeBase()).values());
			const graph = this.kbBuilder.buildGraph(notes);

			let paths = this.pathPlanner.planPath(target, graph);

			// Fallback: fuzzy matching if exact title not found
			if (paths.length === 0 || paths[0].steps.length === 0) {
				const fuzzyTarget = Array.from(graph.nodes.values())
					.find(n => n.title.toLowerCase().includes(target.toLowerCase())
						|| target.toLowerCase().includes(n.title.toLowerCase()));
				if (fuzzyTarget) {
					paths = this.pathPlanner.planPath(fuzzyTarget.title, graph);
				}
			}

			if (paths.length === 0 || paths[0].steps.length === 0) {
				new Notice(`未找到通往「${target}」的学习路径。请检查知识库标题，或尝试更精确的关键词。`);
				return;
			}

			const selectedPath = paths[0];
			await this.generateNotesWithVault(selectedPath.steps);

			new Notice(`「${target}」学习路径笔记生成完成！（${selectedPath.steps.length} 篇笔记）`);
		} catch (error: any) {
			console.error('Longrn [generateLearningPath]:', error);
			new Notice(`生成失败: ${error.message}`);
		}
	}

	// ===== Phase 2: Semantic Path =====

	async generateSemanticPath() {
		const modal = new TargetInputModal(
			this.app,
			'语义生成学习路径',
			'用自然语言描述你想学什么，例如: 如何用Python做数据分析, 机器学习入门',
			'',
		);
		const query = await modal.openAndAwait();
		if (!query) {
			new Notice('已取消');
			return;
		}

		new Notice(`正在为「${query}」生成语义学习路径...`);

		try {
			const notes = Array.from((await this.buildKnowledgeBase()).values());

			new Notice('正在生成语义索引（首次较慢，约需下载模型）...');
			const vaultPath = this.vaultBasePath;
			await this.kbBuilder.embedAll(notes, vaultPath, this.vaultStateFileOps);
			new Notice(`语义索引完成！共 ${notes.length} 条笔记`);

			const graph = this.kbBuilder.buildGraph(notes);

			const engine = this.kbBuilder.getEmbeddingEngine();
			if (!engine) throw new Error('Embedding engine not ready');

			new Notice('正在搜索最相关概念并生成路径...');
			const semanticPath = await this.pathPlanner.semanticPath(
				query,
				graph,
				engine,
			);

			await this.generateNotesWithVault(semanticPath.steps);

			const stepsPreview = semanticPath.steps
				.map((s, i) => `${i + 1}. ${s.title} (${(semanticPath.scores?.[i] ?? 0).toFixed(3)})`)
				.join(', ');
			new Notice(`语义路径生成完成！\n${stepsPreview}`);
		} catch (error: any) {
			console.error('Longrn [generateSemanticPath]:', error);
			new Notice(`语义路径生成失败: ${error.message}`);
		}
	}

	// ===== Phase 3: State-Aware Path =====

	async generateStateAwarePath() {
		const modal = new TargetInputModal(
			this.app,
			'状态感知学习路径',
			'例如: Python数据分析, 深度学习, 系统设计',
			'',
		);
		const target = await modal.openAndAwait();
		if (!target) {
			new Notice('已取消');
			return;
		}

		new Notice(`开始分析知识库（状态感知模式），目标：「${target}」...`);

		try {
			const stateManager = this.ensureStateManager();
			const notes = Array.from((await this.buildKnowledgeBase()).values());
			const graph = this.kbBuilder.buildGraph(notes);

			const masteredSize = stateManager.getMasteredIds().size;
			new Notice(`已掌握 ${masteredSize} 个节点，将在路径中跳过`);

			let paths = this.pathPlanner.planPathWithState(target, graph, stateManager);

			// Fallback: fuzzy matching
			if (paths.length === 0 || paths[0].steps.length === 0) {
				const fuzzyTarget = Array.from(graph.nodes.values())
					.find(n => n.title.toLowerCase().includes(target.toLowerCase())
						|| target.toLowerCase().includes(n.title.toLowerCase()));
				if (fuzzyTarget) {
					paths = this.pathPlanner.planPathWithState(fuzzyTarget.title, graph, stateManager);
				}
			}

			if (paths.length === 0 || paths[0].steps.length === 0) {
				new Notice('未找到学习路径。所有相关节点可能都已掌握，或目标标题不匹配。');
				return;
			}

			const selectedPath = paths[0];
			await this.generateNotesWithVault(selectedPath.steps);

			// Auto-mark generated notes as "planned"
			for (const step of selectedPath.steps) {
				await stateManager.setStatus(step.id, 'planned');
			}

			const stepInfo = selectedPath.steps
				.map((s, i) => `${i + 1}. ${s.title} [${selectedPath.states?.[i] ?? 'unknown'}]`)
				.join(' | ');
			new Notice(`状态感知路径生成完成！\n${stepInfo}`);
		} catch (error: any) {
			console.error('Longrn [generateStateAwarePath]:', error);
			new Notice(`状态感知路径生成失败: ${error.message}`);
		}
	}

	async showReviewList() {
		try {
			const stateManager = this.ensureStateManager();

			const dueIds = stateManager.getDueIds();
			const stats = stateManager.getReviewStats();

			if (dueIds.length === 0) {
				new Notice(
					`📊 学习统计\n` +
					`已掌握: ${stats.mastered} | 学习中: ${stats.inProgress} | ` +
					`已计划: ${stats.planned} | 待归档: ${stats.archived}\n` +
					`🎉 今日无待复习内容！`,
				);
				return;
			}

			new Notice(
				`📊 学习统计\n` +
				`已掌握: ${stats.mastered} | 学习中: ${stats.inProgress}\n` +
				`今日待复习: ${dueIds.length} 项`,
			);
		} catch (error: any) {
			console.error('Longrn [showReviewList]:', error);
			new Notice(`获取复习列表失败: ${error.message}`);
		}
	}

	async generateReviewNote() {
		new Notice('准备复习笔记...');

		try {
			const stateManager = this.ensureStateManager();

			const dueIds = stateManager.getDueIds();
			const notes = Array.from((await this.buildKnowledgeBase()).values());
			const reviewLines: string[] = [`# 🔄 ${dueIds.length > 0 ? '今日' : '快速'}复习\n`];

			let reviewIds: string[];

			if (dueIds.length === 0) {
				// Quick review: pick some random mastered nodes
				const masteredIds = [...stateManager.getMasteredIds()];
				if (masteredIds.length === 0) {
					new Notice('没有已掌握或待复习的知识点。请先生成学习路径。');
					return;
				}
				const count = Math.min(this.settings.quickReviewCount, masteredIds.length);
				const shuffled = masteredIds.sort(() => Math.random() - 0.5);
				reviewIds = shuffled.slice(0, count);
			} else {
				reviewIds = dueIds.slice(0, this.settings.dueReviewLimit);
			}

			for (const id of reviewIds) {
				const note = notes.find(n => n.id === id);
				if (!note) continue;
				reviewLines.push(this.fsrsScheduler.generateReviewTemplate(note.title, note.content, note.tags));
			}

			const fileName = `review-${new Date().toISOString().slice(0, 10)}.md`;
			const filePath = `${this.settings.outputFolder}/${fileName}`;

			// Ensure output folder exists via vault API
			const folderExists = await this.app.vault.adapter.exists(this.settings.outputFolder);
			if (!folderExists) {
				await this.app.vault.createFolder(this.settings.outputFolder);
			}

			await this.app.vault.create(filePath, reviewLines.join('\n---\n'));
			new Notice(`复习笔记已创建（${reviewIds.length} 项）: ${filePath}`);
		} catch (error: any) {
			console.error('Longrn [generateReviewNote]:', error);
			new Notice(`生成复习笔记失败: ${error.message}`);
		}
	}

	/** 从插件设置构造 LLMConfig（异步解析 API Key） */
	private async getLLMConfig(): Promise<LLMConfig> {
		const resolver = new ApiKeyResolver();
		const resolvedKey = await resolver.resolve(
			this.settings.apiKeySource,
			{
				localStorageKeyName: this.settings.apiKeyLocalStorageName,
				vaultFilePath: this.settings.apiKeyVaultFilePath,
				vaultJsonPath: this.settings.apiKeyVaultJsonPath,
				manualKey: this.settings.apiKey,
				vaultAdapter: (this.app.vault.adapter as any),
			}
		);
		return {
			apiEndpoint: this.settings.apiEndpoint,
			apiKey: resolvedKey || '',
			model: this.settings.model,
			temperature: this.settings.temperature,
			enabled: this.settings.aiEnabled,
		};
	}

	// ===== Phase 4: Learning Path Tree =====

	async generateLearningPathTree() {
		const modal = new TargetInputModal(
			this.app,
			'生成学习路径（不依赖笔记）',
			'输入你想学的内容，例如: TypeScript, 机器学习, Python数据分析',
			'',
		);
		const topic = await modal.openAndAwait();
		if (!topic) {
			new Notice('已取消');
			return;
		}

		new Notice(`正在为「${topic}」生成学习路径树...`);

		try {
			const tree = this.pathTreeGenerator.generatePathTree(
				topic,
				this.settings.maxGenerationDepth,
				this.settings.nodesPerLayer,
			);

			new Notice(`路径树生成完毕（${tree.nodes.length} 个阶段），正在渲染笔记...`);

			// 渲染为 Markdown 笔记
			let notes = this.pathTreeGenerator.renderTreeToMarkdown(tree, this.settings.generationStyle);

			// 交叉链接
			notes = this.pathTreeGenerator.crossLinkGeneratedNotes(notes);

			// 去重检查 + 写入 vault
			const existingFiles = this.app.vault.getMarkdownFiles().map(f => f.path);
			let createdCount = 0;

			for (const [fileName, content] of notes) {
				const dedupedName = this.pathTreeGenerator.deduplicateFileName(fileName, existingFiles);

				// 确保输出目录存在
				const folderExists = await this.app.vault.adapter.exists(this.settings.outputFolder);
				if (!folderExists) {
					await this.app.vault.createFolder(this.settings.outputFolder);
				}

				const filePath = `${this.settings.outputFolder}/${dedupedName}`;
				await this.app.vault.create(filePath, content);
				createdCount++;
			}

			new Notice(`🎉 已生成 ${createdCount} 篇 ${topic} 学习路径笔记！`);
		} catch (error: any) {
			console.error('Longrn [generateLearningPathTree]:', error);
			new Notice(`生成失败: ${error.message}`);
		}
	}

	// ===== Phase 5: AI-Powered Learning Path =====

	async generateAILearningPath() {
		const llmConfig = await this.getLLMConfig();
		if (!llmConfig.enabled) {
			new Notice('⚠️ AI 生成未开启。请先在设置 → Longrn → AI 配置中启用并填写 API 信息。');
			return;
		}
		if (!llmConfig.apiKey) {
			new Notice('无法获取 API Key，请检查设置 → Longrn → API Key 来源配置');
			return;
		}

		const modal = new TargetInputModal(
			this.app,
			'生成 AI 学习路径',
			'输入你想学的内容，例如: TypeScript, 机器学习, Python数据分析',
			'',
		);
		const topic = await modal.openAndAwait();
		if (!topic) {
			new Notice('已取消');
			return;
		}

		new Notice(`🤖 正在调用 LLM 为「${topic}」生成路径树...`);

		try {
			const result = await this.pathTreeGenerator.generateAIPathTree(
				topic,
				this.llmClient,
				llmConfig,
				this.settings.maxGenerationDepth,
				this.settings.nodesPerLayer,
				this.settings.generationStyle,
			);

			// 渲染笔记（result 中 tree 可能已被 AI 替换）
			let notes = this.pathTreeGenerator.renderTreeToMarkdown(result.tree, this.settings.generationStyle);

			// 替换 AI 生成的内容
			for (const fileName of result.aiGeneratedNotes) {
				// AI 内容已在 generateAIPathTree 中写入 notes — 但为安全起见重新获取
			}

			// 交叉链接
			notes = this.pathTreeGenerator.crossLinkGeneratedNotes(notes);

			// 写入 vault
			const existingFiles = this.app.vault.getMarkdownFiles().map(f => f.path);
			let createdCount = 0;

			for (const [fileName, content] of notes) {
				const dedupedName = this.pathTreeGenerator.deduplicateFileName(fileName, existingFiles);
				const folderExists = await this.app.vault.adapter.exists(this.settings.outputFolder);
				if (!folderExists) {
					await this.app.vault.createFolder(this.settings.outputFolder);
				}
				await this.app.vault.create(`${this.settings.outputFolder}/${dedupedName}`, content);
				createdCount++;
			}

			// 汇总
			const aiCount = result.aiGeneratedNotes.length;
			const tmplCount = result.templatedNotes.length;
			const totalTokens = ''; // TODO: track from LLM response

			new Notice(
				`🤖 AI 学习路径生成完毕！\n` +
				`📝 共 ${createdCount} 篇笔记\n` +
				`🤖 AI 内容: ${aiCount} 篇 | 📋 模板: ${tmplCount} 篇`
			);
		} catch (error: any) {
			console.error('Longrn [generateAILearningPath]:', error);
			new Notice(`AI 生成失败: ${error.message}`);
		}
	}

	onunload() {
		console.log('Unloading Longrn Learning Path Plugin');
	}
}

/**
 * Longrn 插件设置页面
 *
 * Phase 3.1: 提供可交互的设置选项 + 功能说明。
 */
class LongrnSettingTab extends PluginSettingTab {
	plugin: LearningPathPlugin;

	constructor(app: App, plugin: LearningPathPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── 标题 ──
		containerEl.createEl('h1', { text: '🧠 Longrn 学习路径系统' });

		// ===== Phase 3.1: 可配置设置 =====
		containerEl.createEl('h2', { text: '⚙️ 参数设置' });

		new Setting(containerEl)
			.setName('语义相似度阈值')
			.setDesc('语义模糊匹配的最低相似度要求（0-1），值越高匹配越精确。默认为 0.75。')
			.addSlider((slider) => {
				slider
					.setLimits(0.5, 0.95, 0.05)
					.setValue(this.plugin.settings.semanticThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.semanticThreshold = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('快速复习数量')
			.setDesc('没有到期待复习内容时，随机选取已掌握的知识点进行快速复习的数量。')
			.addSlider((slider) => {
				slider
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.quickReviewCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.quickReviewCount = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('每日复习上限')
			.setDesc('每次生成复习笔记时最多包含多少个待复习知识点。')
			.addSlider((slider) => {
				slider
					.setLimits(3, 50, 1)
					.setValue(this.plugin.settings.dueReviewLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dueReviewLimit = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('笔记输出目录')
			.setDesc('学习路径笔记和复习笔记的存放目录（相对于 Vault 根目录）。')
			.addText((text) => {
				text
					.setPlaceholder('learning-path')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim() || 'learning-path';
						await this.plugin.saveSettings();
					});
			});

		// ===== Phase 4: 路径树生成配置 =====
		containerEl.createEl('h2', { text: '🌳 学习路径树生成（Phase 4）' });

		new Setting(containerEl)
			.setName('生成递归深度')
			.setDesc('路径树的递归层数。1 = 仅生成主路径概览，2 = 生成主路径+子笔记，3 = 再展开一层。')
			.addSlider((slider) => {
				slider
					.setLimits(1, 3, 1)
					.setValue(this.plugin.settings.maxGenerationDepth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxGenerationDepth = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('每层节点数量')
			.setDesc('每个阶段的子知识点数量（3-10）。数量越多笔记越详细。')
			.addSlider((slider) => {
				slider
					.setLimits(3, 10, 1)
					.setValue(this.plugin.settings.nodesPerLayer)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.nodesPerLayer = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('笔记生成风格')
			.setDesc('选择生成笔记的模板风格。')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('map', '知识导图')
					.addOption('tutorial', '教程风格')
					.addOption('cheatsheet', '速查表')
					.setValue(this.plugin.settings.generationStyle)
					.onChange(async (value) => {
						this.plugin.settings.generationStyle = value as 'map' | 'tutorial' | 'cheatsheet';
						await this.plugin.saveSettings();
					});
			});

		// ===== Phase 5: AI 内容生成（通用 OpenAI 协议） =====
		containerEl.createEl('h2', { text: '🤖 AI 内容生成（Phase 5）' });

		containerEl.createEl('p', {
			text: '支持所有兼容 OpenAI Chat Completions API 的大模型服务，包括但不限于：' +
				'OpenAI、Ollama（本地）、vLLM、DeepSeek、Qwen（通义千问）、' +
				'Claude（通过 API 代理）、Azure OpenAI、Groq、Together AI 等。',
		});

		new Setting(containerEl)
			.setName('启用 AI 生成')
			.setDesc('开启后使用大模型生成真实的笔记内容（需配置下方 API 信息）。关闭时使用模板生成。')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.aiEnabled)
					.onChange(async (value) => {
						this.plugin.settings.aiEnabled = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('API 端点')
			.setDesc('通用 OpenAI 协议 API 地址。填写你使用的服务商提供的 endpoint，必须以 /v1 结尾。常见示例：')
			.addText((text) => {
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.plugin.settings.apiEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.apiEndpoint = value || DEFAULT_LLM_CONFIG.apiEndpoint;
						await this.plugin.saveSettings();
					});
			});

		// 常见端点参考
		const endpointHelp = containerEl.createEl('details');
		endpointHelp.createEl('summary', { text: '📋 常见 API 端点参考' });
		const epTable = endpointHelp.createEl('table');
		epTable.createEl('thead').createEl('tr', {}, (tr) => {
			tr.createEl('th', { text: '服务商' });
			tr.createEl('th', { text: 'API 端点' });
		});
		const epTbody = epTable.createEl('tbody');
		const endpoints = [
			{ service: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
			{ service: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1' },
			{ service: 'Qwen（通义千问）', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
			{ service: 'Groq', endpoint: 'https://api.groq.com/openai/v1' },
			{ service: 'Together AI', endpoint: 'https://api.together.xyz/v1' },
			{ service: 'Ollama（本地）', endpoint: 'http://localhost:11434/v1' },
			{ service: 'vLLM（自部署）', endpoint: 'http://localhost:8000/v1' },
		];
		for (const ep of endpoints) {
			epTbody.createEl('tr', {}, (tr) => {
				tr.createEl('td', { text: ep.service });
				tr.createEl('td', { text: ep.endpoint });
			});
		}

		// API Key 来源选择
		new Setting(containerEl)
			.setName('API Key 来源')
			.setDesc('选择从哪里获取 API Key')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('manual', '手动输入')
					.addOption('obsidian-localstorage', 'Obsidian localStorage')
					.addOption('vault-file', 'Vault 文件')
					.setValue(this.plugin.settings.apiKeySource)
					.onChange(async (value) => {
						this.plugin.settings.apiKeySource = value as ApiKeySource;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (this.plugin.settings.apiKeySource === 'obsidian-localstorage') {
			new Setting(containerEl)
				.setName('localStorage Key 名称')
				.setDesc('在 Obsidian localStorage 中存储 API Key 的键名')
				.addText((text) => {
					text.setPlaceholder('deepseekApiKey')
						.setValue(this.plugin.settings.apiKeyLocalStorageName)
						.onChange(async (value) => {
							this.plugin.settings.apiKeyLocalStorageName = value;
							await this.plugin.saveSettings();
						});
				});
		}

		if (this.plugin.settings.apiKeySource === 'vault-file') {
			new Setting(containerEl)
				.setName('Vault 文件路径')
				.setDesc('相对于 Vault 根目录的 JSON 文件路径')
				.addText((text) => {
					text.setPlaceholder('.obsidian/longrn-providers.json')
						.setValue(this.plugin.settings.apiKeyVaultFilePath)
						.onChange(async (value) => {
							this.plugin.settings.apiKeyVaultFilePath = value;
							await this.plugin.saveSettings();
						});
				});
			new Setting(containerEl)
				.setName('JSON Key 路径')
				.setDesc('用点号分隔的 JSON 路径')
				.addText((text) => {
					text.setPlaceholder('deepseek.apiKey')
						.setValue(this.plugin.settings.apiKeyVaultJsonPath)
						.onChange(async (value) => {
							this.plugin.settings.apiKeyVaultJsonPath = value;
							await this.plugin.saveSettings();
						});
				});
		}

		if (this.plugin.settings.apiKeySource === 'manual') {
			new Setting(containerEl)
				.setName('API Key')
				.setDesc('你的 API Key。仅保存在本地。')
				.addText((text) => {
					text.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.apiKey)
						.onChange(async (value) => {
							this.plugin.settings.apiKey = value;
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl)
			.setName('模型')
			.setDesc('模型名称，取决于你使用的服务商。示例：gpt-4o-mini、deepseek-chat、qwen-turbo、llama3.1（Ollama）等')
			.addText((text) => {
				text
					.setPlaceholder('gpt-4o-mini')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value || DEFAULT_LLM_CONFIG.model;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('温度')
			.setDesc('生成温度（0-2），越高生成的文本越有创造性。默认为 0.7。')
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					});
			});

		// ── 插件简介 ──
		containerEl.createEl('h2', { text: '📖 关于本插件' });
		containerEl.createEl('p', {
			text: 'Longrn 是一个面向终生学习者的智能学习路径系统。它自动扫描你的知识库笔记，' +
				'基于知识图谱和语义分析生成个性化的学习路径，并利用 FSRS 间隔重复算法科学安排复习计划。',
		});
		containerEl.createEl('p', {
			text: '版本: ' + this.plugin.manifest.version,
		});

		// ── 功能列表 ──
		containerEl.createEl('h2', { text: '⚡ 功能命令' });
		const commands = [
			{
				name: '生成学习路径',
				desc: '输入目标主题，扫描 Vault 笔记生成 BFS/DFS 学习路径并创建笔记。',
			},
			{
				name: '语义生成学习路径',
				desc: '用自然语言描述学习目标，AI 语义分析后生成更智能的路径。首次需下载模型（~80MB）。',
			},
			{
				name: '状态感知学习路径',
				desc: '输入目标主题，自动跳过已掌握的知识节点，提供个性化路径。',
			},
			{
				name: '查看今日待复习列表',
				desc: '基于 FSRS-5 间隔重复算法，展示今日到期待复习的知识点统计。',
			},
			{
				name: '生成复习笔记',
				desc: '自动生成含回顾内容和评分模板的复习笔记，支持快速复习模式。',
			},
			{
				name: '生成学习路径（不依赖笔记·主题输入）',
				desc: 'Phase 4: 输入主题直接生成完整学习路径笔记树，无需 Vault 中已有笔记。',
			},
			{
				name: 'AI 生成学习路径（通用 OpenAI 协议）',
				desc: 'Phase 5: 使用大模型生成真实的笔记内容，支持所有 OpenAI 兼容协议的大模型服务。',
			},
		];

		for (const cmd of commands) {
			new Setting(containerEl)
				.setName(cmd.name)
				.setDesc(cmd.desc);
		}

		// ── 使用方法 ──
		containerEl.createEl('h2', { text: '📋 使用流程' });
		const ol = containerEl.createEl('ol');
		const steps = [
			'确保你的 Vault 中已有一定数量的学习笔记',
			'通过命令面板 (Cmd/Ctrl+P) 运行「生成学习路径」命令，在弹出的对话框中输入学习目标',
			'插件自动扫描笔记、构建知识图谱、生成目标主题的学习路径',
			'在「设置 → Longrn」中可调整语义相似度阈值、复习数量等参数',
			'学习过程中使用「状态感知学习路径」跳过已掌握的内容',
			'定期使用「查看今日待复习列表」和「生成复习笔记」进行科学复习',
		];
		for (const step of steps) {
			ol.createEl('li', { text: step });
		}

		// ── 学习状态说明 ──
		containerEl.createEl('h2', { text: '📊 学习状态说明' });
		const statuses = [
			{ name: 'unknown（未知）', desc: '初始状态，尚未开始学习' },
			{ name: 'planned（已计划）', desc: '已纳入学习计划' },
			{ name: 'in_progress（进行中）', desc: '正在学习中' },
			{ name: 'mastered（已掌握）', desc: '已完成学习，进入复习周期' },
			{ name: 'archived（已归档）', desc: '已完成全部复习，无需再学' },
		];

		const table = containerEl.createEl('table');
		table.createEl('thead').createEl('tr', {}, (tr) => {
			tr.createEl('th', { text: '状态' });
			tr.createEl('th', { text: '说明' });
		});
		const tbody = table.createEl('tbody');
		for (const s of statuses) {
			tbody.createEl('tr', {}, (tr) => {
				tr.createEl('td', { text: s.name });
				tr.createEl('td', { text: s.desc });
			});
		}

		// ── 注意事项 ──
		containerEl.createEl('h2', { text: '⚠️ 注意事项' });
		const notes = [
			'语义嵌入功能依赖 @xenova/transformers 模型，首次使用需联网下载（约 80MB）',
			'学习状态持久化在 vault 根目录的 .longrn/state.json 文件中',
			'FSRS 复习调度采用 FSRS-5 算法，根据你的评分动态调整复习间隔',
			'如遇到问题，可检查 Obsidian 控制台 (Cmd+Shift+I) 查看日志',
		];
		for (const note of notes) {
			containerEl.createEl('p', { text: '• ' + note });
		}
	}
}
