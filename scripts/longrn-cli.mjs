#!/usr/bin/env node
/**
 * longrn-cli — Longrn 学习路径系统 CLI 工具 (Phase 5.2)
 *
 * 两种运行模式：
 *   直接模式：直接调用 LongrnService（无需 Obsidian 运行）
 *   桥接模式：通过 obsidian eval 调用插件（扫描 vault 笔记）
 *
 * 用法: node scripts/longrn-cli.mjs <command> [参数] [选项]
 *
 * @see docs/SDD.md §6.8
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── 参数解析 ──────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

/** 解析 --选项 */
function parseOpts(args) {
  const opts = { vault: 'LifeTimer', output: '', depth: '', nodes: '', count: '' };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--vault' && i + 1 < args.length) { opts.vault = args[i + 1]; i += 2; continue; }
    if (args[i] === '--output' && i + 1 < args.length) { opts.output = args[i + 1]; i += 2; continue; }
    if (args[i] === '--depth' && i + 1 < args.length) { opts.depth = args[i + 1]; i += 2; continue; }
    if (args[i] === '--nodes' && i + 1 < args.length) { opts.nodes = args[i + 1]; i += 2; continue; }
    positional.push(args[i]);
    i++;
  }
  return { opts, positional };
}

const { opts, positional } = parseOpts(rawArgs);
const command = positional[0] || '';
const cmdArgs = positional.slice(1);

// ── 颜色输出 ──────────────────────────────────────────────────

const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };

function fail(msg) { console.error(`${c.red}✖${c.reset} ${msg}`); process.exit(1); }
function ok(msg) { console.log(`${c.green}✔${c.reset} ${msg}`); }

// ── 帮助 ──────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${c.bold}longrn-cli${c.reset} — Longrn 学习路径系统命令行工具 (Phase 5.2)

${c.cyan}用法:${c.reset} node scripts/longrn-cli.mjs <command> [参数] [选项]

${c.cyan}直接模式命令（无需 Obsidian 运行）:${c.reset}
  stats                    查看学习统计
  due                      列出今日待复习项
  path-tree <主题>          模板生成学习路径树
  ai-path <主题>            AI 生成学习路径（需配置 API Key）
  review-note [数量]        生成复习笔记 Markdown
  record-review <id> <评分>  记录评分（1=Again 2=Hard 3=Good 4=Easy）
  set-status <id> <状态>    设置节点状态（planned/in_progress/mastered/archived）

${c.cyan}桥接模式命令（需要 Obsidian 运行）:${c.reset}
  vault-path <主题>         从 vault 生成 BFS/DFS 学习路径
  vault-semantic <查询>     语义搜索路径
  vault-state <主题>        状态感知路径（跳过已掌握节点）

${c.cyan}选项:${c.reset}
  --vault <名称>    Obsidian Vault 名称（默认: LifeTimer）
  --depth <N>       路径树深度（1-3）
  --nodes <N>       每层节点数（3-10）
  --help, -h        显示帮助

${c.cyan}示例:${c.reset}
  node scripts/longrn-cli.mjs stats
  node scripts/longrn-cli.mjs path-tree "Go 语言"
  node scripts/longrn-cli.mjs ai-path "机器学习" --depth 3 --nodes 5
  node scripts/longrn-cli.mjs review-note 10
  node scripts/longrn-cli.mjs record-review "Go语言.md" 4
`);
}

// ── 加载配置 ──────────────────────────────────────────────────

/**
 * 从多个来源加载配置：
 * 1. Vault 内的插件 data.json
 * 2. 环境变量
 * 3. 默认值
 */
function loadConfig(vaultName) {
  // 查找 iCloud Obsidian vault 路径
  const iCloudBase = join(process.env.HOME || '', 'Library/Mobile Documents/iCloud~md~obsidian/Documents');
  const vaultPath = join(iCloudBase, vaultName);

  if (!existsSync(vaultPath)) {
    // 尝试非 iCloud 路径
    const altPath = join(process.env.HOME || '', 'Documents', vaultName);
    if (!existsSync(altPath)) {
      console.warn(`${c.yellow}⚠${c.reset} Vault "${vaultName}" 未找到，使用默认配置`);
      return { vaultPath: process.cwd(), config: null };
    }
    return { vaultPath: altPath, config: null };
  }

  // 尝试加载插件配置
  let pluginConfig = null;
  const configPath = join(vaultPath, '.obsidian', 'plugins', 'longrn-learning-path', 'data.json');
  if (existsSync(configPath)) {
    try {
      pluginConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  // 环境变量覆盖 API 配置
  const config = {
    outputFolder: pluginConfig?.outputFolder || 'learning-path',
    maxGenerationDepth: parseInt(opts.depth || pluginConfig?.maxGenerationDepth || '2'),
    nodesPerLayer: parseInt(opts.nodes || pluginConfig?.nodesPerLayer || '5'),
    generationStyle: pluginConfig?.generationStyle || 'map',
    aiEnabled: pluginConfig?.aiEnabled || false,
    apiEndpoint: process.env.LONGRN_API_ENDPOINT || pluginConfig?.apiEndpoint || 'https://api.deepseek.com/v1',
    apiKey: process.env.LONGRN_API_KEY || pluginConfig?.apiKey || '',
    model: process.env.LONGRN_MODEL || pluginConfig?.model || 'deepseek-v4-pro',
    temperature: pluginConfig?.temperature || 0.7,
  };

  return { vaultPath, config };
}

// ── 动态加载 LongrnService ────────────────────────────────────

async function createService(vaultName) {
  const { vaultPath, config } = loadConfig(vaultName);

  const distPath = join(PROJECT_ROOT, 'dist', 'core', 'longrn-service.js');
  if (!existsSync(distPath)) {
    fail(`LongrnService 未编译。请先运行: npm run build`);
  }

  const { LongrnService, DEFAULT_LONGRN_CONFIG } = await import(distPath);
  const { defaultFileOps } = await import(join(PROJECT_ROOT, 'dist', 'core', 'learning-state-manager.js'));

  const serviceConfig = config ? { ...DEFAULT_LONGRN_CONFIG, ...config } : undefined;
  const service = new LongrnService(vaultPath, defaultFileOps, serviceConfig);
  await service.init();
  return { service, vaultPath };
}

// ── Obsidian eval 桥接 ────────────────────────────────────────

const OBSIDIAN = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';

function checkObsidian() {
  if (!existsSync(OBSIDIAN)) fail(`Obsidian 未安装: ${OBSIDIAN}`);
}

/**
 * 通过 obsidian eval 调用插件方法。
 * 返回解析后的结构化结果。
 */
function obsEval(code, vault) {
  const result = spawnSync(OBSIDIAN, ['eval', 'code=' + code, 'vault=' + vault], {
    encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) fail(`Obsidian eval 失败: ${result.error.message}`);
  const output = (result.stdout || '').trim();
  if (!output) fail('Obsidian 未返回数据（可能插件未加载或 Vault 未打开）');

  let t = output;
  if (t.startsWith('=> ')) t = t.slice(3);
  if (t.startsWith('Error:') || t.startsWith('ERROR:')) {
    fail(t.replace(/^(Error|ERROR):/, '').trim());
  }
  return t;
}

// ── 命令实现 ──────────────────────────────────────────────────

async function handleStats() {
  const { service } = await createService(opts.vault);
  const stats = service.getReviewStats();
  console.log(`${c.bold}📊 学习统计${c.reset}\n`);
  console.log(`   总节点数: ${stats.total}`);
  console.log(`   已掌握:   ${c.green}${stats.mastered}${c.reset}`);
  console.log(`   学习中:   ${c.cyan}${stats.inProgress}${c.reset}`);
  console.log(`   已计划:   ${c.yellow}${stats.planned}${c.reset}`);
  console.log(`   已归档:   ${c.dim}${stats.archived}${c.reset}`);
  console.log(`   待复习:   ${stats.total - stats.mastered - stats.archived}`);
}

async function handleDue() {
  const { service } = await createService(opts.vault);
  const dueIds = service.getDueIds();
  console.log(`${c.bold}📋 今日待复习${c.reset}\n`);
  if (dueIds.length === 0) {
    ok('今日无待复习内容！');
  } else {
    console.log(`   共 ${dueIds.length} 项：\n`);
    dueIds.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
  }
}

async function handlePathTree() {
  const topic = cmdArgs.join(' ');
  if (!topic) fail('用法: node scripts/longrn-cli.mjs path-tree <主题>');
  const { service } = await createService(opts.vault);
  const config = service.getConfig();

  console.log(`${c.bold}🌳 生成「${topic}」学习路径树（模板模式）${c.reset}\n`);
  console.log(`   深度: ${config.maxGenerationDepth} 层 | 每层节点数: ${config.nodesPerLayer}\n`);

  const { notes } = service.generatePathTree(topic);
  console.log(`生成 ${notes.size} 篇笔记：\n`);
  for (const [name, content] of notes) {
    console.log(`${c.cyan}  ─ ${name}${c.reset} (${content.length} 字)`);
  }
  ok('路径树生成完成！');
  return notes;
}

async function handleAIPath() {
  const topic = cmdArgs.join(' ');
  if (!topic) fail('用法: node scripts/longrn-cli.mjs ai-path <主题>');
  const { service, vaultPath } = await createService(opts.vault);
  const config = service.getConfig();

  if (!config.aiEnabled && !config.apiKey) {
    fail('AI 生成未启用或未配置 API Key。请设置环境变量 LONGRN_API_KEY 或配置插件。');
  }

  // 如果插件未启用 AI，通过环境变量覆盖
  if (!config.aiEnabled && config.apiKey) {
    console.log(`${c.yellow}⚠${c.reset} 插件未启用 AI，使用环境变量配置`);
  }

  console.log(`${c.bold}🤖 AI 生成「${topic}」学习路径${c.reset}\n`);
  console.log(`   模型: ${config.model} | 深度: ${config.maxGenerationDepth} | 节点: ${config.nodesPerLayer}\n`);

  const result = await service.generateAIPathTree(topic);
  console.log(`   ${result.usedAI ? `${c.green}AI 生成${c.reset}` : `${c.yellow}模板降级${c.reset}`} | AI 笔记: ${result.aiGeneratedNotes.length} | 模板: ${result.templatedNotes.length}\n`);

  if (result.aiGeneratedNotes.length > 0) {
    console.log(`${c.cyan}  AI 生成笔记：${c.reset}`);
    result.aiGeneratedNotes.forEach(n => console.log(`    - ${n}`));
  }

  ok('AI 路径生成完成！');
  return result;
}

async function handleReviewNote() {
  const count = parseInt(cmdArgs[0] || '5');
  const { service } = await createService(opts.vault);

  const { ids, content } = service.generateReviewNote(count);
  console.log(`${c.bold}📝 今日复习笔记${c.reset}\n`);
  console.log(`   待复习: ${ids.length} 项\n`);
  console.log(content);

  if (ids.length === 0) {
    ok('今日无待复习内容！');
  }
}

async function handleRecordReview() {
  const noteId = cmdArgs[0];
  const rating = parseInt(cmdArgs[1] || '');
  if (!noteId || ![1, 2, 3, 4].includes(rating)) {
    fail('用法: node scripts/longrn-cli.mjs record-review <笔记ID> <评分 1-4>\n  1=Again  2=Hard  3=Good  4=Easy');
  }
  const { service } = await createService(opts.vault);
  const result = await service.recordReview(noteId, rating);
  const labels = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  ok(`已记录 ${noteId} 为 ${labels[rating]} | 下次复习: ${result.intervalDays} 天后 | 稳定性: ${result.stability.toFixed(1)}`);
}

async function handleSetStatus() {
  const noteId = cmdArgs[0];
  const status = cmdArgs[1];
  if (!noteId || !status) {
    fail('用法: node scripts/longrn-cli.mjs set-status <笔记ID> <状态>\n  状态: planned | in_progress | mastered | archived');
  }
  const validStatuses = ['planned', 'in_progress', 'mastered', 'archived', 'unknown'];
  if (!validStatuses.includes(status)) {
    fail(`无效状态: ${status}。支持: ${validStatuses.join(', ')}`);
  }
  const { service } = await createService(opts.vault);
  await service.setStatus(noteId, status);
  ok(`${noteId} → ${status}`);
}

// ── 桥接模式命令 ──────────────────────────────────────────────

async function handleVaultPath() {
  const topic = cmdArgs.join(' ');
  if (!topic) fail('用法: node scripts/longrn-cli.mjs vault-path <主题>');
  checkObsidian();
  console.log(`${c.bold}🔍 从 Vault 扫描「${topic}」学习路径...${c.reset}\n`);
  const result = obsEval(
    `(async () => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded. 请先安装并启用 Longrn 插件。';
      try {
        return JSON.stringify(await p.generateVaultPathCLI(${JSON.stringify(topic)}));
      } catch(e) { return 'ERROR:' + e.message; }
    })()`,
    opts.vault
  );
  try {
    const data = JSON.parse(result);
    console.log(`路径长度: ${data.steps || 0} 个节点`);
    ok('Vault 路径生成完成！');
  } catch {
    console.log(result);
  }
}

async function handleVaultSemantic() {
  const query = cmdArgs.join(' ');
  if (!query) fail('用法: node scripts/longrn-cli.mjs vault-semantic <查询>');
  checkObsidian();
  console.log(`${c.bold}🧠 语义搜索「${query}」...${c.reset}\n`);
  const result = obsEval(
    `(async () => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded';
      try {
        return JSON.stringify(await p.generateSemanticPathCLI(${JSON.stringify(query)}));
      } catch(e) { return 'ERROR:' + e.message; }
    })()`,
    opts.vault
  );
  try {
    const data = JSON.parse(result);
    console.log(`语义匹配结果: ${data.pathLength || 0} 个节点`);
    ok('语义路径生成完成！');
  } catch {
    console.log(result);
  }
}

async function handleVaultState() {
  const topic = cmdArgs.join(' ');
  if (!topic) fail('用法: node scripts/longrn-cli.mjs vault-state <主题>');
  checkObsidian();
  console.log(`${c.bold}📊 状态感知路径「${topic}」...${c.reset}\n`);
  const result = obsEval(
    `(async () => {
      const p = app.plugins.plugins['longrn-learning-path'];
      if (!p) return 'ERROR:plugin not loaded';
      try {
        return JSON.stringify(await p.generateStateAwarePathCLI(${JSON.stringify(topic)}));
      } catch(e) { return 'ERROR:' + e.message; }
    })()`,
    opts.vault
  );
  try {
    const data = JSON.parse(result);
    console.log(`已跳过掌握: ${data.skippedCount || 0} | 路径节点: ${data.pathLength || 0}`);
    ok('状态感知路径生成完成！');
  } catch {
    console.log(result);
  }
}

// ── 入口 ──────────────────────────────────────────────────────

switch (command) {
  case '--help': case '-h': printHelp(); break;
  case 'stats': await handleStats(); break;
  case 'due': await handleDue(); break;
  case 'path-tree': await handlePathTree(); break;
  case 'ai-path': await handleAIPath(); break;
  case 'review-note': await handleReviewNote(); break;
  case 'record-review': await handleRecordReview(); break;
  case 'set-status': await handleSetStatus(); break;
  case 'vault-path': await handleVaultPath(); break;
  case 'vault-semantic': await handleVaultSemantic(); break;
  case 'vault-state': await handleVaultState(); break;
  default:
    console.error(`${c.red}未知命令:${c.reset} ${command || '(未指定)'}\n`);
    printHelp();
    process.exit(1);
}
