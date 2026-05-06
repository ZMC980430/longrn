# 软件设计文档（SDD）

## 1. 项目概述

本项目为"终生学习者智能学习路径系统"，目标是连接用户的 Obsidian/Logseq 本地知识库，通过知识图谱与路径规划算法生成个性化学习路径，并自动创建结构化笔记和双链。

## 2. 目标与范围

### 2.1 目标
- 自动扫描本地笔记库，生成个人知识库和知识图谱。
- 根据用户目标规划学习路径，结合现有知识状态生成最优学习顺序。
- 自动生成 Markdown 笔记，并为新内容创建双向链接。
- 支持 Obsidian 和 Logseq 两种主流笔记工具。

### 2.2 范围
- **Phase 1（已完成）**：笔记扫描、知识库构建、路径规划、自动链接和双工具插件原型。
- **Phase 2（已完成）**：语义向量嵌入、向量存储持久化、语义路径规划、向后兼容。
- **Phase 3（已完成）**：学习状态管理、FSRS 间隔重复调度、语义模糊自动链接、路径规划状态感知增强。
- **Phase 3.1（已完成）**：去除硬编码、增加 Modal 交互输入、插件设置系统、修复 `fs`→vault API 文件操作。
- **Phase 4（已完成）**：用户输入驱动的内容生成——不依赖已有笔记，从零生成学习路径。
- **Phase 5（规划中）**：AI 内容生成——接入 OpenAI 兼容协议的大模型，生成真实的笔记内容。
- 后续阶段不包含完整 AI 写作引擎、离线大模型集成等高级功能（预留接口）。

## 3. 需求说明

### 3.1 功能需求

#### Phase 1 & 2（已实现）
1. 扫描 Vault/Graph：读取用户的 Markdown 笔记与元数据。
2. 构建知识库：解析标题、标签、已有链接，形成图结构，生成语义向量嵌入。
3. 生成路径：根据用户目标与现有知识状态生成推荐学习路径（BFS/DFS/语义）。
4. 生成笔记：创建新笔记内容，并自动插入内部链接（精确匹配）。
5. 双工具适配：分别支持 Obsidian 插件与 Logseq 插件。

#### Phase 3 & 3.1（已实现）
6. **FR-6 学习状态管理**：持久化追踪每个知识节点的学习状态（unknown / planned / in_progress / mastered / archived），记录复习时间戳与次数。
7. **FR-7 FSRS 间隔重复调度**：实现 FSRS-5 算法，根据用户复习评分动态计算下次复习时间，每日生成待复习列表。
8. **FR-8 语义模糊自动链接**：在精确匹配基础上，利用语义嵌入对未匹配文本段进行模糊匹配，相似度超过阈值（0.75）时自动建议链接。
9. **FR-9 路径规划状态感知**：路径规划时自动排除已掌握节点，优先从计划中/进行中的节点出发，为路径步骤附加学习状态标记。

#### Phase 4（已完成）

10. **FR-10 用户输入驱动的学习路径生成**：
    - 用户输入学习主题（如"学TypeScript"、"机器学习入门"），插件不依赖已有 vault 笔记，直接生成一份完整的学习路径笔记。
    - **主路径笔记**：一次性生成包含主题概述、分阶段学习步骤、核心概念清单、推荐资源（书籍/课程）的结构化 Markdown 笔记。
    - **递归细化**：主路径笔记中的每个子知识点自动成为可点击的入口，支持逐层展开生成更细粒度的子笔记。
    - **多层深度**：支持设置递归深度（默认 2 层），例如输入"TypeScript" → 主路径笔记 → 子笔记（基础类型/接口/泛型等）→ 孙笔记（每个子属性的详细说明）。
    - **不与现有笔记冲突**：若 vault 中已有同名笔记，自动跳过或合并，不覆盖已有内容。
    - **路径笔记不添加学习状态**：路径笔记为纯参考内容，不进入 learning state 管理流程。
11. **FR-11 可配置的生成粒度**：
    - 提供滑块/输入框控制生成深度（1-3 层）和每层笔记数量（3-10 个）。
    - 支持选择生成风格：知识导图风格 / 教程风格 / 速查表风格。
12. **FR-12 跨笔记自动链接**：
    - 生成的所有笔记之间自动建立双向 `[[wikilink]]` 链接。
    - 子笔记中自动引用父笔记和相关兄弟笔记。

#### Phase 5（规划中）

13. **FR-13 AI 学习路径内容生成**：
    - 启用 AI 模式时，调用 LLM 生成真正的学习路径知识点结构和笔记内容。
    - 每条笔记包含对知识点有实际帮助的文本、示例、代码片段等。
    - AI 生成内容遵循 Phase 4 的树结构和交叉链接规则。
14. **FR-14 自定义 LLM 配置**：
    - 支持配置自定义 API endpoint（兼容 OpenAI 协议即可）。
    - 支持配置 API Key、Model、Temperature 等参数。
    - 提供「启用 AI」开关，关闭时降级为 Phase 4 模板生成。

### 3.2 非功能需求
- 扩展性：模块化设计，方便后续添加算法与插件适配。
- 可维护性：使用清晰的设计文档与类型化代码。
- 可测试性：为核心逻辑留出单元测试入口。

## 4. 架构设计

### 4.1 模块划分

- `知识库构建引擎`：扫描笔记、解析链接、构建图谱。
- `个人知识图谱`：存储用户已掌握与待学知识点。
- `学习路径规划器`：根据目标与知识状态生成路径。
- `智能笔记生成器`：生成笔记内容并做自动链接。
- `平台适配层`：Obsidian 与 Logseq 插件入口。

### 4.2 技术选型
- 语言：TypeScript
- 构建：
  - 核心库：`tsc`（TypeScript 编译器）
  - Obsidian 插件：`esbuild`（单文件打包，`obsidian` API 标记为 external）
  - Logseq 插件：`tsc`（TypeScript 编译器）
- 插件平台：Obsidian 与 Logseq SDK

## 5. 模块详细设计

### 5.1 知识库构建引擎

输入：笔记文件、页面列表、已有链接
输出：节点集合、边集合、文本索引

职责：
- 读取 Markdown 内容
- 提取标题、标签、双链
- 生成语义索引占位结构

### 5.2 向量存储模块

输入：向量数据、唯一标识符、哈希值
输出：持久化的向量存储文件、刷新状态

职责：
- 提供向量的插入、更新、删除操作。
- 支持向量存储的持久化与加载。
- 提供向量刷新状态的检查功能。

### 5.3 语义路径规划器

输入：查询语句、知识图谱、嵌入引擎
输出：基于语义相关性的学习路径

职责：
- 结合语义嵌入生成与相似度计算，规划学习路径。
- 支持多步路径生成，输出路径得分。

### 5.4 向后兼容性

职责：
- 确保非语义路径规划功能的正常运行。
- 提供基于传统方法的路径规划支持。

### 5.5 智能笔记生成器

职责：
- 生成结构化笔记文本
- 使用最长匹配优先策略自动插入双链
- 对新增内容进行内部互联

### 5.6 平台适配层

- Obsidian：`app.vault`、`metadataCache`、命令注册
- Logseq：`logseq.Editor`、页面与块操作、Slash 命令

### 5.7 学习状态管理器（Phase 3）

输入：Note ID、状态变更事件
输出：持久化状态文件 `.longrn/state.json`

职责：
- 为知识图谱节点维护五种状态：`unknown`、`planned`、`in_progress`、`mastered`、`archived`
- 记录状态变更时间戳与累计复习次数
- 持久化到 `.longrn/state.json`，启动时自动加载
- 提供批量查询接口：`getMasteredIds()`、`getPlannedIds()`、`getStaleIds(days)`

数据模型：
- `LearningState { noteId, status, lastReviewedAt?, nextReviewAt?, reviewCount, easeFactor, stability }`
- `StateIndex { updatedAt, entries: Record<string, LearningState> }`

### 5.8 FSRS 复习调度器（Phase 3）

输入：复习评分（Again=1 / Hard=2 / Good=3 / Easy=4）、当前卡片状态
输出：下次复习时间、更新后的稳定性与难度因子

职责：
- 实现 FSRS-5 算法核心：指数遗忘曲线建模记忆衰减，动态调整 stability/difficulty
- 每日生成待复习列表（到期或即将到期的卡片）
- 生成复习笔记模板（含回顾内容与评分按钮）
- 支持"快速复习"模式：对 mastered 节点定期抽查

关键函数：
- `schedule(rating, current: CardState): CardState`
- `getDueCards(stateIndex: StateIndex): string[]`

### 5.9 语义模糊自动链接器（Phase 3）

输入：待处理文本、知识库 Map、EmbeddingEngine、相似度阈值
输出：含 `[[wikilink]]` 的处理后文本

职责：
- 第一层（已有）：精确短语匹配 — 最长匹配优先
- 第二层（新增）：语义模糊匹配 — 分句嵌入后余弦相似度计算，阈值默认 0.75
- 跨笔记互联增强：批量新笔记两两计算语义相似度，自动建立双向链接

关键函数：
- `semanticAutoLink(content, kb, engine, threshold?): Promise<string>`
- `crossLinkBatch(notes, engine, threshold?): Promise<Note[]>`

### 5.10 路径规划器状态感知增强（Phase 3）

职责：
- 集成 LearningStateManager，自动读取学习状态
- 默认排除 `mastered` 节点，从 `planned`/`in_progress` 节点出发
- Path 接口扩展：新增 `states?: LearningState['status'][]` 字段

### 5.11 智能路径内容生成器（Phase 4 新增）

输入：用户输入的主题文本（如"学TypeScript"）、配置参数（深度、数量、风格）
输出：主路径笔记 + 多层子笔记的 Markdown 文件集合

职责：
- **主题分解引擎**：将用户输入的主题拆解为递进的子知识点列表，支持多层递归。
- **笔记模板系统**：提供多套 Markdown 模板（知识导图 / 教程 / 速查表），根据配置选择。
- **交叉链接引擎**：生成的所有笔记之间自动建立双向 `[[wikilink]]` 引用。
- **去重保护**：检查 vault 中是否已有同名笔记，存在则跳过或追加"副本"后缀。

数据模型：
```typescript
interface LearningPathTree {
  topic: string;             // 用户输入的主题
  depth: number;             // 当前递归深度
  maxDepth: number;          // 最大递归深度
  nodes: PathTreeNode[];     // 该层的知识点节点
}

interface PathTreeNode {
  title: string;             // 知识点标题
  summary: string;           // 一句话摘要
  content: string;           // Markdown 正文内容（模板渲染后）
  children: PathTreeNode[];  // 子知识点（下一层）
  parent?: PathTreeNode;     // 父节点引用
  siblings?: string[];       // 同级兄弟节点标题列表（用于交叉链接）
}
```

关键函数：
- `generatePathTree(topic: string, maxDepth: number, nodeCount: number): LearningPathTree`
- `renderTreeToMarkdown(tree: LearningPathTree, style: 'map' | 'tutorial' | 'cheatsheet'): Map<string, string>`
- `crossLinkGeneratedNotes(notes: Map<string, string>): Map<string, string>`

### 5.12 配置系统增强（Phase 4）

Phase 4 扩展插件设置项：
- `maxGenerationDepth`: 生成递归深度（1-3，默认 2）
- `nodesPerLayer`: 每层知识节点数量（3-10，默认 5）
- `generationStyle`: 笔记风格（map/tutorial/cheatsheet，默认 map）

## 6. 开发计划

### 6.1 Phase 1（已完成）—— 核心引擎与插件原型

1. 设计并实现 `src/core` 中的知识库构建器、路径规划器、笔记生成器。
2. 完成 Obsidian 插件原型：扫描、路径生成、笔记创建。
3. 完成 Logseq 插件原型：路径生成逻辑适配页面/块操作。

### 6.2 Phase 2（已完成）—— 语义向量与智能搜索

1. 实现 EmbeddingEngine：基于 @xenova/transformers 加载 all-MiniLM-L6-v2 模型。
2. 实现 VectorStore：向量持久化、内容哈希校验、增量刷新、相似度搜索。
3. 实现 semanticPath：语义查询 → 目标匹配 → 相似度排序路径。
4. 确保向后兼容：非语义 planPath 继续可用。

### 6.3 Phase 3（已完成）—— 学习状态管理与智能复习

1. 实现 LearningStateManager：五状态模型、持久化、批量查询。
2. 实现 FSRSScheduler：FSRS-5 算法、待复习列表、复习笔记生成。
3. 实现 SemanticAutoLinker：语义模糊匹配、跨笔记互联增强。
4. 增强 PathPlanner：集成学习状态，排除已掌握节点，附加状态标记。
5. 编写单元测试与集成测试 — 6 组验证全部通过。

### 6.4 Phase 3.1（已完成）—— 去除硬编码与插件可运行化

**背景**：Phase 3 的 Obsidian 插件中包含大量硬编码内容（目标主题、查询文本、复习数量等），仅用于验证流程可走通，无法作为独立插件正常使用。

**改造内容**：
1. **新增 `TargetInputModal`**：弹出式文本输入框，用户在运行路径生成命令时可自由输入学习目标或语义查询文本，替代硬编码的 `'Python数据分析'` 和 `'数据分析'`。
2. **新增插件设置系统**（`LongrnPluginSettings`）：
   - `semanticThreshold`（语义相似度阈值，默认 0.75）
   - `quickReviewCount`（快速复习节点数，默认 5）
   - `dueReviewLimit`（每日复习上限，默认 10）
   - `outputFolder`（笔记输出目录，默认 `learning-path`）
3. **升级 `LongrnSettingTab`**：从纯说明页面变为可交互设置页，支持滑块和文本输入调整上述参数。
4. **修复 `generateReviewNote`**：
   - 使用 `app.vault.createFolder` / `app.vault.create` 替代裸 `fs` 操作
   - 复习数量改用设置项 `quickReviewCount` / `dueReviewLimit`
   - 复习笔记输出到可配置的 `outputFolder` 子目录
5. **更新 `note-generator.ts`**：`generateNotes` 方法新增可选参数 `outputSubfolder`，支持自定义输出目录。文件名正则支持中文字符。
6. **优化状态管理初始化**：新增 `ensureStateManager()` 延迟初始化方法，确保 `onLayoutReady` 回调未触发时也能正常使用。

### 6.5 Phase 4（规划中）—— 用户输入驱动的学习路径生成

**目标**：用户无需在 vault 中预先创建任何笔记，输入主题即可从零生成完整的学习路径笔记树。

**核心功能**：
1. **实现 `LearningPathTreeGenerator` 模块**：将用户输入的主题递归分解为知识点树。
2. **实现多模板渲染引擎**：支持知识导图 / 教程 / 速查表三种风格。
3. **新增 `generate-learning-path-tree` 命令**：弹出配置对话框（主题 + 深度 + 风格），生成路径树。
4. **路径笔记自动交叉链接**：同级、父子节点之间自动建立双向 `[[wikilink]]`。
5. **配置扩展**：新增 `maxGenerationDepth`、`nodesPerLayer`、`generationStyle` 设置项。
6. **去重保护**：检测 vault 中已存在的同名笔记，自动跳过或添加副本标记。

**验证**：
- 输入"学TypeScript"，生成包含 3-5 个核心章节的主路径笔记
- 每个章节自动生成子笔记（默认 2 层深度）
- 笔记间 `[[wikilink]]` 交叉引用正确
- 重复生成不覆盖已有笔记

### 6.6 Phase 5（已完成）—— AI 内容生成（通用 OpenAI 协议）

**目标**：接入任何兼容 OpenAI Chat Completions API 协议的大模型服务（不限于 OpenAI 自家模型），
为 Phase 4 的路径树生成提供 AI 赋能的笔记内容，替代模板化占位符。

**协议兼容性**：遵循 OpenAI Chat Completions API 协议的服务均可接入，包括但不限于：
- OpenAI（GPT-4o、GPT-4o-mini 等）
- DeepSeek（deepseek-chat）
- Qwen 通义千问（qwen-turbo、qwen-plus）
- Groq（llama、mixtral 等开源模型）
- Together AI
- Ollama（本地运行的开源模型，llama3、qwen2 等）
- vLLM（自部署的开源模型）
- Azure OpenAI
- 任何兼容 OpenAI 协议的 API 代理

**核心功能**：
1. **LLMClient 模块**：封装 OpenAI Chat Completions API，endpoint 完全可配，不绑定特定服务商。
2. **AI 主题分解**：用 LLM 将用户输入的主题拆解为真实的知识点树（而非通用阶段模板）。
3. **AI 内容填充**：每个知识点笔记由 LLM 生成真正的内容（概念解释、关键要点、示例代码等）。
4. **回退机制**：LLM 不可用时（无 API Key / 服务不可达），自动降级使用 Phase 4 模板生成。
5. **设置项扩展**：`apiEndpoint`（默认 https://api.openai.com/v1）、`apiKey`（本地服务可空）、`model`（默认 gpt-4o-mini）、`temperature`（默认 0.7）。

**新增需求**：

#### Phase 5（规划中）

13. **FR-13 AI 学习路径内容生成**：
    - 启用 AI 模式时，调用 LLM 生成真正的学习路径知识点结构和笔记内容。
    - 每条笔记包含对知识点有实际帮助的文本、示例、代码片段等。
    - AI 生成内容遵循 Phase 4 的树结构和交叉链接规则。
14. **FR-14 自定义 LLM 配置**：
    - 支持配置自定义 API endpoint（兼容 OpenAI 协议即可）。
    - 支持配置 API Key、Model、Temperature 等参数。
    - 提供「启用 AI」开关，关闭时降级为 Phase 4 模板生成。

#### 模块详细设计

### 5.13 LLM 客户端（Phase 5 新增）

输入：系统提示词、用户提示词、配置参数
输出：LLM 生成的 JSON 或 Markdown 文本

职责：
- 封装 OpenAI Chat Completions API，endpoint 完全可配置，不绑定特定服务商
- 支持流式与非流式响应
- 错误处理和自动重试
- 兼容一切实现了 OpenAI Chat Completions API 协议的服务

数据模型：
```typescript
interface LLMConfig {
  apiEndpoint: string;   // 默认 https://api.openai.com/v1
  apiKey: string;
  model: string;         // 默认 gpt-4o-mini
  temperature: number;   // 默认 0.7
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

关键函数：
- `chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>`
- `generatePathTree(topic: string): Promise<PathTreeNode[]>`
- `generateNoteContent(node: PathTreeNode): Promise<string>`

### 6.7 Phase 5.1（规划中）—— 灵活 API Key 获取

**背景**：当前 Phase 5 实现要求用户在插件设置页面手动输入 API Key。
在实际使用中，Obsidian 自身具备 API Key 存储能力（通过 `localStorage` 或 Obsidian 内部 Provider 配置），
用户希望复用这些已存储的 Key，避免在多处重复配置。

**目标**：支持从 Obsidian 存储中自动获取 API Key，同时模型/端点/温度等参数仍由插件设置控制。

**核心需求 — FR-15 灵活 API Key 获取**：
1. **API Key 来源选择**：插件设置新增 `apiKeySource` 字段，支持以下来源：
   - `"manual"` — 手动输入（当前行为，保留兼容）
   - `"obsidian-localstorage"` — 从 Obsidian 的 `localStorage` 读取
   - `"obsidian-data-json"` — 从 Obsidian 全局 `data.json`（`~/.obsidian/`）读取
   - `"vault-file"` — 从 Vault 内指定 JSON 文件读取
2. **Obsidian localStorage 读取**：
   - 利用 Obsidian Plugin API 可直接访问 `localStorage`
   - 支持配置 Key 名称（如 `openaiApiKey`、`deepseekApiKey`）
   - 自动从 Obsidian 内置 AI Provider 配置中查找对应服务的 API Key
3. **Obsidian data.json 读取**：
   - 读取 Obsidian 用户配置目录下的全局设置文件
   - 解析其中的 Provider/AI 配置获取 API Key
4. **Vault 文件读取**：
   - 支持指定 Vault 内的 JSON 文件路径（相对于 Vault 根目录）
   - 支持指定 JSON 路径表达式（如 `providers.deepseek.apiKey`）
5. **Key 解析优先级**：
   - 先尝试从选定来源获取 → 若失败则回退到 `apiKey` 手动输入值
   - 每次调用 `getLLMConfig()` 时动态解析（不缓存到插件设置中）
6. **设置 UI 更新**：
   - API Key 设置区域增加「来源」下拉选择
   - 选择不同来源时动态显示对应的配置字段
   - 手动模式下显示 API Key 输入框（当前行为）
   - Obsidian 模式下显示 Key 名称配置
   - Vault 文件模式下显示文件路径和 JSON 路径配置

**数据模型**：
```typescript
interface LongrnPluginSettings {
  // ... existing fields ...
  /** API Key 来源 */
  apiKeySource: 'manual' | 'obsidian-localstorage' | 'obsidian-data-json' | 'vault-file';
  /** localStorage 中的 Key 名称（apiKeySource=obsidian-localstorage 时使用） */
  apiKeyLocalStorageName: string;
  /** Vault 内 JSON 文件路径（apiKeySource=vault-file 时使用） */
  apiKeyVaultFilePath: string;
  /** JSON 文件中的 Key 路径表达式（apiKeySource=vault-file 时使用） */
  apiKeyVaultJsonPath: string;
  /** 手动输入的 API Key（apiKeySource=manual 时使用，保留兼容） */
  apiKey: string;
}
```

**关键函数**：
```typescript
class ApiKeyResolver {
  /** 根据配置从指定来源解析 API Key */
  resolve(settings: LongrnPluginSettings, app: App): Promise<string>;
  /** 从 localStorage 读取 */
  fromLocalStorage(keyName: string): string | null;
  /** 从 Obsidian 全局 data.json 读取 */
  fromObsidianDataJson(providerName: string): Promise<string | null>;
  /** 从 Vault 内文件读取 */
  fromVaultFile(vaultPath: string, jsonPath: string, app: App): Promise<string | null>;
}
```

**验证**：
- 选择「手动」来源，输入 API Key，AI 生成正常工作
- 选择「Obsidian localStorage」来源，配置 Key 名称，AI 生成正常工作
- 选择「Vault 文件」来源，创建测试 JSON 文件，AI 生成正常工作
- 所有来源均失败时，给出明确提示而非静默失败
- 切换来源后无需重启 Obsidian 即可生效

### 6.8 Phase 6（规划中）—— 高级可视化

（原 Phase 5，顺延至 Phase 6）

1. Obsidian Canvas 集成。
2. 多领域知识图谱可视化。
3. CLI 工具。

### 6.8 Phase 7（规划中）—— 协作与社交

（原 Phase 6，顺延至 Phase 7）

1. 协作学习功能。
2. 学习进度可视化仪表盘。
3. 社区资源共享。

## 7. 文档与交付

- `Longrn.md`：总体系统说明。
- `docs/SDD.md`：正式 SDD 文档。
- `README.md`：开发引导与工作区说明。

## 8. 备注

Phase 1、Phase 2、Phase 3、Phase 3.1、Phase 4、Phase 5 均已实现并通过验证。Phase 5.1 为当前开发阶段。
