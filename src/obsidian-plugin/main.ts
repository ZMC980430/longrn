import { Plugin, Notice, TFile } from 'obsidian';

export default class LearningPathPlugin extends Plugin {
  app: any;

  async onload() {
    console.log('Loading Learning Path Plugin');

    this.addCommand({
      id: 'generate-learning-path',
      name: '生成学习路径',
      callback: () => void this.generateLearningPath(),
    });
  }

  async buildKnowledgeBase() {
    const files = this.app.vault.getMarkdownFiles();
    const knowledgeBase = new Map<string, { path: string; content: string }>();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      knowledgeBase.set(file.basename, {
        path: file.path,
        content,
      });
    }

    return knowledgeBase;
  }

  async autoLinkContent(content: string, knowledgeBase: Map<string, { path: string; content: string }>) {
    let processedContent = content;
    const titles = Array.from(knowledgeBase.keys()).sort((a, b) => b.length - a.length);

    for (const title of titles) {
      const regex = new RegExp(`(?<!\[\[)${title}(?!\]\])`, 'g');
      if (regex.test(processedContent)) {
        processedContent = processedContent.replace(regex, `[[${title}]]`);
      }
    }

    return processedContent;
  }

  async generateLearningPath() {
    new Notice('开始分析您的知识库...');

    const kb = await this.buildKnowledgeBase();

    const path = [
      { name: 'NumPy', content: '# NumPy\nNumPy是Python的数值计算基础库...' },
      { name: 'Pandas', content: '# Pandas\nPandas建立在[[NumPy]]之上，提供了DataFrame数据结构...' },
      { name: '数据可视化', content: '# 数据可视化\n基于[[Pandas]]，我们可以使用Matplotlib进行数据绘图...' },
    ];

    const folder = `Learning Paths/Python数据分析`;
    await this.app.vault.createFolder(folder).catch(() => {});

    for (const step of path) {
      const linkedContent = await this.autoLinkContent(step.content, kb);
      const filePath = `${folder}/${step.name}.md`;

      if (!this.app.vault.getAbstractFileByPath(filePath)) {
        await this.app.vault.create(filePath, linkedContent);
      }
    }

    new Notice('学习路径笔记生成完成！');
  }

  onunload() {
    console.log('Unloading Learning Path Plugin');
  }
}
