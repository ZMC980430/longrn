/**
 * Minimal type declarations for the Obsidian API.
 *
 * Only declares the subset of types used by the Longrn plugin:
 * - `Plugin`, `Component` — base classes for plugin lifecycle
 * - `Notice`, `PluginSettingTab`, `Setting` — UI components
 * - `Vault`, `DataAdapter`, `TFile` — file system access
 * - `Workspace`, `MetadataCache` — workspace introspection
 *
 * At runtime, these types are provided by the Obsidian app.
 * This file exists to satisfy the TypeScript compiler during development.
 */
declare module 'obsidian' {
  export class Component {
    app: App;
    load(): void;
    onload(): void;
    unload(): void;
    onunload(): void;
    registerEvent(event: any): void;
    registerDomEvent(dom: HTMLElement, event: string, callback: any): void;
    addChild<T extends Component>(component: T): T;
    removeChild<T extends Component>(component: T): T;
  }

  export class TFile {
    path: string;
    basename: string;
  }

  export interface Command {
    id: string;
    name: string;
    callback: () => void;
  }

  export class Plugin extends Component {
    manifest: PluginManifest;
    constructor(app: App, manifest: PluginManifest);
    onload(): Promise<void> | void;
    onunload(): void;
    addCommand(command: Command): Command;
    addSettingTab(settingTab: PluginSettingTab): void;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
    registerView(type: string, viewCreator: any): void;
    registerHoverLinkSource(id: string, info: any): void;
  }

  export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    minAppVersion: string;
    description: string;
    author: string;
    authorUrl: string;
    fundingUrl: string;
    isDesktopOnly: boolean;
  }

  export class Notice {
    constructor(message: string);
  }

  export abstract class SettingTab extends Component {
    icon: string;
    app: App;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    display(): void;
  }

  export abstract class PluginSettingTab extends SettingTab {
    constructor(app: App, plugin: Plugin);
    display(): void;
  }

  export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(containerEl: HTMLElement);
    setName(name: string | DocumentFragment): this;
    setDesc(desc: string | DocumentFragment): this;
    setClass(cls: string): this;
    setHeading(): this;
    setDisabled(disabled: boolean): this;
    addButton(cb: (component: any) => any): this;
    addExtraButton(cb: (component: any) => any): this;
    addText(cb: (component: any) => any): this;
    addToggle(cb: (component: any) => any): this;
    addDropdown(cb: (component: any) => any): this;
    addSearch(cb: (component: any) => any): this;
    addTextArea(cb: (component: any) => any): this;
    addColorMap(cb: (component: any) => any): this;
    addSlider(cb: (component: any) => any): this;
    addMerged(cb: (component: any) => any): this;
  }

  export class App {
    workspace: Workspace;
    vault: Vault;
    metadataCache: MetadataCache;
    fileManager: FileManager;
  }

  export class Vault {
    adapter: DataAdapter;
    getMarkdownFiles(): TFile[];
    read(file: TFile): Promise<string>;
    create(path: string, content: string): Promise<TFile>;
    getRoot(): any;
  }

  export interface DataAdapter {
    basePath: string;
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    mkdir(path: string): Promise<void>;
  }

  export class Workspace {
    onLayoutReady(callback: () => void): void;
    getActiveViewOfType(type: any): any;
  }

  export class MetadataCache {
    getFileCache(file: TFile): any;
  }

  export class FileManager {
    processFrontMatter(file: TFile, fn: (frontmatter: any) => void): Promise<void>;
  }
}
