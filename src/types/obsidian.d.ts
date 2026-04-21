declare module 'obsidian' {
  export class TFile {
    path: string;
    basename: string;
  }

  export interface Command {
    id: string;
    name: string;
    callback: () => void;
  }

  export class Plugin {
    app: any;
    addCommand(command: Command): void;
  }

  export class Notice {
    constructor(message: string);
  }
}
