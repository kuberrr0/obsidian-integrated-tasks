import { MarkdownView, TFile, type App } from "obsidian";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";

/** Reconcile every open note without changing focus or reusing another tab. */
export class TaskModeController {
  private pending = false;
  private running?: Promise<void>;
  private disposed = false;
  constructor(private readonly app: App, private readonly enabled: () => boolean, private readonly isProject: (path: string) => boolean) {}

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

  private async drain(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const leaves = [...this.app.workspace.getLeavesOfType("markdown"), ...this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)];
      for (const leaf of leaves) {
        if (this.disposed) return;
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file && this.enabled() && this.isProject(view.file.path)) {
          const path = view.file.path;
          const markdownState = view.getState();
          await leaf.setViewState({ type: TASK_MAIN_VIEW, state: { mode: "all", pagePath: path, markdownState } });
        } else if (view instanceof TaskMainView) {
          const state = view.getState();
          // Dedicated task-manager/project dashboards remain task views. Only
          // file-backed views have pagePath and an editor state to restore.
          const path = typeof state.pagePath === "string" ? state.pagePath : undefined;
          if (!path || (this.enabled() && this.isProject(path))) continue;
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) continue;
          const markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState as Record<string, unknown> : {};
          await leaf.setViewState({ type: "markdown", state: { ...markdownState, file: file.path } });
        }
      }
    }
  }
}
