# 示例 SDD：Longrn — 终生学习者智能学习路径系统

文档元信息
- 标题：Longrn SDD
- 版本：0.2
- 作者：项目团队
- 日期：2026-04-24
- 状态：优化版

## 1. 概述
Longrn 是一个面向终生学习者的智能学习路径系统，深度集成 Obsidian 与 Logseq，用知识图谱与语义搜索为用户生成个性化学习路径，并自动生成结构化笔记与双链。

系统通过扫描用户的本地笔记库，构建知识图谱，分析现有知识状态，根据用户指定的学习目标生成最优学习路径，并自动创建结构化笔记，建立双向链接。

## 2. 目标与成功标准
- **自动构建知识图谱**：从用户笔记库提取标题、标签、链接，生成语义索引和向量嵌入。
- **个性化路径生成**：基于用户目标和现有知识状态，使用图算法生成至少两种路径（快速入门和深入学习）。
- **自动笔记生成**：根据路径批量生成 Markdown 笔记，自动插入内部链接。
- **验收标准**：
  - 在测试 Vault 上，自动生成并链接 3 个连续主题笔记。
  - CI 通过单元测试（覆盖率 >80%）、集成测试（路径生成准确率 >90%）。
  - 用户界面响应时间 <2s。

## 3. 主要功能需求
### FR-1: 扫描并解析本地 Vault/Graph
- **描述**：读取 Obsidian Vault 或 Logseq Graph 中的 Markdown 文件，提取元数据。
- **输入**：Vault/Graph 路径。
- **输出**：Note 对象列表。
- **优先级**：高。
- **验收**：解析 100 个文件，提取标题、标签、链接准确率 >95%。

### FR-2: 构建个人知识图谱与语义索引
- **描述**：基于提取数据，构建图结构，生成向量嵌入。
- **算法**：使用 TF-IDF 或预训练模型（如 Sentence Transformers）生成嵌入。
- **存储**：本地 JSON 或向量 DB。
- **验收**：图节点数 >100，相似性搜索准确率 >80%。

### FR-3: 生成学习路径
- **描述**：接受目标主题，生成路径（快速/深入）。
- **算法**：图遍历（BFS/DFS），结合用户知识状态过滤。
- **输出**：路径数组，可导出为 Canvas 或 Markdown。
- **验收**：生成路径覆盖目标，步骤逻辑连贯。

### FR-4: 批量生成笔记并链接
- **描述**：为路径步骤生成笔记，自动链接相关概念。
- **模板**：使用预定义模板渲染内容。
- **验收**：生成笔记包含正确链接，无重复。

## 4. 系统架构（高层）
- **客户端插件**：
  - Obsidian 插件：使用 Obsidian API 扫描 Vault，注册命令。
  - Logseq 插件：使用 Logseq SDK 扫描 Graph，注册 slash 命令。
- **核心引擎**：
  - 知识库构建引擎：解析文件，构建图。
  - 路径规划器：搜索算法生成路径。
  - 笔记生成器：模板引擎和链接器。
- **存储**：
  - 本地 Markdown 文件。
  - 可选：向量数据库（ChromaDB）存储嵌入。
- **依赖**：TypeScript, Node.js; 可选：Python for embeddings (via subprocess)。

架构图（文本）：
```
[插件] -> [核心引擎] -> [存储]
   |           |           |
Obsidian   构建/规划/生成   Markdown/向量DB
Logseq
```

## 5. 模块划分
### 5.1 知识库构建引擎
- **职责**：扫描、解析、构建图谱。
- **关键函数**：
  - `scanVault(path: string): Note[]` — 扫描目录，返回 Note 数组。
  - `parseNote(content: string): {title: string, tags: string[], links: string[]}` — 解析单个文件。
  - `buildGraph(notes: Note[]): KnowledgeGraph` — 构建图，节点为 Note，边为链接。
  - `generateEmbeddings(notes: Note[]): void` — 使用模型生成向量。
- **算法**：解析使用正则表达式提取 [[links]] 和 #tags。
- **错误处理**：文件不存在抛出 Error，解析失败跳过并记录。
- **示例代码**（TypeScript）：
  ```typescript
  interface Note {
    id: string;
    title: string;
    path: string;
    content: string;
    tags: string[];
    links: string[];
    embeddings?: number[];
  }

  function scanVault(vaultPath: string): Note[] {
    const files = fs.readdirSync(vaultPath).filter(f => f.endsWith('.md'));
    return files.map(file => {
      const content = fs.readFileSync(path.join(vaultPath, file), 'utf-8');
      const parsed = parseNote(content);
      return { id: uuidv4(), title: parsed.title, path: file, content, ...parsed };
    });
  }
  ```

### 5.2 路径规划器
- **职责**：生成学习路径。
- **关键函数**：
  - `planPath(target: string, graph: KnowledgeGraph, userKnowledge: Set<string>): Path[]` — 生成路径数组。
- **算法**：
  - 快速路径：BFS 从目标到已知节点，优先短路径。
  - 深入路径：DFS 探索相关分支，考虑嵌入相似性。
  - 过滤：排除用户已掌握节点（基于 tags 或内容匹配）。
- **输出**：Path = {steps: Note[], type: 'quick' | 'deep'}。
- **示例**：
  ```typescript
  function planPath(target: string, graph: KnowledgeGraph): Path {
    // BFS implementation
    const queue = [graph.getNode(target)];
    const visited = new Set();
    const path = [];
    while (queue.length) {
      const node = queue.shift();
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      path.push(node);
      // Add neighbors
    }
    return { steps: path, type: 'quick' };
  }
  ```

### 5.3 智能笔记生成器
- **职责**：生成笔记并链接。
- **关键函数**：
  - `generateNote(step: Note, template: string): string` — 渲染内容。
  - `autoLink(content: string, kb: Map<string, Note>): string` — 插入 [[links]]。
- **模板**：Markdown 模板，如 `# ${title}\n\n${content}\n\n相关：[[link1]]`。
- **算法**：链接基于标题匹配，排序长标题优先。
- **示例**：见 obsidian-plugin/main.ts 中的 autoLinkContent。

### 5.4 插件适配层
- **Obsidian**：继承 Plugin 类，注册命令，调用核心函数。
- **Logseq**：使用 logseq.ready，注册 slash 命令。
- **接口**：统一 API，如 `generatePath(target: string): Promise<void>`。

## 6. 接口示例
- **插件命令**：
  - Obsidian: `this.addCommand({id: 'generate-learning-path', name: '生成学习路径', callback: async () => { const kb = await buildKnowledgeBase(); const path = planPath('目标', kb); await generateNotes(path); }})`
  - Logseq: `logseq.Editor.registerSlashCommand('生成学习路径', async () => { ... })`
- **内部函数签名**：
  - `buildKnowledgeBase(vaultPath: string): Promise<Map<string, Note>>`
  - `planPath(target: string, kb: Map<string, Note>): Path[]`
  - `generateNotes(path: Path, vaultPath: string): Promise<void>`
- **导出格式**：文件夹结构，如 `learning-path/1-step1.md`，内容包含链接。

## 7. 数据模型
- **Note**:
  - `id: string` — UUID。
  - `title: string` — 文件名或第一行 #标题。
  - `path: string` — 相对路径。
  - `content: string` — 全文。
  - `tags: string[]` — #tag 列表。
  - `links: string[]` — [[link]] 列表。
  - `embeddings: number[]` — 向量数组（可选）。
- **KnowledgeGraph**:
  - `nodes: Map<string, Note>` — 节点映射。
  - `edges: Map<string, {from: string, to: string, type: 'link' | 'tag'}>` — 边映射。
- **Path**:
  - `steps: Note[]` — 步骤顺序。
  - `type: string` — 路径类型。

## 8. 部署与运行
- **本地运行**：
  - 插件：安装到 Obsidian/Logseq，运行命令。
  - CLI：`node cli.js --vault /path/to/vault --target "主题"`，使用 scripts/build-plugins.sh 构建。
- **CI**：GitHub Actions，运行 `npm run build && npm test`，使用 Jest for tests。
- **依赖安装**：`npm install`，可选向量库如 `chroma-js`。

## 9. 测试计划
- **单元测试**：
  - 测试 parseNote：输入 "# Title\n#tag [[link]]"，输出正确。
  - 测试 buildGraph：验证节点和边。
- **集成测试**：
  - 在示例 Vault，运行生成路径，检查输出文件和链接。
  - 性能：扫描 1000 文件 <5s。
- **验收测试**：手动验证路径逻辑和笔记质量。

## 10. 风险与缓解
- **风险**：插件 API 变化。缓解：使用抽象层，定期更新。
- **风险**：向量生成性能。缓解：本地模型或缓存。
- **风险**：用户数据隐私。缓解：仅本地处理，无上传。

附录：参考 Longrn 项目 README 与原型代码片段（docs/ 及 src/ 文件）
