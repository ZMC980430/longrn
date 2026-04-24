import { Plugin, Notice } from 'obsidian';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder';
import { PathPlanner } from '../core/path-planner';
import { NoteGenerator } from '../core/note-generator';

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
  }

  async buildKnowledgeBase(): Promise<Map<string, Note>> {
    const files = this.app.vault.getMarkdownFiles();
    const notes: Note[] = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const parsed = this.kbBuilder.parseNote(content);
      notes.push({
        id: file.path, // Use path as id for simplicity
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

      // For demo, target is hardcoded; in real, prompt user
      const target = 'Python数据分析'; // Example target
      const paths = this.pathPlanner.planPath(target, graph);

      if (paths.length === 0) {
        new Notice('未找到学习路径，请检查目标主题。');
        return;
      }

      const selectedPath = paths[0]; // Select quick path

      const vaultPath = this.app.vault.adapter.basePath;
      await this.noteGenerator.generateNotes(selectedPath.steps, vaultPath);

      new Notice('学习路径笔记生成完成！');
    } catch (error: any) {
      new Notice(`生成失败: ${error.message}`);
    }
  }

  onunload() {
    console.log('Unloading Learning Path Plugin');
  }
}
