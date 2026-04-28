import { Plugin, Notice, PluginSettingTab, Setting, Modal, App } from 'obsidian';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';
import { LearningStateManager } from '../core/learning-state-manager.js';
import { FSRSScheduler } from '../core/fsrs-scheduler.js';
import { SemanticAutoLinker } from '../core/semantic-auto-linker.js';

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
}

const DEFAULT_SETTINGS: LongrnPluginSettings = {
	semanticThreshold: 0.75,
	quickReviewCount: 5,
	dueReviewLimit: 10,
	outputFolder: 'learning-path',
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

	async onload() {
		console.log('Loading Learning Path Plugin (Phase 3.1)');

		await this.loadSettings();

		this.kbBuilder = new KnowledgeBaseBuilder();
		this.pathPlanner = new PathPlanner();
		this.noteGenerator = new NoteGenerator();
		this.fsrsScheduler = new FSRSScheduler();
		this.semanticLinker = new SemanticAutoLinker();

		// Initialize state manager after vault is available
		this.app.workspace.onLayoutReady(() => {
			const vaultPath = this.vaultBasePath;
			this.stateManager = new LearningStateManager(vaultPath);
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
			this.stateManager = new LearningStateManager(this.vaultBasePath);
		}
		return this.stateManager;
	}

	async generateLearningPath() {
		// Phase 3.1: Use modal to collect target topic
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

			const paths = this.pathPlanner.planPath(target, graph);

			if (paths.length === 0) {
				new Notice(`未找到通往「${target}」的学习路径，请检查知识库中是否有相关笔记。`);
				return;
			}

			const selectedPath = paths[0];
			const vaultPath = this.vaultBasePath;
			await this.noteGenerator.generateNotes(selectedPath.steps, vaultPath, undefined, this.settings.outputFolder);

			new Notice(`「${target}」学习路径笔记生成完成！（${selectedPath.steps.length} 篇笔记）`);
		} catch (error: any) {
			new Notice(`生成失败: ${error.message}`);
		}
	}

	// ===== Phase 2: Semantic Path =====

	async generateSemanticPath() {
		// Phase 3.1: Use modal to collect query
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

			// Generate embeddings with progress
			new Notice('正在生成语义索引（首次较慢，约需下载模型）...');
			const vaultPath = this.vaultBasePath;
			await this.kbBuilder.embedAll(notes, vaultPath);
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

			await this.noteGenerator.generateNotes(semanticPath.steps, vaultPath, undefined, this.settings.outputFolder);

			const stepsPreview = semanticPath.steps
				.map((s, i) => `${i + 1}. ${s.title} (${(semanticPath.scores?.[i] ?? 0).toFixed(3)})`)
				.join(', ');
			new Notice(`语义路径生成完成！\n${stepsPreview}`);
		} catch (error: any) {
			new Notice(`语义路径生成失败: ${error.message}`);
		}
	}

	// ===== Phase 3: State-Aware Path =====

	async generateStateAwarePath() {
		// Phase 3.1: Use modal to collect target
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

			// Count mastered nodes
			const masteredSize = stateManager.getMasteredIds().size;
			new Notice(`已掌握 ${masteredSize} 个节点，将在路径中跳过`);

			const paths = this.pathPlanner.planPathWithState(target, graph, stateManager);

			if (paths.length === 0) {
				new Notice('未找到学习路径。所有相关节点可能都已掌握！');
				return;
			}

			const selectedPath = paths[0];
			const vaultPath = this.vaultBasePath;
			await this.noteGenerator.generateNotes(selectedPath.steps, vaultPath, undefined, this.settings.outputFolder);

			// Auto-mark generated notes as "planned"
			for (const step of selectedPath.steps) {
				stateManager.setStatus(step.id, 'planned');
			}

			const stepInfo = selectedPath.steps
				.map((s, i) => `${i + 1}. ${s.title} [${selectedPath.states?.[i] ?? 'unknown'}]`)
				.join(' | ');
			new Notice(`状态感知路径生成完成！\n${stepInfo}`);
		} catch (error: any) {
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

			// Ensure output folder exists
			const folderExists = await this.app.vault.adapter.exists(this.settings.outputFolder);
			if (!folderExists) {
				await this.app.vault.createFolder(this.settings.outputFolder);
			}

			await this.app.vault.create(filePath, reviewLines.join('\n---\n'));
			new Notice(`复习笔记已创建（${reviewIds.length} 项）: ${filePath}`);
		} catch (error: any) {
			new Notice(`生成复习笔记失败: ${error.message}`);
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
