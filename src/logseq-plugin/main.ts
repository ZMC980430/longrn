import '@logseq/libs';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';

async function main() {
  console.log('Logseq Learning Path Plugin loaded');

  const kbBuilder = new KnowledgeBaseBuilder();
  const pathPlanner = new PathPlanner();
  const noteGenerator = new NoteGenerator();

  logseq.Editor.registerSlashCommand('生成学习路径', async () => {
    await generateLearningPath(kbBuilder, pathPlanner, noteGenerator);
  });

  logseq.Editor.registerSlashCommand('语义生成学习路径', async () => {
    await generateSemanticPath(kbBuilder, pathPlanner, noteGenerator);
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
      path: page.name,
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

    const target = 'Python数据分析';
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

// ===== Phase 2: Semantic Path =====

async function generateSemanticPath(kbBuilder: KnowledgeBaseBuilder, pathPlanner: PathPlanner, noteGenerator: NoteGenerator) {
  try {
    logseq.UI.showMsg('开始分析知识库...');
    const notes = Array.from((await buildKnowledgeBase(kbBuilder)).values());

    logseq.UI.showMsg('正在生成语义索引...');
    // vaultPath for Logseq — use a reasonable default
    const vaultPath = '/tmp/longrn-logseq';
    await kbBuilder.embedAll(notes, vaultPath);

    const graph = kbBuilder.buildGraph(notes);

    const query = '数据分析';
    const engine = kbBuilder.getEmbeddingEngine();
    if (!engine) throw new Error('Embedding engine not ready');

    logseq.UI.showMsg('正在生成语义路径...');
    const semanticPath = await pathPlanner.semanticPath(query, graph, engine);

    for (const step of semanticPath.steps) {
      let page = await logseq.Editor.getPage(step.title);
      if (!page) {
        page = await logseq.Editor.createPage(step.title, {});
      }
      if (!page) {
        logseq.UI.showMsg(`无法创建页面: ${step.title}`);
        continue;
      }
      const linkedContent = noteGenerator.autoLink(step.content, new Map(semanticPath.steps.map((n: Note) => [n.title, n])));
      await logseq.Editor.appendBlockInPage(page.uuid, linkedContent);
    }

    logseq.UI.showMsg('语义路径生成成功!', 'success');
  } catch (error: any) {
    logseq.UI.showMsg(`语义路径生成失败: ${error.message}`);
  }
}

logseq.ready(main).catch(console.error);
