import '@logseq/libs';

declare const logseq: any;

async function main() {
  console.log('Logseq Learning Path Plugin loaded');

  logseq.Editor.registerSlashCommand('生成学习路径', async () => {
    const allPages = await logseq.Editor.getAllPages();
    const kb = new Map<string, any>();
    allPages.forEach((p: any) => kb.set(p.name, p));

    const steps = [
      { title: 'NumPy', content: 'NumPy是Python的数值计算基础库' },
      { title: 'Pandas', content: 'Pandas建立在[[NumPy]]之上' },
    ];

    for (const step of steps) {
      let page = await logseq.Editor.getPage(step.title);
      if (!page) {
        page = await logseq.Editor.createPage(step.title, {});
      }
      await logseq.Editor.appendBlockInPage(page.uuid, step.content);
    }

    logseq.UI.showMsg('学习路径生成成功!', 'success');
  });
}

logseq.ready(main).catch(console.error);
