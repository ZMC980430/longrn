/**
 * LongrnService — Phase 5.2 统一服务层
 *
 * 聚合所有核心模块能力，提供干净的业务 API。
 * CLI 和 Obsidian 插件共用同一套逻辑，不依赖特定平台。
 *
 * ## 使用方式
 *
 * ### CLI 直接模式（无需 Obsidian）
 * ```typescript
 * const service = new LongrnService(vaultPath, defaultFileOps, longrnConfig);
 * const stats = service.getReviewStats();
 * ```
 *
 * ### Obsidian 插件模式
 * ```typescript
 * const service = new LongrnService(vaultBasePath, vaultStateFileOps, pluginSettings);
 * // 覆盖 LLMClient 使用 Obsidian requestUrl
 * service.setLLMClient(new LLMClient(obsidianRequestUrlFetcher));
 * ```
 *
 * @see docs/SDD.md §6.8
 */

import { LLMClient, LLMConfig, nodeHttpFetcher } from './llm-client.js';
import { LearningPathTreeGenerator, NoteStyle } from './path-tree-generator.js';
import { LearningStateManager, StateFileOps, LearningStatus, defaultFileOps } from './learning-state-manager.js';
import { FSRSScheduler, CardState } from './fsrs-scheduler.js';

// ── 服务配置 ──────────────────────────────────────────────────

/** Longrn 完整配置 */
export interface LongrnConfig {
  /** 学习路径笔记的输出目录（相对于 Vault 根目录） */
  outputFolder: string;
  /** 路径树生成深度（1-3） */
  maxGenerationDepth: number;
  /** 每层节点数（3-10） */
  nodesPerLayer: number;
  /** 笔记生成风格 */
  generationStyle: NoteStyle;
  /** AI 生成开关 */
  aiEnabled: boolean;
  /** OpenAI 兼容 API 端点 */
  apiEndpoint: string;
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 生成温度 */
  temperature: number;
}

/** 默认配置 */
export const DEFAULT_LONGRN_CONFIG: LongrnConfig = {
  outputFolder: 'learning-path',
  maxGenerationDepth: 2,
  nodesPerLayer: 5,
  generationStyle: 'map',
  aiEnabled: false,
  apiEndpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
};

/** 复习统计 */
export interface ReviewStats {
  total: number;
  mastered: number;
  inProgress: number;
  planned: number;
  archived: number;
}

/** 复习列表详情 */
export interface ReviewListResult {
  total: number;
  mastered: number;
  inProgress: number;
  planned: number;
  archived: number;
  dueCount: number;
}

// ── 统一服务 ──────────────────────────────────────────────────

/**
 * Longrn 统一服务 — CLI 和 GUI 共用。
 *
 * 所有业务逻辑集中于此，不包含任何 UI 操作。
 */
export class LongrnService {
  private vaultPath: string;
  private config: LongrnConfig;
  private fileOps: StateFileOps;
  private stateManager: LearningStateManager;
  private scheduler: FSRSScheduler;
  private pathTreeGenerator: LearningPathTreeGenerator;
  private llmClient: LLMClient;

  /**
   * @param vaultPath - Obsidian Vault 路径（非 Obsidian 环境可为任意目录）
   * @param fileOps - 文件 I/O 适配器
   * @param config - 配置（使用 Partial 合并到默认值）
   * @param llmClient - LLM 客户端（默认使用 NodeHttpFetcher）
   */
  constructor(
    vaultPath: string,
    fileOps?: StateFileOps,
    config?: Partial<LongrnConfig>,
    llmClient?: LLMClient,
  ) {
    this.vaultPath = vaultPath;
    this.fileOps = fileOps ?? defaultFileOps;
    this.config = { ...DEFAULT_LONGRN_CONFIG, ...config };
    this.scheduler = new FSRSScheduler();
    this.pathTreeGenerator = new LearningPathTreeGenerator();
    this.llmClient = llmClient ?? new LLMClient(nodeHttpFetcher);
    this.stateManager = new LearningStateManager(vaultPath, this.fileOps);
  }

  /** 异步初始化 — 加载持久化状态。CLI 每次调用前需 await。 */
  async init(): Promise<void> {
    await this.stateManager.loadState();
  }

  /** 替换 LLM 客户端（如 Obsidian 注入 requestUrl 适配器） */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  /** 获取配置（只读） */
  getConfig(): Readonly<LongrnConfig> {
    return this.config;
  }

  /** 获取状态管理器 */
  getStateManager(): LearningStateManager {
    return this.stateManager;
  }

  // ── 复习统计 ──────────────────────────────────────────────

  /**
   * 获取整体复习统计。
   * 无参数，纯数据查询。
   */
  getReviewStats(): ReviewStats {
    return this.stateManager.getReviewStats();
  }

  /**
   * 获取待复习列表详情。
   */
  getReviewList(): ReviewListResult {
    const stats = this.stateManager.getReviewStats();
    const dueIds = this.stateManager.getDueIds();
    return {
      ...stats,
      dueCount: dueIds.length,
    };
  }

  /**
   * 获取今日待复习节点 ID 列表。
   */
  getDueIds(): string[] {
    return this.stateManager.getDueIds();
  }

  // ── 学习状态 ──────────────────────────────────────────────

  /**
   * 设置节点学习状态。
   */
  async setStatus(noteId: string, status: LearningStatus): Promise<void> {
    await this.stateManager.setStatus(noteId, status);
  }

  /**
   * 获取节点学习状态。
   */
  getStatus(noteId: string): LearningStatus {
    return this.stateManager.getStatus(noteId);
  }

  /**
   * 记录复习评分并更新 FSRS 调度。
   * @param noteId - 笔记/节点 ID
   * @param rating - 1=Again 2=Hard 3=Good 4=Easy
   * @returns 更新后的复习卡片状态
   */
  async recordReview(noteId: string, rating: 1 | 2 | 3 | 4): Promise<CardState> {
    return this.stateManager.recordReview(noteId, rating);
  }

  // ── 路径树生成 ────────────────────────────────────────────

  /**
   * 模板模式生成学习路径树。
   * 不依赖 AI，纯算法生成。
   */
  generatePathTree(
    topic: string,
    maxDepth?: number,
    nodesPerLayer?: number,
    style?: NoteStyle,
  ) {
    const depth = maxDepth ?? this.config.maxGenerationDepth;
    const nodes = nodesPerLayer ?? this.config.nodesPerLayer;
    const tree = this.pathTreeGenerator.generatePathTree(topic, depth, nodes);
    const notes = this.pathTreeGenerator.renderTreeToMarkdown(tree, style ?? this.config.generationStyle);
    const linked = this.pathTreeGenerator.crossLinkGeneratedNotes(notes);
    return { tree, notes: linked };
  }

  /**
   * AI 模式生成学习路径树。
   * 需要配置 API Key 且 aiEnabled=true。
   * 若 AI 不可用，降级为模板模式。
   */
  async generateAIPathTree(
    topic: string,
    maxDepth?: number,
    nodesPerLayer?: number,
    style?: NoteStyle,
  ) {
    const llmConfig: LLMConfig = {
      apiEndpoint: this.config.apiEndpoint,
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      enabled: this.config.aiEnabled,
    };

    const depth = maxDepth ?? this.config.maxGenerationDepth;
    const nodes = nodesPerLayer ?? this.config.nodesPerLayer;

    return this.pathTreeGenerator.generateAIPathTree(
      topic,
      this.llmClient,
      llmConfig,
      depth,
      nodes,
      style ?? this.config.generationStyle,
    );
  }

  // ── 复习笔记 ──────────────────────────────────────────────

  /**
   * 生成今日复习笔记的 Markdown 内容。
   * @param count - 最多选取的待复习节点数（默认 5）
   * @returns 复习笔记 Markdown 及涉及的节点列表
   */
  generateReviewNote(count: number = 5): { ids: string[]; content: string } {
    const dueIds = this.stateManager.getDueIds();
    const targetIds = dueIds.length > 0 ? dueIds.slice(0, count) : [];

    if (targetIds.length === 0) {
      return { ids: [], content: '# 今日复习\n\n🎉 今日无待复习内容！\n' };
    }

    const states = this.stateManager.getAllStates();
    const lines: string[] = ['# 今日复习\n'];

    for (const id of targetIds) {
      const st = states[id];
      if (!st) continue;
      lines.push(`## ${id}\n`);
      lines.push(`上次复习: ${st.lastReviewedAt || '从未'}`);
      lines.push(`复习次数: ${st.reviewCount || 0}`);
      lines.push(`下次复习: ${st.nextReviewAt || '待定'}\n`);
      lines.push('[ ] 完全不记得 (Again)');
      lines.push('[ ] 有些困难 (Hard)');
      lines.push('[ ] 基本记得 (Good)');
      lines.push('[ ] 非常简单 (Easy)\n');
      lines.push('---\n');
    }

    return { ids: targetIds, content: lines.join('\n') };
  }
}
