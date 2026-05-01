/**
 * LLMClient — Phase 5 核心模块
 *
 * 封装 OpenAI Chat Completions API 协议，支持自定义 endpoint。
 * 兼容任何实现了 OpenAI 协议的大模型服务，不限于 OpenAI 自家模型。
 *
 * ## 支持的 API 示例（部分列举）
 * - OpenAI:          https://api.openai.com/v1
 * - DeepSeek:        https://api.deepseek.com/v1
 * - Qwen（通义千问）: https://dashscope.aliyuncs.com/compatible-mode/v1
 * - Groq:            https://api.groq.com/openai/v1
 * - Together AI:     https://api.together.xyz/v1
 * - Ollama（本地）:   http://localhost:11434/v1
 * - vLLM（自部署）:   http://localhost:8000/v1
 * - Claude（代理）:   需 OpenAI 兼容转发层
 * - Azure OpenAI:    https://<你的资源>.openai.azure.com/v1
 *
 * @see docs/SDD.md §5.13
 */

// ── 数据模型 ──────────────────────────────────────────────────

/** LLM 配置 — 来自插件设置 */
export interface LLMConfig {
  /** OpenAI 兼容 API 端点，支持任意兼容 OpenAI 协议的服务 */
  apiEndpoint: string;
  /** API Key（Ollama 等本地服务可留空） */
  apiKey: string;
  /** 模型名称，取决于服务商。如 gpt-4o-mini, deepseek-chat, qwen-turbo, llama3.1 (Ollama) */
  model: string;
  /** 生成温度 0-2，默认 0.7 */
  temperature: number;
  /** 是否启用 AI 生成（关闭时降级为 Phase 4 模板） */
  enabled: boolean;
}

/** 默认 LLM 配置 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  apiEndpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  enabled: false,
};

/** Chat 消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ── 核心客户端 ────────────────────────────────────────────────

/**
 * LLM 客户端 — 调用 OpenAI 兼容 API 生成内容。
 */
export class LLMClient {
  /**
   * 发送 Chat Completion 请求。
   *
   * @param messages - 消息列表（system + user + assistant）
   * @param config - LLM 配置
   * @returns LLM 响应内容及用量统计
   */
  async chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const endpoint = config.apiEndpoint.replace(/\/+$/, '') + '/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // OpenAI 需要 Authorization header；Ollama 通常不需要
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const body = {
      model: config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: config.temperature,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `LLM API 请求失败 (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json() as any;

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? config.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  // ── 路径树生成专用提示词 ──────────────────────────────────

  /** 系统提示词：主题分解为学习路径树 */
  private getPathTreeSystemPrompt(): string {
    return `你是一个学习路径规划专家。你的任务是将用户输入的学习主题拆解为多级知识树。

要求：
1. 将主题分解为 3-6 个主要阶段，从入门到进阶递进
2. 每个阶段包含 3-6 个子知识点
3. 每个知识点提供：标题（简洁，不含冒号）、一句话摘要
4. 返回纯 JSON 数组，不要 markdown 包裹
5. 标题使用中文字段名

输出格式：
[
  {
    "title": "阶段标题",
    "summary": "阶段概述",
    "children": [
      { "title": "子知识点标题", "summary": "一句话说明" }
    ]
  }
]`;
  }

  /** 用户提示词：指定主题 */
  private getPathTreeUserPrompt(topic: string, maxNodes: number): string {
    return `请将「${topic}」拆解为不超过 ${maxNodes} 个主要学习阶段，每个阶段包含 3-5 个子知识点。从基础到高级递进排列。`;
  }

  /** 系统提示词：生成笔记内容 */
  private getNoteContentSystemPrompt(): string {
    return `你是一个技术文档撰写专家。根据给定的知识点信息，生成一篇结构化的学习笔记。

注意：
- 使用 Markdown 格式
- 内容要实际有用，包含概念解释、关键要点、代码示例（如适用）
- 分为：概述、学习目标、主要内容（含示例）、总结
- 不要使用 [[wikilink]] 语法（后续由程序自动添加）
- 内容要适中，篇幅在 300-800 字之间`;
  }

  /** 用户提示词：笔记内容 */
  private getNoteContentUserPrompt(topic: string, title: string, summary: string, parentTitle?: string): string {
    let prompt = `请为「${title}」生成学习笔记。这是「${topic}」学习路径的一部分。\n\n摘要：${summary}\n`;
    if (parentTitle) {
      prompt += `\n父知识点：${parentTitle}\n`;
    }
    return prompt;
  }

  // ── 高阶生成函数 ──────────────────────────────────────────

  /**
   * 使用 LLM 生成路径树。
   * 返回 LLM 生成的 JSON 解析后的树节点数组。
   * 如果 LLM 不可用或解析失败，返回 null（调用方降级到 Phase 4 模板）。
   */
  async generatePathTree(topic: string, maxNodes: number, config: LLMConfig): Promise<any[] | null> {
    try {
      const messages: LLMMessage[] = [
        { role: 'system', content: this.getPathTreeSystemPrompt() },
        { role: 'user', content: this.getPathTreeUserPrompt(topic, maxNodes) },
      ];

      const response = await this.chat(messages, config);
      return this.parsePathTreeResponse(response.content);
    } catch (error) {
      console.warn('LLM generatePathTree failed, will fallback to template:', error);
      return null;
    }
  }

  /**
   * 使用 LLM 生成单篇笔记的 Markdown 内容。
   * 如果 LLM 不可用，返回 null。
   */
  async generateNoteContent(
    topic: string,
    title: string,
    summary: string,
    parentTitle?: string,
    config?: LLMConfig,
  ): Promise<string | null> {
    if (!config) return null;

    try {
      const messages: LLMMessage[] = [
        { role: 'system', content: this.getNoteContentSystemPrompt() },
        { role: 'user', content: this.getNoteContentUserPrompt(topic, title, summary, parentTitle) },
      ];

      const response = await this.chat(messages, config);
      return response.content;
    } catch (error) {
      console.warn(`LLM generateNoteContent failed for "${title}", will fallback:`, error);
      return null;
    }
  }

  /** 解析 LLM 返回的 JSON 树 */
  private parsePathTreeResponse(content: string): any[] | null {
    // Try to extract JSON from the response (handles code block wrapping)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed;
      // Maybe it's wrapped in an object
      if (parsed.stages || parsed.nodes) return parsed.stages || parsed.nodes;
      return null;
    } catch {
      // Try to find JSON array in the text
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * 将 LLM 生成的 JSON 树转换为 Phase 4 的 PathTreeNode 结构。
   */
  convertLlmTreeToPathNodes(
    llmNodes: any[],
    maxDepth: number,
    currentDepth: number = 0,
  ): { title: string; summary: string; content: string; children: any[]; siblingTitles: string[]; parentTitle?: string }[] {
    if (currentDepth >= maxDepth) return [];

    const titles = llmNodes.map((n: any) => n.title || n.name || '');
    const titlesSet = new Set(titles);

    return llmNodes.map((node: any, index: number) => {
      const title = node.title || node.name || '';
      const children = node.children || [];
      return {
        title,
        summary: node.summary || node.description || '',
        content: '',
        children: this.convertLlmTreeToPathNodes(children, maxDepth, currentDepth + 1) as any,
        siblingTitles: titles.filter((_, i) => i !== index),
        parentTitle: undefined,
      };
    });
  }
}
