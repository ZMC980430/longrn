import { Plugin, Notice } from 'obsidian';
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
