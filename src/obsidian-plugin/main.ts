import { Plugin, Notice, PluginSettingTab, Setting } from 'obsidian';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';
import { LearningStateManager } from '../core/learning-state-manager.js';
import { FSRSScheduler } from '../core/fsrs-scheduler.js';
import { SemanticAutoLinker } from '../core/semantic-auto-linker.js';

export default class LearningPathPlugin extends Plugin {
  app: any;
  kbBuilder!: KnowledgeBaseBuilder;
  pathPlanner!: PathPlanner;
  noteGenerator!: NoteGenerator;
  stateManager!: LearningStateManager;
  fsrsScheduler!: FSRSScheduler;
  semanticLinker!: SemanticAutoLinker;

  async onload() {
    console.log('Loading Learning Path Plugin (Phase 3)');

    this.kbBuilder = new KnowledgeBaseBuilder();
    this.pathPlanner = new PathPlanner();
    this.noteGenerator = new NoteGenerator();
    this.fsrsScheduler = new FSRSScheduler();
    this.semanticLinker = new SemanticAutoLinker();

    // Initialize state manager after vault is available
    this.app.workspace.onLayoutReady(() => {
      const vaultPath = this.app.vault.adapter.basePath;
      this.stateManager = new LearningStateManager(vaultPath);
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

  async generateLearningPath() {
    new Notice('开始分析您的知识库...');

    try {
      const notes = Array.from((await this.buildKnowledgeBase()).values());
      const graph = this.kbBuilder.buildGraph(notes);

      const target = 'Python数据分析';
      const paths = this.pathPlanner.planPath(target, graph);

      if (paths.length === 0) {
        new Notice('未找到学习路径，请检查目标主题。');
        return;
      }

      const selectedPath = paths[0];
      const vaultPath = this.app.vault.adapter.basePath;
      await this.noteGenerator.generateNotes(selectedPath.steps, vaultPath);

      new Notice('学习路径笔记生成完成！');
    } catch (error: any) {
      new Notice(`生成失败: ${error.message}`);
    }
  }

  // ===== Phase 2: Semantic Path =====

  async generateSemanticPath() {
    new Notice('开始分析您的知识库...');

    try {
      const notes = Array.from((await this.buildKnowledgeBase()).values());

      // Generate embeddings with progress
      new Notice('正在生成语义索引（首次较慢，约需下载模型）...');
      const vaultPath = this.app.vault.adapter.basePath;
      await this.kbBuilder.embedAll(notes, vaultPath);
      new Notice(`语义索引完成！共 ${notes.length} 条笔记`);

      const graph = this.kbBuilder.buildGraph(notes);

      // For now, use a natural language query; future: Modal input
      const query = '数据分析';
      const engine = this.kbBuilder.getEmbeddingEngine();
      if (!engine) throw new Error('Embedding engine not ready');

      new Notice('正在搜索最相关概念并生成路径...');
      const semanticPath = await this.pathPlanner.semanticPath(
        query,
        graph,
        engine,
      );

      await this.noteGenerator.generateNotes(semanticPath.steps, vaultPath);

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
    new Notice('开始分析您的知识库（状态感知模式）...');

    try {
      const vaultPath = this.app.vault.adapter.basePath;
      if (!this.stateManager) {
        this.stateManager = new LearningStateManager(vaultPath);
      }

      const notes = Array.from((await this.buildKnowledgeBase()).values());
      const graph = this.kbBuilder.buildGraph(notes);

      // Count mastered nodes
      const masteredSize = this.stateManager.getMasteredIds().size;
      new Notice(`已掌握 ${masteredSize} 个节点，将在路径中跳过`);

      const target = 'Python数据分析';
      const paths = this.pathPlanner.planPathWithState(target, graph, this.stateManager);

      if (paths.length === 0) {
        new Notice('未找到学习路径。所有相关节点可能都已掌握！');
        return;
      }

      const selectedPath = paths[0];
      await this.noteGenerator.generateNotes(selectedPath.steps, vaultPath);

      // Auto-mark generated notes as "planned"
      for (const step of selectedPath.steps) {
        this.stateManager.setStatus(step.id, 'planned');
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
      const vaultPath = this.app.vault.adapter.basePath;
      if (!this.stateManager) {
        this.stateManager = new LearningStateManager(vaultPath);
      }

      const dueIds = this.stateManager.getDueIds();
      const stats = this.stateManager.getReviewStats();

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
      const vaultPath = this.app.vault.adapter.basePath;
      if (!this.stateManager) {
        this.stateManager = new LearningStateManager(vaultPath);
      }

      const dueIds = this.stateManager.getDueIds();
      if (dueIds.length === 0) {
        // Pick some mastered items for quick review
        const masteredIds = [...this.stateManager.getMasteredIds()];
        if (masteredIds.length === 0) {
          new Notice('没有已掌握或待复习的知识点。请先生成学习路径。');
          return;
        }
        // Pick 5 random mastered nodes for quick review
        const shuffled = masteredIds.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 5);

        const notes = Array.from((await this.buildKnowledgeBase()).values());
        const reviewLines: string[] = ['# 🔄 快速复习\n'];

        for (const id of selected) {
          const note = notes.find(n => n.id === id);
          if (!note) continue;
          reviewLines.push(this.fsrsScheduler.generateReviewTemplate(note.title, note.content, note.tags));
        }

        const fileName = `review-${new Date().toISOString().slice(0, 10)}.md`;
        const filePath = `${vaultPath}/${fileName}`;
        await this.app.vault.create(fileName, reviewLines.join('\n---\n'));
        new Notice(`快速复习笔记已创建: ${fileName}`);
        return;
      }

      // Generate review notes for due items
      const notes = Array.from((await this.buildKnowledgeBase()).values());
      const reviewLines: string[] = ['# 🔄 今日复习\n'];

      for (const id of dueIds.slice(0, 10)) {
        const note = notes.find(n => n.id === id);
        if (!note) continue;
        reviewLines.push(this.fsrsScheduler.generateReviewTemplate(note.title, note.content, note.tags));
      }

      const fileName = `review-${new Date().toISOString().slice(0, 10)}.md`;
      await this.app.vault.create(fileName, reviewLines.join('\n---\n'));
      new Notice(`复习笔记已创建（${Math.min(dueIds.length, 10)} 项）: ${fileName}`);
    } catch (error: any) {
      new Notice(`生成复习笔记失败: ${error.message}`);
    }
  }

  onunload() {
    console.log('Unloading Learning Path Plugin');
  }
}

/**
 * Longrn 插件设置页面
 * 显示插件介绍、功能说明、版本信息和使用方法
 */
class LongrnSettingTab extends PluginSettingTab {
  plugin: LearningPathPlugin;

  constructor(app: any, plugin: LearningPathPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── 标题 ──
    containerEl.createEl('h1', { text: '🧠 Longrn 学习路径系统' });

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
        desc: '扫描 Vault 中的笔记，分析知识结构，生成从基础到目标主题的学习路径并创建笔记。',
      },
      {
        name: '语义生成学习路径',
        desc: '利用 AI 语义嵌入技术，根据语义相关性生成更智能的学习路径。首次使用需下载模型。',
      },
      {
        name: '状态感知学习路径',
        desc: '追踪每个知识点的学习状态（未学/计划/进行中/已掌握/已归档），自动跳过已掌握节点。',
      },
      {
        name: '查看今日待复习列表',
        desc: '基于 FSRS 间隔重复算法，显示今日到期待复习的知识点统计。',
      },
      {
        name: '生成复习笔记',
        desc: '为到期待复习的知识点自动生成复习笔记模板，含回顾内容和评分按钮。',
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
      '通过命令面板 (Cmd/Ctrl+P) 运行「生成学习路径」命令',
      '插件会自动扫描笔记、构建知识图谱、生成目标主题的学习路径',
      '如需更智能的路径，可尝试「语义生成学习路径」',
      '学习过程中使用「状态感知学习路径」跳过已掌握的内容',
      '定期使用「查看今日待复习列表」和「生成复习笔记」进行复习',
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
      '如遇到问题，可检查 Obsidian 控制台 (Ctrl+Shift+I) 查看日志',
    ];
    for (const note of notes) {
      containerEl.createEl('p', { text: '• ' + note });
    }

    // ── 链接 ──
    containerEl.createEl('h2', { text: '🔗 资源链接' });
    new Setting(containerEl)
      .setName('项目仓库')
      .setDesc('GitHub - Longrn 学习路径系统')
      .addButton((btn) => {
        btn.setButtonText('在 GitHub 上查看');
        btn.onClick(() => {
          // @ts-ignore
          window.open('https://github.com/longrn', '_blank');
        });
      });
  }
}
