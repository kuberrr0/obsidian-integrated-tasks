import { MarkdownView, TFile, type App, type ViewState, type WorkspaceLeaf } from "obsidian";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";

/**
 * Swap a tab's view in place, as Back and Forward do (Obsidian's internal `popstate` flag): no navigation history is
 * recorded, so the note's own view never becomes a history entry that swaps again on arrival, and Forward survives.
 */
function replaceView(leaf: WorkspaceLeaf, viewState: ViewState): Promise<void> {
  return leaf.setViewState({ ...viewState, popstate: true } as ViewState);
}

/** Reconcile every open note without changing focus or reusing another tab. */
export class TaskModeController {
  private readonly savedViews = new WeakMap<WorkspaceLeaf, Record<string, unknown>>();
  private pending = false;
  private running?: Promise<void>;
  private disposed = false;
  constructor(private readonly app: App, private readonly enabled: () => boolean, private readonly isProject: (path: string) => boolean, private readonly tagForPath: (path: string) => string | undefined = () => undefined) {}

  sync(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pending = true;
    if (!this.running) this.running = Promise.resolve().then(() => this.drain()).finally(() => {
      this.running = undefined;
      if (this.pending && !this.disposed) return this.sync();
      return undefined;
    });
    return this.running;
  }
  dispose(): void { this.disposed = true; this.pending = false; }

  /**
   * The view a tab should open for `viewState`: a project's or tag's note opens straight as its task view while task
   * mode is on (instead of showing the note first and swapping), keeping the tab's remembered layout and the note's
   * own state for when task mode is turned off. Anything else opens as asked.
   */
  redirect(leaf: WorkspaceLeaf, viewState: ViewState): ViewState {
    const markdownState = viewState.state;
    const path = viewState.type === "markdown" && typeof markdownState?.file === "string" ? markdownState.file : undefined;
    if (this.disposed || !path || !this.enabled() || !(this.isProject(path) || this.tagForPath(path))) return viewState;
    return { ...viewState, type: TASK_MAIN_VIEW, state: this.taskViewState(leaf, path, markdownState ?? {}) };
  }

  /** A task view's state for a project's or tag's note, from the tab's remembered layout for it. */
  private taskViewState(leaf: WorkspaceLeaf, path: string, markdownState: Record<string, unknown>): Record<string, unknown> {
    const saved = this.savedViews.get(leaf);
    const previous = saved?.pagePath === path ? saved : {};
    const tag = this.tagForPath(path);
    const next: Record<string, unknown> = { ...previous, mode: tag ? "tags" : "all", pagePath: path, markdownState };
    if (tag) next.tag = tag; else delete next.tag;
    return next;
  }

  /** Keep remembered task-view layouts attached to a note after it is renamed. */
  renamePath(oldPath: string, newPath: string): void {
    for (const leaf of [...this.app.workspace.getLeavesOfType("markdown"), ...this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)]) {
      const saved = this.savedViews.get(leaf);
      if (saved?.pagePath !== oldPath) continue;
      const markdownState = saved.markdownState && typeof saved.markdownState === "object" ? saved.markdownState as Record<string, unknown> : undefined;
      this.savedViews.set(leaf, { ...saved, pagePath: newPath, ...(markdownState ? { markdownState: { ...markdownState, file: newPath } } : {}) });
    }
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const leaves = [...this.app.workspace.getLeavesOfType("markdown"), ...this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)];
      for (const leaf of leaves) {
        if (this.disposed) return;
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file && this.enabled() && (this.isProject(view.file.path) || this.tagForPath(view.file.path))) {
          // A note opened before it could be redirected (such as before the index was ready) swaps now.
          await replaceView(leaf, { type: TASK_MAIN_VIEW, state: this.taskViewState(leaf, view.file.path, view.getState()) });
        } else if (view instanceof TaskMainView) {
          const state = view.getState();
          // Lists such as Today have no file path. Accept projectPath as well so tabs
          // restored from older versions also follow the task-mode toggle.
          const path = typeof state.pagePath === "string" ? state.pagePath : typeof state.projectPath === "string" ? state.projectPath : undefined;
          if (!path) continue;
          const tag = this.tagForPath(path);
          if (this.enabled() && (tag || this.isProject(path))) {
            if ((tag && (state.mode !== "tags" || state.tag !== tag)) || (!tag && state.mode === "tags")) {
              await replaceView(leaf, { type: TASK_MAIN_VIEW, state: { ...state, mode: tag ? "tags" : "all", tag } });
            }
            continue;
          }
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) continue;
          const markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState as Record<string, unknown> : {};
          this.savedViews.set(leaf, { ...state, pagePath: path, projectPath: undefined });
          await replaceView(leaf, { type: "markdown", state: { ...markdownState, file: file.path } });
        }
      }
    }
  }
}
