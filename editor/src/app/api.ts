// Types shared by the Electron main process and the Angular UI. The UI reaches the main
// process only through `window.starbush` (see electron/preload.ts).

export interface AppState {
  /** Settings and token are saved. */
  configured: boolean;
  /** The website repository exists on this PC. */
  cloned: boolean;
  editorName: string;
  repoUrl: string;
}

export interface SetupInput {
  repoUrl: string;
  token: string;
  editorName: string;
}

export interface PageInfo {
  /** Folder relative to site/content, '' for the start page, e.g. "katzen/zuchtluna". */
  dir: string;
  /** "_index.md" for sections and the start page, "index.md" for normal pages. */
  file: string;
  title: string;
  /** Top-level folder ("katzen"), '' for the start page. */
  section: string;
  isSection: boolean;
  /** Menu position for sections, 0 otherwise. */
  weight: number;
}

export interface PageContent {
  title: string;
  /** Markdown without front matter. */
  body: string;
}

export interface Change {
  /** Path relative to the repository, e.g. "site/content/katzen/zuchtluna/index.md". */
  path: string;
  kind: 'neu' | 'geändert' | 'gelöscht';
}

export interface Progress {
  phase: string;
  /** 0–100, or -1 when unknown. */
  percent: number;
}

export interface SyncResult {
  updated: boolean;
  /** Local unpublished changes kept the app from updating. */
  skippedBecauseLocalChanges: boolean;
}

export interface StarbushApi {
  getState(): Promise<AppState>;
  setup(input: SetupInput): Promise<void>;
  sync(): Promise<SyncResult>;
  listPages(): Promise<PageInfo[]>;
  readPage(dir: string): Promise<PageContent>;
  savePage(dir: string, content: PageContent): Promise<void>;
  /** Saves an already resized image into the page's folder; returns the file name used. */
  addImage(dir: string, name: string, data: ArrayBuffer): Promise<string>;
  createPage(sectionDir: string, title: string): Promise<string>;
  changes(): Promise<Change[]>;
  publish(): Promise<void>;
  discard(): Promise<void>;
  previewBase(): Promise<string>;
  onProgress(callback: (progress: Progress) => void): () => void;
}

declare global {
  interface Window {
    starbush: StarbushApi;
  }
}
