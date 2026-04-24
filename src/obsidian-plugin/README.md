# Obsidian 插件（Longrn）

本目录包含 Obsidian 插件示例代码，演示如何在本地 Vault 上构建学习路径并生成笔记。

开发

- 在根目录运行：

```bash
npm install
npm run build
```

- 将编译输出或源文件复制到 Obsidian 插件开发目录（例如：.obsidian/plugins/longrn-learning-path-system/），在 Obsidian 开发者模式下加载插件进行调试。

命令

- generate-learning-path：生成学习路径并在 Vault 中创建笔记。