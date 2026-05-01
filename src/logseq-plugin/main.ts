import '@logseq/libs';
import { KnowledgeBaseBuilder, Note } from '../core/knowledge-builder.js';
import { PathPlanner } from '../core/path-planner.js';
import { NoteGenerator } from '../core/note-generator.js';
import { LearningStateManager } from '../core/learning-state-manager.js';
import { FSRSScheduler } from '../core/fsrs-scheduler.js';
import { SemanticAutoLinker } from '../core/semantic-auto-linker.js';

/**
 * Longrn — Logseq plugin entry point.
 *
 * Registers five Slash commands across three phases:
 * - **Phase 1**: `生成学习路径`
 * - **Phase 2**: `语义生成学习路径`
 * - **Phase 3**: `状态感知学习路径`, `查看学习统计`, `生成复习笔记`
 */
async function main() {
  console.log('Logseq Learning Path Plugin loaded (Phase 3)');

  const kbBuilder = new KnowledgeBaseBuilder();
  const pathPlanner = new PathPlanner();
  const noteGenerator = new NoteGenerator();
  const fsrsScheduler = new FSRSScheduler();
  const semanticLinker = new SemanticAutoLinker();

  // Phase 1
  logseq.Editor.registerSlashCommand('生成学习路径', async () => {
    await generateLearningPath(kbBuilder, pathPlanner, noteGenerator);
  });

  // Phase 2
  logseq.Editor.registerSlashCommand('语义生成学习路径', async () => {
    await generateSemanticPath(kbBuilder, pathPlanner, noteGenerator);
  });

  // Phase 3
  logseq.Editor.registerSlashCommand('状态感知学习路径', async () => {
    await generateStateAwarePath(kbBuilder, pathPlanner, noteGenerator, fsrsScheduler);
  });

  /** Displays learning stats (mastered, in-progress, due today). */
  logseq.Editor.registerSlashCommand('查看学习统计', async () => {
    await showLearningStats(kbBuilder);
  });

  logseq.Editor.registerSlashCommand('生成复习笔记', async () => {
    await generateReviewNote(kbBuilder, noteGenerator, fsrsScheduler);
  });
}

/**
 * Scans all Logseq pages and builds a Map<title, Note> for linking.
 */
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

/**
 * Phase 1: Generates a BFS/DFS learning path from a target and creates pages.
 */
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

/**
 * Phase 2: Generates a semantic learning path using embedding similarity.
 */
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

/**
 * Phase 3: State-aware path generation that skips mastered nodes.
 */
async function generateStateAwarePath(
  kbBuilder: KnowledgeBaseBuilder,
  pathPlanner: PathPlanner,
  noteGenerator: NoteGenerator,
  fsrsScheduler: FSRSScheduler,
) {
  try {
    logseq.UI.showMsg('开始分析知识库（状态感知模式）...');
    const notes = Array.from((await buildKnowledgeBase(kbBuilder)).values());
    const graph = kbBuilder.buildGraph(notes);

    // Use a temp vault path for state persistence
    const vaultPath = '/tmp/longrn-logseq';
    const stateManager = new LearningStateManager(vaultPath);

    const masteredSize = stateManager.getMasteredIds().size;
    logseq.UI.showMsg(`已掌握 ${masteredSize} 个节点，将在路径中跳过`);

    const target = 'Python数据分析';
    const paths = pathPlanner.planPathWithState(target, graph, stateManager);

    if (paths.length === 0) {
      logseq.UI.showMsg('未找到学习路径。所有相关节点可能都已掌握！');
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

      // Auto-mark as planned
      stateManager.setStatus(step.id, 'planned');
    }

    const stepInfo = selectedPath.steps
      .map((s, i) => `${s.title}[${selectedPath.states?.[i] ?? 'unknown'}]`)
      .join(' → ');
    logseq.UI.showMsg(`状态感知路径生成成功!\n${stepInfo}`, 'success');
  } catch (error: any) {
    logseq.UI.showMsg(`状态感知路径生成失败: ${error.message}`);
  }
}

/** Displays learning stats (mastered, in-progress, due today). */
async function showLearningStats(kbBuilder: KnowledgeBaseBuilder) {
  try {
    const vaultPath = '/tmp/longrn-logseq';
    const stateManager = new LearningStateManager(vaultPath);
    const stats = stateManager.getReviewStats();
    const dueCount = stateManager.getDueIds().length;

    logseq.UI.showMsg(
      `📊 学习统计\n` +
      `已掌握: ${stats.mastered}  |  学习中: ${stats.inProgress}\n` +
      `已计划: ${stats.planned}  |  待归档: ${stats.archived}\n` +
      `今日待复习: ${dueCount}`,
    );
  } catch (error: any) {
    logseq.UI.showMsg(`获取统计失败: ${error.message}`);
  }
}

/**
 * Phase 3: Generates review notes for due items (or random mastered nodes
 * if nothing is due), using the FSRS review template.
 */
async function generateReviewNote(
  kbBuilder: KnowledgeBaseBuilder,
  noteGenerator: NoteGenerator,
  fsrsScheduler: FSRSScheduler,
) {
  try {
    logseq.UI.showMsg('准备复习内容...');

    const vaultPath = '/tmp/longrn-logseq';
    const stateManager = new LearningStateManager(vaultPath);
    const notes = Array.from((await buildKnowledgeBase(kbBuilder)).values());

    const dueIds = stateManager.getDueIds();
    let reviewIds: string[];

    if (dueIds.length === 0) {
      // Quick review: pick 5 random mastered nodes
      const masteredIds = [...stateManager.getMasteredIds()];
      if (masteredIds.length === 0) {
        logseq.UI.showMsg('没有可复习的内容。请先生成学习路径。');
        return;
      }
      reviewIds = masteredIds.sort(() => Math.random() - 0.5).slice(0, 5);
    } else {
      reviewIds = dueIds.slice(0, 10);
    }

    // Create a review page
    const pageTitle = `Review-${new Date().toISOString().slice(0, 10)}`;
    let page = await logseq.Editor.getPage(pageTitle);
    if (!page) {
      page = await logseq.Editor.createPage(pageTitle, {});
    }
    if (!page) {
      logseq.UI.showMsg('无法创建复习页面');
      return;
    }

    for (const id of reviewIds) {
      const note = notes.find(n => n.id === id);
      if (!note) continue;
      const reviewContent = fsrsScheduler.generateReviewTemplate(note.title, note.content, note.tags);
      await logseq.Editor.appendBlockInPage(page.uuid, reviewContent);
    }

    logseq.UI.showMsg(`复习笔记创建完成（${reviewIds.length} 项）!`, 'success');
  } catch (error: any) {
    logseq.UI.showMsg(`生成复习笔记失败: ${error.message}`);
  }
}

logseq.ready(main).catch(console.error);
