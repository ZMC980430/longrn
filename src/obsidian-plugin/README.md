# Obsidian 插件（Longrn）

本目录包含 Longrn 的 Obsidian 插件，基于知识图谱自动生成个性化学习路径、创建笔记，并支持 FSRS 间隔重复复习调度。

## 文件结构

```
src/obsidian-plugin/
├── manifest.json     # 插件清单（必需）
├── main.ts           # 插件入口
├── styles.css        # 可选样式
└── README.md         # 本文件
```

## 安装

### 手动安装

1. 构建插件：
   ```bash
   # 在项目根目录执行
   npm install
   npm run build:obsidian
   ```
2. 将 `dist/obsidian-plugin/` 目录复制到 `<你的Vault>/.obsidian/plugins/longrn-learning-path/`
3. 在 Obsidian 中：设置 → 第三方插件 → 社区插件 → 打开「已安装插件」，找到「Longrn 学习路径系统」并启用

### 自动部署

设置 `OBSIDIAN_VAULT` 环境变量后运行：
```bash
OBSIDIAN_VAULT=/path/to/your/vault ./scripts/build-plugins.sh
```

## 开发

### 必要条件

- Node.js >= 18
- npm >= 9

### 构建

```bash
# 仅构建 Obsidian 插件
npm run build:obsidian

# 构建所有（核心库 + Obsidian + Logseq 插件）
npm run build:plugins
```

构建产物输出到 `dist/obsidian-plugin/`：
- `main.js` — 打包后的插件代码（esbuild 单文件打包，`obsidian` API 标记为 external）
- `manifest.json` — 插件清单
- `styles.css` — 可选样式文件

### 调试

1. 在 Obsidian 中启用开发者模式
2. 使用「重新加载插件」命令（或 Ctrl+Shift+I 打开控制台查看日志）
3. 代码修改后重新运行 `npm run build:obsidian`，然后在 Obsidian 中重新加载插件

### 命令

| 命令 ID | 名称 | 说明 |
|---------|------|------|
| `generate-learning-path` | 生成学习路径 | 扫描 Vault 知识库，生成目标主题的学习路径并创建笔记 |
| `generate-semantic-path` | 语义生成学习路径 | 基于语义相似度生成学习路径 |
| `generate-state-aware-path` | 状态感知学习路径 | 跳过已掌握的节点，生成个性化路径 |
| `show-review-list` | 查看今日待复习列表 | 查看 FSRS 调度的待复习内容 |
| `generate-review-note` | 生成复习笔记 | 为到期内容生成复习笔记 |

## 注意事项

- 插件使用 Obsidian 的 `app.vault` API 读取和创建笔记，无需额外权限
- 语义嵌入功能依赖 `@xenova/transformers`，首次使用时需下载模型
- 学习状态持久化在 `.longrn/state.json`（在 vault 根目录）