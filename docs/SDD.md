# 软件设计文档（SDD）

## 1. 项目概述

本项目为“终生学习者智能学习路径系统”，目标是连接用户的 Obsidian/Logseq 本地知识库，通过知识图谱与路径规划算法生成个性化学习路径，并自动创建结构化笔记和双链。

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
- 后续阶段不包含完整 AI 写作引擎、离线大模型集成等高级功能（预留接口）。

## 3. 需求说明

### 3.1 功能需求

#### Phase 1 & 2（已实现）
1. 扫描 Vault/Graph：读取用户的 Markdown 笔记与元数据。
2. 构建知识库：解析标题、标签、已有链接，形成图结构，生成语义向量嵌入。
3. 生成路径：根据用户目标与现有知识状态生成推荐学习路径（BFS/DFS/语义）。
4. 生成笔记：创建新笔记内容，并自动插入内部链接（精确匹配）。
5. 双工具适配：分别支持 Obsidian 插件与 Logseq 插件。

#### Phase 3（已实现）
6. **FR-6 学习状态管理**：持久化追踪每个知识节点的学习状态（unknown / planned / in_progress / mastered / archived），记录复习时间戳与次数。
7. **FR-7 FSRS 间隔重复调度**：实现 FSRS-5 算法，根据用户复习评分动态计算下次复习时间，每日生成待复习列表。
8. **FR-8 语义模糊自动链接**：在精确匹配基础上，利用语义嵌入对未匹配文本段进行模糊匹配，相似度超过阈值（0.75）时自动建议链接。
9. **FR-9 路径规划状态感知**：路径规划时自动排除已掌握节点，优先从计划中/进行中的节点出发，为路径步骤附加学习状态标记。

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
- 构建：`tsc`
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

### 6.4 后续迭代

1. Phase 4：本地大模型集成（Llama.cpp 等离线推理引擎）。
2. Phase 5：Canvas 集成、多领域知识图谱、CLI 工具。
3. Phase 6：协作学习、学习进度可视化仪表盘。

## 7. 文档与交付

- `Longrn.md`：总体系统说明。
- `docs/SDD.md`：正式 SDD 文档。
- `README.md`：开发引导与工作区说明。

## 8. 备注

Phase 1、Phase 2、Phase 3 均已实现并通过验证。Phase 4 待规划开发。