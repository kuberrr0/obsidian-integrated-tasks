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

import TaskManagerPlugin from "../src/main";
import { TaskMainView } from "../src/task-view";
import type { TaskViewState } from "../src/types";

describe("page task view", () => {
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
    const view = new TaskMainView({} as WorkspaceLeaf, { settings: { wrapTaskTitles: false } } as TaskManagerPlugin);
    const internals = view as unknown as {
      containerEl: { children: unknown[] };
      renderHeader: () => void;
      renderFilters: () => void;
      renderTaskResults: () => void;
    };
    internals.containerEl = { children: [{}, { empty: vi.fn(), addClass: vi.fn(), classList: { toggle: vi.fn() }, createDiv: vi.fn() }] };
    vi.spyOn(internals, "renderHeader").mockImplementation(() => {});
    const filters = vi.spyOn(internals, "renderFilters").mockImplementation(() => {});
    vi.spyOn(internals, "renderTaskResults").mockImplementation(() => {});
    await view.setState({ ...state });
    expect(filters).toHaveBeenCalledOnce();
    expect(view.pagePath).toBe(state.pagePath ?? state.projectPath);
  });
});


it("defaults wrapping on while preserving a saved choice to turn it off", async () => {
  for (const [saved, expected] of [[null, true], [{ wrapTaskTitles: false }, false], [{ wrapTaskTitles: true }, true]] as const) {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    plugin.loadData = vi.fn().mockResolvedValue(saved);
    await plugin.loadSettings();
    expect(plugin.settings.wrapTaskTitles).toBe(expected);
  }
});

it("offers search only in an active project while task mode is enabled", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const focusSearch = vi.fn();
  let active: { pagePath?: string; focusSearch: () => void } | undefined = { pagePath: "Project.md", focusSearch };
  plugin.app = { workspace: { getActiveViewOfType: () => active } } as unknown as App;
  plugin.index = { isProject: (path: string) => path === "Project.md" } as never;
  const check = (plugin as unknown as { focusProjectSearch(checking: boolean): boolean }).focusProjectSearch.bind(plugin);
  plugin.settings.taskMode = false;
  expect(check(false)).toBe(false);
  plugin.settings.taskMode = true;
  expect(check(true)).toBe(true);
  expect(focusSearch).not.toHaveBeenCalled();
  expect(check(false)).toBe(true);
  expect(focusSearch).toHaveBeenCalledOnce();
  active.pagePath = "Notes.md";
  expect(check(false)).toBe(false);
  active.pagePath = undefined;
  expect(check(false)).toBe(false);
  active = undefined;
  expect(check(false)).toBe(false);
  expect(focusSearch).toHaveBeenCalledOnce();
});

it("focuses and selects the task search field without changing its value", () => {
  const view = new TaskMainView({} as WorkspaceLeaf, {} as TaskManagerPlugin);
  const input = { value: "existing query", focus: vi.fn(), select: vi.fn() };
  view.containerEl = { querySelector: () => input } as unknown as HTMLElement;
  view.focusSearch();
  expect(input.focus).toHaveBeenCalledOnce();
  expect(input.select).toHaveBeenCalledOnce();
  expect(input.value).toBe("existing query");
});
