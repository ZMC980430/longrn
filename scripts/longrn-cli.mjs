#!/usr/bin/env node
/**
 * longrn-cli — Longrn 学习路径系统 CLI 工具
 *
 * 基于 Obsidian CLI spawn 调用（绕过 shell 转义），
 * 直接调用插件内部方法，无需 Obsidian GUI 交互。
 *
 * @see docs/SDD.md §6.8 Phase 5.2
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

const OBSIDIAN = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const DEFAULT_VAULT = 'LifeTimer';

// ── Argument parsing ──────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

let vault = DEFAULT_VAULT;
const vaultIdx = rawArgs.indexOf('--vault');
if (vaultIdx !== -1) {
  if (vaultIdx + 1 >= rawArgs.length) {
    console.error('❌ --vault 需要一个参数: Vault 名称');
    process.exit(1);
  }
  vault = rawArgs[vaultIdx + 1];
  rawArgs.splice(vaultIdx, 2);
}

const command = rawArgs[0] || '';
const args = rawArgs.slice(1);

// ── Obsidian CLI core ────────────────────────────────────────────

function obsEval(code) {
  const result = spawnSync(OBSIDIAN, ['eval', 'code=' + code, 'vault=' + vault], {
    encoding: 'utf-8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return (result.stdout || '').trim();
}

function parse(output) {
  if (!output) return { ok: false, error: 'empty response' };
  let t = output.trim();
  if (t.startsWith('=> ')) t = t.slice(3);
  if (t.startsWith('Error:')) return { ok: false, error: t };
  if (t.startsWith('ERROR:')) return { ok: false, error: t.slice(6) };
  if (t.startsWith('NO_PATH')) return { ok: false, error: '未找到匹配的学习路径' };
  if (t.startsWith('OK:')) return { ok: true, data: t.slice(3) };
  return { ok: true, data: t };
}

function checkObsidian() {
  if (!existsSync(OBSIDIAN)) { console.error(`❌ Obsidian 未安装: ${OBSIDIAN}`); process.exit(1); }
}

function fail(msg) { console.error(`⚠️  ${msg}`); process.exit(1); }

// ── Commands ──────────────────────────────────────────────────────

function handleShowReviewList() {
  console.log('📊 正在获取复习统计...\n');
  checkObsidian();
  try {
    const r = parse(obsEval(`(() => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded';
      const sm = p.ensureStateManager();
      const entries = Object.values(sm.getAllStates());
      const total = entries.length;
      const mastered = entries.filter(e => e.status === 'mastered').length;
      const inProgress = entries.filter(e => e.status === 'in_progress').length;
      const planned = entries.filter(e => e.status === 'planned').length;
      const archived = entries.filter(e => e.status === 'archived').length;
      const dueIds = sm.getDueIds ? sm.getDueIds() : [];
      return JSON.stringify({dueCount: dueIds.length, total, mastered, inProgress, planned, archived});
    })()`));
    if (!r.ok) fail(r.error);
    const s = JSON.parse(r.data);
    console.log('📊 学习统计');
    console.log(`   总节点数: ${s.total}`);
    console.log(`   已掌握:   ${s.mastered}`);
    console.log(`   学习中:   ${s.inProgress}`);
    console.log(`   已计划:   ${s.planned}`);
    console.log(`   已归档:   ${s.archived}`);
    console.log(`   今日待复习: ${s.dueCount} 项`);
    if (s.dueCount === 0) console.log('\n   🎉 今日无待复习内容！');
  } catch (err) { fail(err.message || 'Obsidian 调用失败'); }
}

function handleGenerateReviewNote() {
  const count = args[0] ? parseInt(args[0]) : 5;
  console.log(`📝 正在生成复习笔记（数量: ${count}）...`);
  checkObsidian();
  try {
    const r = parse(obsEval(`(async () => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded';
      try {
        const sm = p.ensureStateManager();
        const dueIds = sm.getDueIds();
        const targetIds = dueIds.length > 0 ? dueIds.slice(0, ${count}) : [];
        if (targetIds.length === 0) return 'ERROR:no cards to review. Vault has no learning state data yet.';
        const outFolder = p.settings.outputFolder || 'learning-path';
        if (!(await app.vault.adapter.exists(outFolder))) await app.vault.createFolder(outFolder);
        let content = '# 今日复习\\n\\n';
        const states = sm.getAllStates();
        for (const id of targetIds) {
          const st = states[id];
          if (!st) continue;
          const file = app.vault.getAbstractFileByPath(id);
          const title = file ? file.basename : id;
          content += '## ' + title + '\\n\\n';
          content += '上次复习: ' + (st.lastReviewedAt || '从未') + '\\n';
          content += '复习次数: ' + (st.reviewCount || 0) + '\\n\\n';
          content += '[ ] 完全不记得 (Again)\\n';
          content += '[ ] 有些困难 (Hard)\\n';
          content += '[ ] 基本记得 (Good)\\n';
          content += '[ ] 非常简单 (Easy)\\n\\n---\\n\\n';
        }
        const now = new Date().toISOString().slice(0, 10);
        await app.vault.create(outFolder + '/复习_' + now + '.md', content);
        return 'OK:reviewed ' + targetIds.length;
      } catch(e) { return 'ERROR:' + e.message; }
    })()`));
    if (!r.ok) fail(r.error);
    console.log('✅ 复习笔记已生成！');
  } catch (err) { fail(err.message || '调用失败'); }
}

function handleGeneratePathTree(topic) {
  if (!topic) fail('用法: node scripts/longrn-cli.mjs generate-path-tree <主题>');
  console.log(`🌳 正在为「${topic}」生成学习路径树...`);
  checkObsidian();
  const top = JSON.stringify(topic);
  try {
    const r = parse(obsEval([
      '(async () => {',
      "  const p = app.plugins.plugins['longrn-learning-path'];",
      '  if (!p) return "ERROR:plugin not loaded";',
      '  const tree = p.pathTreeGenerator.generatePathTree(' + top + ', p.settings.maxGenerationDepth, p.settings.nodesPerLayer);',
      '  let notes = p.pathTreeGenerator.renderTreeToMarkdown(tree, p.settings.generationStyle || "map");',
      '  notes = p.pathTreeGenerator.crossLinkGeneratedNotes(notes);',
      '  const outFolder = p.settings.outputFolder || "learning-path";',
      '  if (!(await app.vault.adapter.exists(outFolder))) await app.vault.createFolder(outFolder);',
      '  const existing = new Set(app.vault.getMarkdownFiles().map(f => f.path));',
      '  let cnt = 0;',
      '  for (const item of Array.from(notes.entries())) {',
      '    const fname = item[0], text = item[1];',
      '    let fp = outFolder + "/" + fname;',
      '    if (existing.has(fp)) fp = outFolder + "/" + fname.replace(".md", cnt + ".md");',
      '    await app.vault.create(fp, text);',
      '    existing.add(fp);',
      '    cnt++;',
      '    if (cnt >= 5) break;',
      '  }',
      '  return "OK:" + cnt;',
      '})()',
    ].join('\n')));
    if (!r.ok) fail(r.error);
    console.log(`✅ 学习路径树生成完成！共创建 ${r.data} 篇笔记。`);
  } catch (err) { fail(err.message || '调用失败'); }
}

function handleGenerateAIPath(topic) {
  if (!topic) fail('用法: node scripts/longrn-cli.mjs generate-ai-path <主题>');
  console.log(`🤖 正在为「${topic}」生成 AI 学习路径...`);
  checkObsidian();
  const top = JSON.stringify(topic);
  try {
    const r = parse(obsEval([
      '(async () => {',
      "  const p = app.plugins.plugins['longrn-learning-path'];",
      '  if (!p) return "ERROR:plugin not loaded";',
      '  const config = await p.getLLMConfig();',
      '  if (!config.enabled || !config.apiKey) return "ERROR:AI not configured. Enable AI in plugin settings.";',
      '  const rawTree = await p.llmClient.generatePathTree(' + top + ', p.settings.nodesPerLayer || 5, config);',
      '  if (!rawTree) return "ERROR:LLM call failed. Check API key and network.";',
      '  const nodes = p.llmClient.convertLlmTreeToPathNodes(rawTree, p.settings.maxGenerationDepth || 2);',
      '  const tree = { topic: ' + top + ', depth: 0, maxDepth: p.settings.maxGenerationDepth || 2, nodes: nodes };',
      '  let notes = p.pathTreeGenerator.renderTreeToMarkdown(tree, p.settings.generationStyle || "map");',
      '  notes = p.pathTreeGenerator.crossLinkGeneratedNotes(notes);',
      '  const outFolder = p.settings.outputFolder || "learning-path";',
      '  if (!(await app.vault.adapter.exists(outFolder))) await app.vault.createFolder(outFolder);',
      '  const existing = new Set(app.vault.getMarkdownFiles().map(f => f.path));',
      '  let cnt = 0;',
      '  for (const item of Array.from(notes.entries())) {',
      '    const fname = item[0], text = item[1];',
      '    let fp = outFolder + "/" + fname;',
      '    if (existing.has(fp)) fp = outFolder + "/" + fname.replace(".md", cnt + ".md");',
      '    await app.vault.create(fp, text);',
      '    existing.add(fp);',
      '    cnt++;',
      '    if (cnt >= 5) break;',
      '  }',
      '  return "OK:" + cnt;',
      '})()',
    ].join('\n')));
    if (!r.ok) fail(r.error);
    console.log(`✅ AI 学习路径生成完成！共创建 ${r.data} 篇笔记。`);
  } catch (err) { fail(err.message || '调用失败'); }
}

// ── Help ──────────────────────────────────────────────────────────

function printHelp() {
  console.log('longrn-cli — Longrn 学习路径系统命令行工具');
  console.log('');
  console.log('用法: node scripts/longrn-cli.mjs <command> [参数] [--vault <名称>]');
  console.log('');
  console.log('命令:');
  console.log('  show-review-list             查看今日复习统计（无需 GUI）');
  console.log('  generate-review-note [数量]  生成复习笔记（默认 5 篇）');
  console.log('  generate-path-tree <主题>    生成学习路径树（Phase 4 模板）');
  console.log('  generate-ai-path <主题>      AI 生成学习路径（需要 API Key）');
  console.log('');
  console.log('选项:');
  console.log('  --vault <名称>   Obsidian Vault 名称（默认: LifeTimer）');
  console.log('  --help, -h       显示帮助');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/longrn-cli.mjs show-review-list');
  console.log('  node scripts/longrn-cli.mjs generate-path-tree "Go 语言"');
  console.log('  node scripts/longrn-cli.mjs generate-ai-path "机器学习"');
}

// ── Entry ─────────────────────────────────────────────────────────

switch (command) {
  case '--help': case '-h': printHelp(); break;
  case 'show-review-list': handleShowReviewList(); break;
  case 'generate-review-note': handleGenerateReviewNote(); break;
  case 'generate-path-tree': handleGeneratePathTree(args.join(' ')); break;
  case 'generate-ai-path': handleGenerateAIPath(args.join(' ')); break;
  default:
    console.error(`未知命令: ${command || '(未指定)'}\n`);
    printHelp();
    process.exit(1);
}
