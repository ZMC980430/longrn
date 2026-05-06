# Longrn 开发规范

本规范定义 longrn 项目的编码标准、命名约定和质量要求。所有代码变更必须符合本文档。

## 1. TypeScript 编码规范

### 1.1 类型安全

- **禁止 `any` 类型**：除非与第三方无类型定义的 API 交互（如 Obsidian API 内部方法），否则不允许使用 `any`。应定义精确接口或使用 `unknown` + 类型守卫。
- **类型定义文件 (.d.ts) 中的 `any`**：仅限外部 API 声明，且应尽可能标注具体类型。
- **类型断言**：优先使用 `as` 语法，避免 `<Type>` 尖括号语法。

```typescript
// ❌ bad
function process(data: any): any { return data.value; }

// ✅ good
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return String((data as Record<string, unknown>).value);
  }
  throw new Error('Invalid data');
}
```

### 1.2 未使用变量

- **禁止未使用的导入和变量**：已导入但未使用的符号必须删除。
- **命名规则**：有意保留但暂未使用的变量以 `_` 开头（如 `_unusedFuture`）。
- **函数参数**：未使用的参数以 `_` 开头或以 `_` 替代。

```typescript
// ❌ bad
import { unused } from './module.js'; // 未使用

// ✅ good
import { used } from './module.js';
// 参数暂未使用但保留接口签名
function render(content: string, _options?: RenderOptions) { ... }
```

### 1.3 模块导入

- **使用 `.js` 扩展名**：TypeScript ESM 项目中，import 路径必须带 `.js` 后缀。
- **导入顺序**：Node 内置模块 → 第三方依赖 → 项目内部模块，每组间空一行。

```typescript
// ✅ good
import { readFile } from 'node:fs/promises';

import { Plugin } from 'obsidian';

import { KnowledgeBaseBuilder } from '../core/knowledge-builder.js';
```

### 1.4 接口与类型

- **优先使用 `interface`** 定义对象结构，`type` 用于联合/交叉/工具类型。
- **导出接口要有 JSDoc**：每个导出的接口和类必须有 `/** ... */` 注释说明用途。
- **可选属性用 `?`**：明确标记可选字段。

```typescript
// ✅ good
/** LLM 客户端配置 */
export interface LLMConfig {
  /** API 端点 */
  apiEndpoint: string;
  /** API Key（Ollama 等本地服务可留空） */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 生成温度 0-2 */
  temperature: number;
  /** 是否启用 AI */
  enabled: boolean;
}
```

### 1.5 错误处理

- **不吞异常**：catch 块中必须至少 `console.warn`/`console.error` 输出错误信息。
- **异步函数使用 try-catch**：所有 async 函数的关键操作必须包裹 try-catch。
- **错误消息要有意义**：包含上下文信息（操作名、关键参数）。

```typescript
// ✅ good
try {
  await this.app.vault.create(filePath, content);
} catch (error) {
  console.error(`Longrn: Failed to create note at ${filePath}:`, error);
  new Notice(`创建笔记失败: ${error instanceof Error ? error.message : '未知错误'}`);
}
```

## 2. 代码组织规范

### 2.1 文件结构

```
src/
├── core/                  # 核心引擎（与平台无关）
│   ├── knowledge-builder.ts
│   ├── path-planner.ts
│   ├── note-generator.ts
│   └── ...
├── obsidian-plugin/       # Obsidian 插件适配层
│   ├── main.ts
│   └── manifest.json
├── logseq-plugin/         # Logseq 插件适配层
│   └── main.ts
└── types/                 # 类型声明文件
    ├── obsidian.d.ts
    └── logseq.d.ts
```

### 2.2 文件命名

- **kebab-case**：所有文件和目录名使用短横线连接（如 `knowledge-builder.ts`）。
- **模块文件名反映单一职责**：一个文件一个类/一个功能域。

### 2.3 注释风格

- **文件头注释**：每个 `.ts` 文件以 `/** ... */` 块注释开头，说明模块用途和所属 Phase。
- **函数注释**：所有导出函数/方法必须有 JSDoc（描述、参数、返回值）。
- **分区注释**：文件中用 `// ── 分区名 ──` 分隔不同逻辑区块。

```typescript
/**
 * ApiKeyResolver — Phase 5.1 核心模块
 *
 * 灵活 API Key 获取：支持从多个来源获取 API Key，
 * 按优先级尝试，最终回退到手动输入。
 *
 * @see docs/SDD.md §6.7
 */

// ── 类型定义 ──────────────────────────────────────────────────

export type ApiKeySource = 'manual' | 'obsidian-localstorage' | 'vault-file';
```

### 2.4 常量与配置

- **默认值集中定义**：与接口对应的常量放在同一文件中，命名为 `DEFAULT_XXX`。
- **魔法数字禁止**：所有数值含义必须用命名常量或枚举表达。

## 3. 质量门禁

### 3.1 ESLint

- **0 error**：提交前必须通过 `npm run lint`，不允许任何 error。
- **warning 最小化**：新代码不应引入新的 warning。

### 3.2 TypeScript 编译

- **`tsc --noEmit` 零错误**：所有代码必须通过严格类型检查。

### 3.3 构建

- **`npm run build:obsidian` 成功**：Obsidian 插件构建不得失败。

## 4. 测试规范

- 核心模块应有单元测试覆盖关键路径。
- 测试文件放在 `scripts/` 目录或以 `.test.ts` 后缀命名。

## 5. Git 规范

- **分支命名**：`feat/<描述>` / `fix/<描述>` / `docs/<描述>`。
- **提交信息**：`type: 简短描述`，如 `feat: Phase 5.1 — flexible API key sourcing`。
- **不提交构建产物**：`dist/` 已加入 `.gitignore`。

## 6. Observer/Obsidian API 使用规范

- 文件读写使用 `app.vault.adapter`，禁止直接 `fs`。
- 插件设置通过 `loadData()` / `saveData()` 持久化。
- 用户反馈使用 `new Notice()` 而非 `console.log`。
