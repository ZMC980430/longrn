# AGENTS.md — Longrn 开发指南

> 为 AI 代理和人类协作者准备的代码库速查手册。只记录无法从单个文件推断的知识。

## 项目定位

Longrn 是一个 **Obsidian + Logseq 双平台插件**，为终生学习者自动生成个性化学习路径。所有代码由 AI 生成，采用 **SDD 驱动开发**（设计文档在 `docs/SDD.md`）。

## 核心命令

| 命令 | 作用 | 说明 |
|------|------|------|
| `npm run build` | 编译核心库 | `tsc -p tsconfig.json`，输出到 `dist/core/` |
| `npm run build:obsidian` | 打包 Obsidian 插件 | esbuild 单文件打包 → `dist/obsidian-plugin/` |
| `npm run build:logseq` | 编译 Logseq 插件 | tsc 编译 → `dist/logseq-plugin/` |
| `npm run build:plugins` | 构建全部 + 可选部署 | `bash scripts/build-plugins.sh` |
| `npm run lint` | ESLint 检查 | `eslint . --ext .ts` |
| `npm test` | 不存在，CI 中 `|| true` | 用手动脚本 `node scripts/phase3-test.mjs` 验证 |

**构建前必须先 `npm run build`（核心库），再构建插件。** Obsidian 插件不走 tsc，esbuild 直接从 `src/` 读取 `.ts` 源码打包。

## 模块系统与导入规则

```typescript
// ✅ 必须带 .js 后缀（"module": "NodeNext", "moduleResolution": "NodeNext"）
import { Note } from './knowledge-builder.js';
import { Plugin } from 'obsidian';  // external，esbuild 不打包

// ✅ 导入顺序：Node 内置 → 第三方 → 项目内部（空行分隔）
import { readFile } from 'node:fs/promises';
import { Plugin } from 'obsidian';
import { KnowledgeBaseBuilder } from '../core/knowledge-builder.js';
```

## 目录结构

```
src/
├── core/                  # 平台无关引擎（被两个插件共享）
│   ├── knowledge-builder.ts    # 笔记扫描、解析、图谱构建、语义嵌入
│   ├── embedding-engine.ts     # Transformers.js 封装（all-MiniLM-L6-v2）
│   ├── vector-store.ts         # 嵌入持久化缓存（.longrn/embeddings.json）
│   ├── path-planner.ts         # BFS/DFS/语义路径生成
│   ├── note-generator.ts       # 笔记模板渲染 + 精确匹配自动链接
│   ├── learning-state-manager.ts  # 学习状态生命周期管理
│   ├── fsrs-scheduler.ts       # FSRS-5 间隔重复调度
│   ├── semantic-auto-linker.ts # 两层链接：精确匹配 + 语义模糊匹配
│   ├── path-tree-generator.ts  # Phase 4 主题→知识点树分解
│   ├── llm-client.ts           # Phase 5 OpenAI 兼容协议大模型客户端
│   └── api-key-resolver.ts     # Phase 5.1 多来源 API Key 解析
├── obsidian-plugin/
│   └── main.ts            # Obsidian 插件入口（注册 7 个命令 + 设置页）
├── logseq-plugin/
│   └── main.ts            # Logseq 插件入口（注册 5 个 Slash 命令）
└── types/                 # 第三方库类型声明（.d.ts）
    ├── obsidian.d.ts
    ├── logseq.d.ts
    └── transformers.d.ts
```

Obsidian 插件设置页在 `main.ts` 的 `LongrnSettingTab` 类中（不单独文件）。

## 关键架构模式

### 文件系统抽象：`StateFileOps`

核心模块需要读写文件，但 Obsidian 插件必须走 `app.vault.adapter`（异步），Node.js 环境用 `fs`（同步）。折衷方案：

```typescript
// src/core/learning-state-manager.ts 中定义
export interface StateFileOps {
  exists(filePath: string): boolean | Promise<boolean>;
  mkdir(dirPath: string): void | Promise<void>;
  readFile(filePath: string): string | Promise<string>;
  writeFile(filePath: string, data: string): void | Promise<void>;
}
```

- **Node.js 默认**：`defaultFileOps`（sync `fs` 方法）
- **Obsidian**：`vaultStateFileOps`（async vault adapter 方法）
- **VectorStore** 和 **LearningStateManager** 都接受可选的 `StateFileOps` 参数

### Phase 演进

代码标注了所属 Phase：
- **Phase 1–2**（基础）：图谱构建、BFS/DFS 路径、语义嵌入
- **Phase 3**：学习状态管理、FSRS 复习、语义链接、状态感知路径
- **Phase 4**：不依赖已有笔记的路径树生成（模板驱动）
- **Phase 5**：LLM 生成真实笔记内容（OpenAI 兼容协议）
- **Phase 5.1**：多来源 API Key 解析
- **Phase 5.2**：计划中（CLI 支持）

### LLM 降级策略

`LLMClient.generatePathTree()` / `generateNoteContent()` 失败时返回 `null`，调用方自动降级到 Phase 4 模板生成。`generateAIPathTree()` 统计 `aiGeneratedNotes` 和 `templatedNotes`。

## 编码规范（严格）

所有代码必须遵循 `docs/DEVELOPMENT_STANDARDS.md`：

- **禁止 `any`**（ESLint warning），用 `unknown` + 类型守卫
- **命名**：文件 kebab-case，接口 `interface`，类型别名 `type`，常量 `DEFAULT_XXX`
- **JSDoc**：所有导出接口/类/函数必须有 `/** ... */` 注释
- **分区注释**：用 `// ── 分区名 ──` 分隔代码段
- **错误处理**：catch 块必须 `console.warn`/`console.error`，消息包含上下文
- **魔法数字禁止**：用命名常量
- **未使用变量**：以 `_` 开头

## tsconfig 特殊配置

```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/obsidian-plugin"]
}
```

**Obsidian 插件源码被 tsc 排除**，因为它使用 `obsidian` 模块（external），types 声明在 `src/types/obsidian.d.ts` 中但实际类型在运行时由 Obsidian 提供。esbuild 构建脚本直接读取 `.ts` 源码打包，绕过 tsc。

## Obsidian 插件构建细节

`scripts/build-obsidian.mjs` 关键配置：
- **external**: `['obsidian']`
- **platform**: `node`
- **conditions**: `['browser']` — 让 `@xenova/transformers` 使用 WASM 后端而非 onnxruntime-node
- **esbuild plugin `stub-transformers-node-deps`**: 对 `@xenova/transformers` 内部的 `fs`/`path`/`url`/`onnxruntime-node`/`worker_threads`/`sharp` 请求返回空模块
- 产出 `dist/obsidian-plugin/main.js`（CommonJS）+ 复制 `manifest.json`

### EmbeddingEngine 的 Electron 兼容

在 Obsidian 的 Electron 渲染进程中，`process.release.name === "node"` 会触发 `@xenova/transformers` 加载 native `onnxruntime-node`。解决方案：
1. 加载前临时设 `process.release.name = "browser"`
2. esbuild 用 `conditions: ['browser']` 解析浏览器入口
3. esbuild plugin stub 掉 Node 内置模块的 `require()`
4. ONNX WASM 文件从 jsDelivr CDN 加载

## 观察：Vault API 访问私有属性

Obsidian 插件通过类型断言访问非公开属性：

```typescript
// basePath 不在 Vault/DataAdapter 公开类型中
private get vaultBasePath(): string {
  return (this.app.vault.adapter as unknown as { basePath: string }).basePath;
}
```

## 持久化数据位置

- 学习状态：`<vault>/.longrn/state.json`
- 嵌入缓存：`<vault>/.longrn/embeddings.json`
- 输出笔记：`<vault>/learning-path/`（可在设置中修改）

## 无测试框架

项目没有 Jest/Vitest 等测试框架。验证依赖：
- 手动脚本：`node scripts/phase3-test.mjs`（需先 `npm run build`）
- CI 中 `npm test || true` 永远通过
- 修改代码后需要手工验证：构建 → 加载到 Obsidian/Logseq → 运行命令

## Git 规范

- 分支：`feat/<desc>` / `fix/<desc>` / `docs/<desc>`
- 提交：`type: 简短描述`，如 `feat: Phase 5.1 — flexible API key sourcing`
- `.gitignore` 排除 `dist/`、`node_modules/`
