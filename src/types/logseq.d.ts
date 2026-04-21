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
