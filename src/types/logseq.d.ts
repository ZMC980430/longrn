/**
 * Minimal type declarations for the Logseq SDK (`@logseq/libs`).
 *
 * Only declares the subset of the global `logseq` API used by Longrn:
 * - `Editor`: page/block CRUD, slash command registration
 * - `UI`: toast notifications
 * - `ready()`: plugin lifecycle callback
 *
 * At runtime, `@logseq/libs` augments the global scope.
 */
declare global {
  interface Logseq {
    Editor: {
      getAllPages(): Promise<any[]>;
      getPage(name: string): Promise<any>;
      createPage(name: string, options: Record<string, unknown>): Promise<any>;
      appendBlockInPage(pageUUID: string, content: string): Promise<void>;
      registerSlashCommand(name: string, callback: () => Promise<void>): void;
      getCurrentBlock(): Promise<any>;
    };
    UI: {
      showMsg(message: string, type: string): void;
    };
    ready(init: () => Promise<void>): Promise<void>;
  }
}

declare const logseq: Logseq;

export {};
