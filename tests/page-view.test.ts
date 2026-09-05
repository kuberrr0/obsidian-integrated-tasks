import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  Plugin: class {},
  ItemView: class {},
  MarkdownView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  Notice: class {},
  Setting: class {},
  setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));

import { MarkdownView, TFile } from "obsidian";
import TaskManagerPlugin from "../src/main";
import { TaskMainView, TASK_MAIN_VIEW } from "../src/task-view";
import type { TaskViewState } from "../src/types";

describe("page task view", () => {
  it("toggles a regular note in the same leaf and restores its Markdown state", async () => {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    const file = Object.assign(new TFile(), { path: "Notes.md", extension: "md" });
    const markdownState = { file: file.path, mode: "source", source: true };
    const markdown = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file, getState: () => markdownState });
    const leaf = { view: markdown, setViewState: vi.fn() };
    Object.assign(markdown, { leaf });
    plugin.app = { workspace: { getActiveViewOfType: (type: typeof MarkdownView) => leaf.view instanceof type ? leaf.view : null }, vault: { getAbstractFileByPath: () => file } } as unknown as App;
    await plugin.togglePageTaskView();
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: TASK_MAIN_VIEW, active: true, state: { mode: "all", pagePath: "Notes.md", markdownState } });
    const view = new TaskMainView(leaf as unknown as WorkspaceLeaf, plugin);
    vi.spyOn(view, "render").mockImplementation(() => {});
    await view.setState(leaf.setViewState.mock.calls[0][0].state);
    Object.assign(leaf, { view });
    Object.assign(view, { leaf });
    await plugin.togglePageTaskView();
    expect(leaf.setViewState).toHaveBeenLastCalledWith({ type: "markdown", active: true, state: markdownState });
  });

  it.each(["navigation", "tasks"])("waits for %s reveal and propagates reveal failures", async (target) => {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    const leaf = { view: { getState: () => ({}) }, setViewState: vi.fn().mockResolvedValue(undefined) };
    let rejectReveal!: (error: Error) => void;
    const revealed = new Promise<void>((_resolve, reject) => { rejectReveal = reject; });
    const revealLeaf = vi.fn(() => revealed);
    plugin.app = { workspace: { getLeavesOfType: () => [leaf], revealLeaf } } as unknown as App;
    const operation = target === "navigation" ? plugin.activateNavigation() : plugin.openTaskView({ mode: "today" });
    const settled = vi.fn();
    void operation.then(settled, settled);
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(leaf));
    expect(settled).not.toHaveBeenCalled();
    const failure = new Error("Could not reveal view");
    rejectReveal(failure);
    await expect(operation).rejects.toThrow(failure);
  });

  it.each<TaskViewState>([
    { mode: "inbox" }, { mode: "today" }, { mode: "upcoming" }, { mode: "all" },
    { mode: "projects", projectPath: "Project.md" }, { mode: "all", pagePath: "Notes.md" }
  ])("renders shared controls for $mode $pagePath $projectPath", async (state) => {
    const view = new TaskMainView({} as WorkspaceLeaf, {} as TaskManagerPlugin);
    const internals = view as unknown as {
      containerEl: { children: unknown[] };
      renderHeader: () => void;
      renderFilters: () => void;
      renderTaskResults: () => void;
    };
    internals.containerEl = { children: [{}, { empty: vi.fn(), addClass: vi.fn(), createDiv: vi.fn() }] };
    vi.spyOn(internals, "renderHeader").mockImplementation(() => {});
    const filters = vi.spyOn(internals, "renderFilters").mockImplementation(() => {});
    vi.spyOn(internals, "renderTaskResults").mockImplementation(() => {});
    await view.setState({ ...state });
    expect(filters).toHaveBeenCalledOnce();
    expect(view.pagePath).toBe(state.pagePath ?? state.projectPath);
  });
});
