#!/usr/bin/env node
/**
 * longrn-cli — Longrn 学习路径系统 CLI 工具
 *
 * 通过 Obsidian CLI 调用插件功能。
 * 纯查询命令通过 eval 直接返回结果；
 * 生成类命令触发 Obsidian GUI 命令（会弹出 Modal 需要用户在 Obsidian 中交互）。
 *
 * @see docs/SDD.md §6.8 Phase 5.2
 */
import { execSync } from 'child_process';
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

// ── Obsidian CLI helpers ──────────────────────────────────────────

function obsidian(cliArgs) {
  const cmd = `"${OBSIDIAN}" vault="${vault}" ${cliArgs}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

function obsidianEval(code) {
  const flat = code.replace(/\n/g, ' ').replace(/"/g, '\\"');
  return obsidian(`eval code="${flat}"`);
}

function obsidianCommand(id) {
  return obsidian(`command id=${id}`);
}

function checkObsidian() {
  if (!existsSync(OBSIDIAN)) {
    console.error(`❌ Obsidian 未安装: ${OBSIDIAN}`);
    process.exit(1);
  }
}

function handleObsidianNotRunning(err) {
  const msg = err.stderr || err.message || String(err);
  if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('spawn')) {
    console.error('❌ Obsidian 未运行。请先启动 Obsidian 并打开 Vault。');
    console.error(`   Vault: ${vault}`);
    console.error('   启动后重试此命令。');
  } else {
    console.error('❌ Obsidian CLI 调用失败:', msg);
  }
  process.exit(1);
}

function parseResult(result) {
  if (!result || result.trim() === '') return { ok: false, error: 'no response' };
  let t = result.trim();
  if (t.startsWith('=> ')) t = t.slice(3);
  if (t.startsWith('Error:')) return { ok: false, error: t };
  if (t.startsWith('ERROR:')) return { ok: false, error: t.slice(6) };
  return { ok: true, data: t };
}

// ── Commands ──────────────────────────────────────────────────────

function handleShowReviewList() {
  console.log('📊 正在获取复习统计...\n');
  checkObsidian();

  try {
    const result = obsidianEval(`(() => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded';
      const sm = p.ensureStateManager();
      const states = sm.getAllStates();
      const entries = Object.values(states);
      const total = entries.length;
      const mastered = entries.filter(e => e.status === 'mastered').length;
      const inProgress = entries.filter(e => e.status === 'in_progress').length;
      const planned = entries.filter(e => e.status === 'planned').length;
      const archived = entries.filter(e => e.status === 'archived').length;
      const dueIds = sm.getDueIds ? sm.getDueIds() : [];
      return JSON.stringify({dueCount: dueIds.length, total, mastered, inProgress, planned, archived});
    })()`);

    const r = parseResult(result);
    if (!r.ok) { console.error('⚠️  ', r.error); process.exit(1); }
    const stats = JSON.parse(r.data);
    console.log('📊 学习统计');
    console.log(`   总节点数: ${stats.total}`);
    console.log(`   已掌握:   ${stats.mastered}`);
    console.log(`   学习中:   ${stats.inProgress}`);
    console.log(`   已计划:   ${stats.planned}`);
    console.log(`   已归档:   ${stats.archived}`);
    console.log(`   今日待复习: ${stats.dueCount} 项`);
    if (stats.dueCount === 0) console.log('\n   🎉 今日无待复习内容！');
  } catch (err) {
    handleObsidianNotRunning(err);
  }
}

function handleGenerateReviewNote() {
  console.log('📝 正在生成复习笔记...');
  checkObsidian();

  try {
    obsidianCommand('longrn-learning-path:generate-review-note');
    console.log('✅ 已触发复习笔记生成。请查看 Obsidian 中的 Modal 对话框。');
  } catch (err) {
    handleObsidianNotRunning(err);
  }
}

function handleGeneratePathTree(topic) {
  if (!topic) {
    console.error('请提供学习主题。用法: node scripts/longrn-cli.mjs generate-path-tree <主题>');
    process.exit(1);
  }

  console.log(`🌳 正在为「${topic}」触发路径树生成...`);
  checkObsidian();

  try {
    obsidianCommand('longrn-learning-path:generate-learning-path-tree');
    console.log(`✅ 已触发路径树生成命令。`);
    console.log(`   请在 Obsidian 的弹出对话框中输入主题「${topic}」。`);
  } catch (err) {
    handleObsidianNotRunning(err);
  }
}

function handleGenerateAIPath(topic) {
  if (!topic) {
    console.error('请提供学习主题。用法: node scripts/longrn-cli.mjs generate-ai-path <主题>');
    process.exit(1);
  }

  console.log(`🤖 正在为「${topic}」触发 AI 学习路径生成...`);
  checkObsidian();

  try {
    obsidianCommand('longrn-learning-path:generate-ai-learning-path');
    console.log(`✅ 已触发 AI 生成命令。`);
    console.log(`   请在 Obsidian 的弹出对话框中输入主题「${topic}」。`);
  } catch (err) {
    handleObsidianNotRunning(err);
  }
}

// ── Help ──────────────────────────────────────────────────────────

function printHelp() {
  console.log('longrn-cli — Longrn 学习路径系统命令行工具');
  console.log('');
  console.log('用法: node scripts/longrn-cli.mjs <command> [options]');
  console.log('');
  console.log('命令:');
  console.log('  show-review-list           查看今日复习列表（直接返回，无需 GUI）');
  console.log('  generate-review-note       触发复习笔记生成（弹出 Obsidian Modal）');
  console.log('  generate-path-tree <主题>  触发路径树生成（弹出 Obsidian Modal）');
  console.log('  generate-ai-path <主题>    触发 AI 路径生成（弹出 Obsidian Modal）');
  console.log('');
  console.log('选项:');
  console.log('  --vault <名称>             指定 Obsidian Vault (默认: LifeTimer)');
  console.log('  --help, -h                 显示帮助信息');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/longrn-cli.mjs show-review-list');
  console.log('  node scripts/longrn-cli.mjs generate-path-tree "TypeScript"');
  console.log('  node scripts/longrn-cli.mjs --vault MyNotes show-review-list');
}

// ── Entry ─────────────────────────────────────────────────────────

switch (command) {
  case '--help':
  case '-h':
    printHelp();
    break;
  case 'show-review-list':
    handleShowReviewList();
    break;
  case 'generate-review-note':
    handleGenerateReviewNote();
    break;
  case 'generate-path-tree':
    handleGeneratePathTree(args.join(' '));
    break;
  case 'generate-ai-path':
    handleGenerateAIPath(args.join(' '));
    break;
  default:
    console.error(`未知命令: ${command || '(未指定)'}\n`);
    printHelp();
    process.exit(1);
}
