import { Plugin, Notice } from 'obsidian';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';

export default class LearningPathPlugin extends Plugin {
  app: any;
  kbBuilder!: KnowledgeBaseBuilder;
  pathPlanner!: PathPlanner;
  noteGenerator!: NoteGenerator;

  async onload() {
    console.log('Loading Learning Path Plugin');

    this.kbBuilder = new KnowledgeBaseBuilder();
    this.pathPlanner = new PathPlanner();
    this.noteGenerator = new NoteGenerator();

    this.addCommand({
      id: 'generate-learning-path',
      name: '生成学习路径',
      callback: () => void this.generateLearningPath(),
    });

    this.addCommand({
      id: 'generate-semantic-path',
      name: '语义生成学习路径',
      callback: () => void this.generateSemanticPath(),
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

  onunload() {
    console.log('Unloading Learning Path Plugin');
  }
}
