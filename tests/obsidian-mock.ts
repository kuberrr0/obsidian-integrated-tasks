export { default as moment } from "moment";

// Obsidian ships declarations only; these stand-ins exercise vault writes in Node.
export class TFile { path = ""; }
export class TFolder {}
/** Task mode wraps setViewState on the prototype, so the prototype must exist. */
export class WorkspaceLeaf { async setViewState(_viewState: unknown, _eState?: unknown): Promise<void> {} }
export const normalizePath = (path: string): string => path;
export const getAllTags = (cache: { tags?: Array<{ tag: string }>; frontmatter?: { tags?: string[] } }): string[] => [
  ...(cache.tags ?? []).map((entry) => entry.tag),
  ...(cache.frontmatter?.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`)
];

export const Platform = { isMacOS: true };

// Minimal SVG shape for note-pill decoration styles in the Node test host.
export const getIcon = (name: string) => ({
  setAttribute: () => {},
  outerHTML: `<svg xmlns="http://www.w3.org/2000/svg" data-icon="${name}" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>`
});

// Lets modules that subclass the suggest modal load; tests that open one mock it fully.
export class FuzzySuggestModal {
  limit = 100;
  constructor(public app: unknown) {}
  setPlaceholder(): void {}
  open(): void {}
  close(): void {}
}
export const renderResults = (): void => {};

// Minimal lifecycle for Markdown render children (task query blocks, note checkboxes).
export class MarkdownRenderChild {
  private cleanups: Array<() => unknown> = [];
  constructor(public containerEl: HTMLElement) {}
  onload(): void {}
  onunload(): void {}
  load(): void { this.onload(); }
  unload(): void { for (const cleanup of this.cleanups.splice(0)) cleanup(); this.onunload(); }
  register(cleanup: () => unknown): void { this.cleanups.push(cleanup); }
}
