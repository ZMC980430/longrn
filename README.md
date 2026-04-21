# Longrn: 终生学习者智能学习路径系统

## 项目目标

本项目目标是构建一个基于 Obsidian 和 Logseq 的智能学习路径系统，采用 SDD（软件设计文档）开发模式管理需求、架构与实现。

## 初始化工作区内容

- `Longrn.md`：系统整体方案与功能说明文档。
- `docs/SDD.md`：软件设计文档草案，包含需求、架构、模块划分与开发计划。
- `src/obsidian-plugin/main.ts`：Obsidian 插件原型入口。
- `src/logseq-plugin/main.ts`：Logseq 插件原型入口。
- `package.json` 和 `tsconfig.json`：TypeScript 开发环境配置。

## 开发流程建议

1. 先补充 `docs/SDD.md` 中的需求与架构细节。
2. 使用 `npm install` 安装 TypeScript 开发依赖。
3. 逐步实现模块：知识库构建、路径规划、笔记生成与自动链接。
4. 采用 `src/obsidian-plugin` 与 `src/logseq-plugin` 进行双平台适配。

## 快速开始

```bash
cd e:\Agent\Longrn
npm install
npm run build
```

## 结构说明

- `docs/SDD.md`：软件设计文档
- `src/obsidian-plugin`：Obsidian 插件代码
- `src/logseq-plugin`：Logseq 插件代码
