/**
 * ApiKeyResolver — Phase 5.1 核心模块
 *
 * 灵活 API Key 获取：支持从多个来源获取 API Key，
 * 按优先级尝试，最终回退到手动输入。
 *
 * @see docs/SDD.md §6.7
 */

// ── 类型定义 ──────────────────────────────────────────────────

export type ApiKeySource = 'manual' | 'obsidian-localstorage' | 'obsidian-data-json' | 'vault-file';

export interface ApiKeySourceOptions {
  localStorageKeyName?: string;
  vaultFilePath?: string;
  vaultJsonPath?: string;
  manualKey?: string;
  vaultAdapter?: { read: (path: string) => Promise<string> };
}

// ── 核心解析器 ────────────────────────────────────────────────

export class ApiKeyResolver {
  /**
   * 按优先级从指定来源获取 API Key，失败时回退到手动输入。
   */
  async resolve(source: ApiKeySource, options: ApiKeySourceOptions): Promise<string | null> {
    switch (source) {
      case 'obsidian-localstorage': {
        const key = this.fromLocalStorage(options.localStorageKeyName || 'deepseekApiKey');
        if (key) return key;
        break;
      }
      case 'vault-file': {
        if (options.vaultAdapter && options.vaultFilePath) {
          const key = await this.fromVaultFile(
            options.vaultFilePath,
            options.vaultJsonPath || 'apiKey',
            options.vaultAdapter,
          );
          if (key) return key;
        }
        break;
      }
    }
    // 所有来源失败时回退到手动输入
    return options.manualKey || null;
  }

  /**
   * 从 Obsidian localStorage 读取 API Key。
   */
  fromLocalStorage(keyName: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(keyName);
      }
    } catch (e) {
      console.warn('ApiKeyResolver: localStorage access failed:', e);
    }
    return null;
  }

  /**
   * 从 Vault 内 JSON 文件读取 API Key。
   * 支持点号分隔的 JSON 路径表达式（如 deepseek.apiKey）。
   */
  async fromVaultFile(vaultPath: string, jsonPath: string, adapter: { read: (path: string) => Promise<string> }): Promise<string | null> {
    try {
      const content = await adapter.read(vaultPath);
      const data = JSON.parse(content);
      const parts = jsonPath.split('.');
      let value: unknown = data;
      for (const part of parts) {
        if (value == null || typeof value !== 'object') return null;
        value = (value as Record<string, unknown>)[part];
      }
      return typeof value === 'string' ? value : null;
    } catch (e) {
      console.warn('ApiKeyResolver: vault file read failed:', e);
      return null;
    }
  }
}
