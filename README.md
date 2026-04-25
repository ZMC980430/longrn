# Longrn: 终生学习者智能学习路径系统

项目目标

Longrn 旨在为终生学习者提供智能学习路径生成与结构化笔记功能，深度集成 Obsidian 与 Logseq。仓库采用 SDD 驱动开发（SDD-driven development），详细设计与实现说明请参见 docs/SDD.md。

快速开始

1. 安装依赖：

```bash
npm install
```

2. 构建核心库：

```bash
npm run build
```

3. 构建 Obsidian 插件（单文件打包）：

```bash
npm run build:obsidian
```

4. 构建全部（核心库 + Obsidian 插件 + Logseq 插件）：

```bash
./scripts/build-plugins.sh
```

5. 本地开发（TypeScript）：编辑 src/ 下代码并重新构建。

主要文档

- docs/SDD.md：SDD 模板与项目设计
- docs/SDD-checklist.md：SDD 完成度检查清单
- docs/sample-SDD-Longrn.md：示例 SDD
- docs/SDD_WORKFLOW.md：SDD 驱动开发流程说明

贡献与社区

请参阅 CONTRIBUTING.md 与 CODE_OF_CONDUCT.md。Issue/PR 模板位于 .github/ 目录，提交 PR 时请在 PR 描述中引用相关 SDD 节点并完成 SDD-checklist。

插件

| 插件 | 源码 | 构建方式 | 输出 |
|------|------|----------|------|
| Obsidian 插件 | `src/obsidian-plugin/` | `npm run build:obsidian`（esbuild 单文件打包） | `dist/obsidian-plugin/main.js` + `manifest.json` |
| Logseq 插件 | `src/logseq-plugin/` | `npm run build:logseq`（tsc 编译） | `dist/logseq-plugin/main.js` |
| 核心库 | `src/core/` | `npm run build`（tsc 编译） | `dist/core/` |

构建脚本：

```bash
# 仅 Obsidian 插件
npm run build:obsidian

# 全部插件
./scripts/build-plugins.sh

# 自动部署到 Obsidian vault（需设置环境变量）
OBSIDIAN_VAULT=/path/to/your/vault ./scripts/build-plugins.sh
```

持续集成

CI 配置见 .github/workflows/ci.yml；发布自动化见 .github/workflows/release.yml。

联系方式

在 Issue 区提出讨论或联系维护者。
