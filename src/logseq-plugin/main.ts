import '@logseq/libs';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder';
import { PathPlanner } from '../core/path-planner';
import { NoteGenerator } from '../core/note-generator';

let kbBuilder: KnowledgeBaseBuilder;
let pathPlanner: PathPlanner;
let noteGenerator: NoteGenerator;

async function main() {
  console.log('Logseq Learning Path Plugin loaded');

  const kbBuilder = new KnowledgeBaseBuilder();
  const pathPlanner = new PathPlanner();
  const noteGenerator = new NoteGenerator();

  logseq.Editor.registerSlashCommand('生成学习路径', async () => {
    await generateLearningPath(kbBuilder, pathPlanner, noteGenerator);
  });
}

async function buildKnowledgeBase(kbBuilder: KnowledgeBaseBuilder): Promise<Map<string, Note>> {
  const allPages = await logseq.Editor.getAllPages();
  if (!allPages) return new Map();
  const notes: Note[] = [];

  for (const page of allPages) {
    const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
    const content = blocks.map((b: any) => b.content).join('\n');
    const parsed = kbBuilder.parseNote(content, page.name);
    notes.push({
      id: page.uuid,
      title: page.name,
      path: page.name, // Simplified
      content,
      tags: parsed.tags,
      links: parsed.links
    });
  }

  const kb = new Map<string, Note>();
  notes.forEach(note => kb.set(note.title, note));
  return kb;
}

async function generateLearningPath(kbBuilder: KnowledgeBaseBuilder, pathPlanner: PathPlanner, noteGenerator: NoteGenerator) {
  try {
    const notes = Array.from((await buildKnowledgeBase(kbBuilder)).values());
    const graph = kbBuilder.buildGraph(notes);

    const target = 'Python数据分析'; // Example
    const paths = pathPlanner.planPath(target, graph);

    if (paths.length === 0) {
      logseq.UI.showMsg('未找到学习路径');
      return;
    }

    const selectedPath = paths[0];

    for (const step of selectedPath.steps) {
      let page = await logseq.Editor.getPage(step.title);
      if (!page) {
        page = await logseq.Editor.createPage(step.title, {});
      }
      if (!page) {
        logseq.UI.showMsg(`无法创建页面: ${step.title}`);
        continue;
      }
      const linkedContent = noteGenerator.autoLink(step.content, new Map(selectedPath.steps.map((n: Note) => [n.title, n])));
      await logseq.Editor.appendBlockInPage(page.uuid, linkedContent);
    }

    logseq.UI.showMsg('学习路径生成成功!', 'success');
  } catch (error: any) {
    logseq.UI.showMsg(`生成失败: ${error.message}`);
  }
}

logseq.ready(main).catch(console.error);
