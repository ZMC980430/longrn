/**
 * LearningPathTreeGenerator — Phase 4 核心模块
 *
 * 将用户输入的主题（如"学TypeScript"）递归分解为知识点树，
 * 不依赖 vault 中已有的笔记，从零生成结构化的学习路径笔记。
 *
 * ## 工作流程
 * 1. 用户输入主题 + 配置参数（深度、每层节点数、风格）
 * 2. `generatePathTree()` 将主题拆解为多层知识树
 * 3. `renderTreeToMarkdown()` 将树渲染为 Markdown 笔记集合
 * 4. `crossLinkGeneratedNotes()` 在笔记间自动建立 [[wikilink]]
 * 5. 去重保护：同名笔记跳过或添加后缀
 *
 * @see docs/SDD.md §5.11
 *
 * Phase 5 扩展：接收 LLMClient 后可调用 AI 生成真实的笔记内容。
 * @see docs/SDD.md §5.13
 */

import { LLMClient, LLMConfig } from './llm-client.js';

// ── 数据模型 ──────────────────────────────────────────────────

/** 单篇路径笔记在树中的位置 */
export interface PathTreeNode {
  /** 笔记标题（也是文件名，不含扩展名） */
  title: string;
  /** 一句话摘要 */
  summary: string;
  /** Markdown 正文内容（模板渲染完成后赋值） */
  content: string;
  /** 子知识点（下一层） */
  children: PathTreeNode[];
  /** 同级兄弟节点的标题列表（用于交叉链接） */
  siblingTitles: string[];
  /** 父节点标题（根节点为空） */
  parentTitle?: string;
}

/** 完整的路径树 */
export interface LearningPathTree {
  /** 用户输入的主题 */
  topic: string;
  /** 当前递归深度 */
  depth: number;
  /** 最大递归深度 */
  maxDepth: number;
  /** 每层节点数 */
  nodesPerLayer: number;
  /** 根节点下的知识点列表 */
  nodes: PathTreeNode[];
}

/** 笔记渲染风格 */
export type NoteStyle = 'map' | 'tutorial' | 'cheatsheet';

/** AI 生成结果包装 */
export interface AIGenerationResult {
  tree: LearningPathTree;
  /** 实际使用了 AI 生成 */
  usedAI: boolean;
  /** AI 生成内容的笔记文件名列表 */
  aiGeneratedNotes: string[];
  /** 降级到模板的笔记文件名列表 */
  templatedNotes: string[];
}

/** Phase 4 配置参数，与 Obsidian 设置联动 */
export interface PathTreeConfig {
  maxDepth: number;
  nodesPerLayer: number;
  style: NoteStyle;
}

export const DEFAULT_TREE_CONFIG: PathTreeConfig = {
  maxDepth: 2,
  nodesPerLayer: 5,
  style: 'map',
};

// ── 主题分解策略 ──────────────────────────────────────────────

/**
 * 通用知识点阶段 — 适用于任何主题的知识架构。
 * 每个阶段对应学习进度的一个递进层次。
 */
const GENERIC_STAGES = [
  { id: 'basics', label: '入门基础' },
  { id: 'core', label: '核心概念' },
  { id: 'intermediate', label: '进阶知识' },
  { id: 'advanced', label: '高级主题' },
  { id: 'practice', label: '实践应用' },
];

/**
 * 为给定的主题生成一个阶段配比描述。
 * 例如 "TypeScript" → ["TypeScript入门", "TypeScript类型系统", ...]
 */
function generateTopicSubtitles(topic: string, count: number, stageId: string): string[] {
  const titles: string[] = [];
  const cleanTopic = topic.replace(/^(学会|学习|了解|掌握|学|如何学习|如何学会)/, '').trim();

  switch (stageId) {
    case 'basics':
      titles.push(`${cleanTopic}入门`);
      titles.push(`${cleanTopic}基础概念`);
      if (count > 2) titles.push(`${cleanTopic}环境与工具`);
      break;
    case 'core':
      titles.push(`${cleanTopic}核心要素`);
      titles.push(`${cleanTopic}数据类型`);
      if (count > 2) titles.push(`${cleanTopic}关键API`);
      break;
    case 'intermediate':
      titles.push(`${cleanTopic}进阶使用`);
      titles.push(`${cleanTopic}常见模式`);
      if (count > 2) titles.push(`${cleanTopic}最佳实践`);
      break;
    case 'advanced':
      titles.push(`${cleanTopic}高级特性`);
      titles.push(`${cleanTopic}性能与优化`);
      if (count > 2) titles.push(`${cleanTopic}底层原理`);
      break;
    case 'practice':
      titles.push(`${cleanTopic}项目实战`);
      titles.push(`${cleanTopic}调试与测试`);
      if (count > 2) titles.push(`${cleanTopic}工具生态`);
      break;
    default:
      titles.push(`${cleanTopic}深入探索`);
      titles.push(`${cleanTopic}进阶方向`);
      break;
  }

  return titles.slice(0, count);
}

/**
 * 生成一个知识点的摘要（一句话描述）。
 */
function generateSummary(topic: string, title: string): string {
  const cleanTopic = topic.replace(/^(学会|学习|了解|掌握|学|如何学习|如何学会)/, '').trim();
  return `「${title}」是掌握 ${cleanTopic} 的关键环节，涵盖该领域的核心知识点和实践方法。`;
}

/**
 * 生成节点正文（Markdown）。
 */
function generateContent(topic: string, node: PathTreeNode, style: NoteStyle): string {
  const cleanTopic = topic.replace(/^(学|学习|学会|了解|掌握)/, '').trim();

  const sections: string[] = [
    `## 📖 概述`,
    '',
    `${node.summary}`,
    '',
    `## 🎯 学习目标`,
    '',
    `- 理解「${node.title}」的核心概念`,
    `- 掌握${cleanTopic}中与本节相关的关键知识点`,
    `- 能够独立完成相关实践练习`,
    '',
    `## 📝 主要内容`,
    '',
    `### 1. 基本概念`,
    '',
    `${cleanTopic} 中的「${node.title}」是一个重要的组成部分。`,
    '学习时应从基础概念入手，逐步深入理解其工作原理和使用方法。',
    '',
    `### 2. 关键要点`,
    '',
    `- 理解 ${node.title} 的定义和用途`,
    `- 掌握常用的 API 和操作方法`,
    `- 了解与其他概念的相互关系`,
    '',
    `### 3. 实践示例`,
    '',
    '```',
    `// TODO: 补充 ${node.title} 的代码/实践示例`,
    '```',
    '',
  ];

  if (node.children.length > 0) {
    sections.push(`## 🔗 相关子知识点`, '');
    for (const child of node.children) {
      sections.push(`- [[${child.title}]]：${child.summary}`);
    }
    sections.push('');
  }

  if (node.parentTitle) {
    sections.push(`---`, '');
    sections.push(`> 🔙 返回上级：[[${node.parentTitle}]]`);
    sections.push('');
  }

  if (node.siblingTitles.length > 0) {
    sections.push(`## 📎 同级知识点`, '');
    sections.push(`本节内容属于同一学习阶段，建议按顺序学习：`);
    sections.push('');
    for (const sibling of node.siblingTitles) {
      if (sibling !== node.title) {
        sections.push(`- [[${sibling}]]`);
      }
    }
    sections.push('');
  }

  sections.push(`---`, '');
  sections.push(`*该笔记由 Longrn 自动生成，内容为结构性框架，具体细节请补充完善。*`);

  return sections.join('\n');
}

// ── 核心生成器 ────────────────────────────────────────────────

/**
 * 路径树生成器 — 将用户输入的主题递归分解为知识点树。
 */
export class LearningPathTreeGenerator {
  /**
   * 生成完整的路径知识树。
   *
   * @param topic - 用户输入的主题（如"学TypeScript"）
   * @param maxDepth - 最大递归深度（1-3，默认 2）
   * @param nodesPerLayer - 每层节点数（3-10，默认 5）
   */
  generatePathTree(
    topic: string,
    maxDepth: number = DEFAULT_TREE_CONFIG.maxDepth,
    nodesPerLayer: number = DEFAULT_TREE_CONFIG.nodesPerLayer,
  ): LearningPathTree {
    const cleanTopic = topic.replace(/^(学会|学习|了解|掌握|学|如何学习|如何学会)/, '').trim();
    const tree: LearningPathTree = {
      topic,
      depth: 0,
      maxDepth,
      nodesPerLayer,
      nodes: [],
    };

    // Level 1: 按通用学习阶段生成
    const stagesToUse = GENERIC_STAGES.slice(0, nodesPerLayer);
    tree.nodes = stagesToUse.map((stage, i) => {
      return this.generateNode(topic, stage.id, nodesPerLayer, 0, maxDepth);
    });

    return tree;
  }

  /**
   * 递归生成单个树节点。
   */
  private generateNode(
    topic: string,
    stageId: string,
    nodesPerLayer: number,
    currentDepth: number,
    maxDepth: number,
    parentTitle?: string,
  ): PathTreeNode {
    const subtitles = generateTopicSubtitles(topic, nodesPerLayer, stageId);
    const title = subtitles[0] || `${topic}进阶探索`;

    const node: PathTreeNode = {
      title,
      summary: generateSummary(topic, title),
      content: '',
      children: [],
      siblingTitles: subtitles,
      parentTitle,
    };

    // 递归生成子节点
    if (currentDepth < maxDepth - 1) {
      const childStageIds = GENERIC_STAGES.slice(0, Math.min(nodesPerLayer, GENERIC_STAGES.length));
      node.children = childStageIds.map((childStage) =>
        this.generateNode(title, childStage.id, nodesPerLayer, currentDepth + 1, maxDepth, title)
      );
    }

    return node;
  }

  // ── 渲染 ─────────────────────────────────────────────────────

  /**
   * 将路径树渲染为 Markdown 笔记集合。
   *
   * @returns Map<文件名, Markdown内容>
   */
  renderTreeToMarkdown(
    tree: LearningPathTree,
    style: NoteStyle = DEFAULT_TREE_CONFIG.style,
  ): Map<string, string> {
    const result = new Map<string, string>();
    const cleanTopic = tree.topic.replace(/^(学|学习|学会|了解|掌握)/, '').trim();

    // 1. 生成主路径笔记
    const mainNote = this.renderMainPathNote(tree, cleanTopic, style);
    result.set(mainNote.title, mainNote.content);

    // 2. 为每个节点生成子笔记
    for (const node of tree.nodes) {
      this.renderNoteRecursive(node, style, result, tree.topic);
    }

    return result;
  }

  /** 渲染主路径笔记（概览页面） */
  private renderMainPathNote(
    tree: LearningPathTree,
    cleanTopic: string,
    style: NoteStyle,
  ): { title: string; content: string } {
    const title = `${cleanTopic}学习路径`;

    const lines: string[] = [
      `# 📚 ${cleanTopic} 学习路径`,
      '',
      `> 本路径由 Longrn 自动生成，为你规划学习 ${cleanTopic} 的递进路线。`,
      '',
      `---`,
      '',
      `## 🗺️ 学习路线总览`,
      '',
      `通过以下 ${tree.nodes.length} 个阶段，系统性地掌握 ${cleanTopic}：`,
      '',
    ];

    for (let i = 0; i < tree.nodes.length; i++) {
      const node = tree.nodes[i];
      lines.push(`### ${i + 1}. ${node.title}`);
      lines.push('');
      lines.push(node.summary);
      lines.push('');
      lines.push(`🔗 [[${node.title}]]`);
      lines.push('');
    }

    lines.push(`---`, '');
    lines.push(`## 📊 学习路径配置`, '');
    lines.push(`- **递归深度**：${tree.maxDepth} 层`);
    lines.push(`- **每层节点数**：${tree.nodesPerLayer} 个`);
    lines.push(`- **笔记风格**：${style === 'map' ? '知识导图' : style === 'tutorial' ? '教程' : '速查表'}`);
    lines.push('');
    lines.push(`---`, '');
    lines.push(`*该笔记由 Longrn 自动生成，为结构性学习框架，请根据实际情况补充完善。*`);

    return {
      title: `${title}.md`,
      content: lines.join('\n'),
    };
  }

  /** 递归渲染子笔记 */
  private renderNoteRecursive(
    node: PathTreeNode,
    style: NoteStyle,
    result: Map<string, string>,
    topic: string,
  ): void {
    // 生成正文
    node.content = generateContent(topic, node, style);

    const fileName = `${node.title}.md`;
    result.set(fileName, node.content);

    // 递归渲染子节点
    for (const child of node.children) {
      this.renderNoteRecursive(child, style, result, topic);
    }
  }

  // ── 交叉链接 ────────────────────────────────────────────────

  /**
   * 在生成的笔记之间自动建立双向 [[wikilink]] 引用。
   * 遍历所有笔记内容，将其他笔记的标题替换为 wikilink。
   */
  crossLinkGeneratedNotes(notes: Map<string, string>): Map<string, string> {
    const titles = Array.from(notes.keys()).map((k) => k.replace(/\.md$/, ''));
    const linked = new Map<string, string>();

    for (const [fileName, content] of notes) {
      let processed = content;
      for (const title of titles) {
        const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!\\[\\[)${escapedTitle}(?!\\]\\])`, 'g');
        processed = processed.replace(regex, (match) => `[[${match}]]`);
      }
      linked.set(fileName, processed);
    }

    return linked;
  }

  // ── 去重保护 ────────────────────────────────────────────────

  /**
   * 检查笔记标题是否与 vault 中已有笔记冲突。
   * 返回去重后的文件名（冲突时添加后缀）。
   *
   * @param fileName - 原始文件名
   * @param existingFiles - vault 中已存在的文件名列表
   */
  deduplicateFileName(fileName: string, existingFiles: string[]): string {
    if (!existingFiles.includes(fileName)) return fileName;

    const base = fileName.replace(/\.md$/, '');
    const ext = '.md';
    let counter = 1;
    let deduped = `${base}-副本${counter}${ext}`;
    while (existingFiles.includes(deduped)) {
      counter++;
      deduped = `${base}-副本${counter}${ext}`;
    }
    return deduped;
  }

  // ── Phase 5: AI-Powered Generation ─────────────────────────

  /**
   * AI 模式生成路径树 + 笔记内容。
   * 1. 先用模板生成基本树结构
   * 2. 若 LLM 可用，用 AI 生成真实内容替换模板占位符
   * 3. 部分失败时自动降级到模板
   */
  async generateAIPathTree(
    topic: string,
    llmClient: LLMClient,
    llmConfig: LLMConfig,
    maxDepth: number = DEFAULT_TREE_CONFIG.maxDepth,
    nodesPerLayer: number = DEFAULT_TREE_CONFIG.nodesPerLayer,
    style: NoteStyle = DEFAULT_TREE_CONFIG.style,
  ): Promise<AIGenerationResult> {
    const result: AIGenerationResult = {
      tree: this.generatePathTree(topic, maxDepth, nodesPerLayer),
      usedAI: true,
      aiGeneratedNotes: [],
      templatedNotes: [],
    };

    // 1. 尝试用 LLM 生成更好的树结构
    const aiNodes = await llmClient.generatePathTree(topic, nodesPerLayer, llmConfig);
    if (aiNodes && aiNodes.length > 0) {
      const converted = llmClient.convertLlmTreeToPathNodes(aiNodes, maxDepth);
      result.tree.nodes = converted as any;
    }

    // 2. 渲染笔记（模板结构 + AI 内容填充）
    const notes = this.renderTreeToMarkdown(result.tree, style);

    // 3. 逐笔记尝试用 AI 生成真实内容
    for (const [fileName, templateContent] of notes) {
      const noteTitle = fileName.replace(/\.md$/, '');

      // 查找对应节点以获取摘要
      const node = this.findNodeByTitle(result.tree.nodes as any, noteTitle);

      if (node) {
        const aiContent = await llmClient.generateNoteContent(
          topic,
          noteTitle,
          node.summary,
          node.parentTitle,
          llmConfig,
        );

        if (aiContent) {
          // 替换为该笔记的 AI 生成内容（保留标题行）
          notes.set(fileName, `# [[${noteTitle}]]\n\n` + aiContent);
          result.aiGeneratedNotes.push(fileName);
        } else {
          result.templatedNotes.push(fileName);
        }
      } else {
        result.templatedNotes.push(fileName);
      }
    }

    // 4. 重新交叉链接
    const linked = this.crossLinkGeneratedNotes(notes);
    // 将结果写回 tree（实际上 notes 内容在调用方用于创建文件）

    return result;
  }

  /** 在树中按标题查找节点 */
  private findNodeByTitle(nodes: any[], title: string): any | null {
    for (const node of nodes) {
      if (node.title === title) return node;
      if (node.children) {
        const found = this.findNodeByTitle(node.children, title);
        if (found) return found;
      }
    }
    return null;
  }
}
