import { describe, expect, it, vi } from "vitest";
import { TFile, type App, type WorkspaceLeaf } from "obsidian";

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
import { scanTasks } from "../src/parser";
import type { Task, TaskViewState } from "../src/types";

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
      renderSelectionBar: () => void;
      renderTaskResults: () => void;
    };
    internals.containerEl = { children: [{}, { empty: vi.fn(), addClass: vi.fn(), classList: { toggle: vi.fn() }, createDiv: vi.fn() }] };
    vi.spyOn(internals, "renderHeader").mockImplementation(() => {});
    const filters = vi.spyOn(internals, "renderFilters").mockImplementation(() => {});
    vi.spyOn(internals, "renderSelectionBar").mockImplementation(() => {});
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
    expect(plugin.settings.wrapCalendarTaskTitles).toBe(true);
    expect(plugin.settings.wrapKanbanTaskTitles).toBe(true);
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


function selectionView() {
  const tasks = scanTasks("Work.md", "- [ ] A\n- [ ] B\n- [ ] C");
  const bulkDrop = vi.fn().mockResolvedValue([]);
  const plugin = { store: { bulkDrop }, index: { taskById: (id: string) => tasks.find(task => task.id === id), refreshPath: vi.fn() } };
  const view = new TaskMainView({} as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  const internals = view as unknown as {
    bindSelection(row: HTMLElement, task: Task): void;
    prepareDrag(task: Task): void;
    dropListTask(task: Task, group?: unknown, anchor?: Task, placement?: string): Promise<void>;
  };
  const rows = tasks.map(task => {
    const handlers = new Map<string, (event: unknown) => void>();
    const classes = new Map<string, boolean>();
    const row = { classList: { toggle: (key: string, value: boolean) => classes.set(key, value) },
      setAttribute: vi.fn(), focus: vi.fn(), closest: () => undefined,
      addEventListener: (key: string, callback: (event: unknown) => void) => handlers.set(key, callback)
    };
    internals.bindSelection(row as unknown as HTMLElement, task);
    const click = (options: Record<string, unknown> = {}) => {
      const event = { target: row, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...options };
      handlers.get("click")!(event);
      return event;
    };
    const contextmenu = (target: unknown = row) => {
      const event = { target, preventDefault: vi.fn() };
      handlers.get("contextmenu")!(event);
      return event;
    };
    return { row, classes, click, contextmenu };
  });
  return { view, internals, tasks, rows, bulkDrop };
}

it("selects block backgrounds and ranges without intercepting title or checkbox clicks", () => {
  const { view, rows } = selectionView();
  rows[0].click();
  rows[2].click({ shiftKey: true });
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["A", "B", "C"]);
  for (const row of rows) expect(row.classes.get("is-selected")).toBe(true);
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  expect(rows[1].click({ target: title }).preventDefault).not.toHaveBeenCalled();
  expect(view.getSelectedTasks()).toHaveLength(3);
  rows[1].click();
  rows[2].click({ metaKey: true });
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["B", "C"]);
});

it("drags the selected set as one operation and starts a new selection when dragging an unselected task", async () => {
  const { view, internals, rows, tasks, bulkDrop } = selectionView();
  rows[0].click(); rows[2].click({ metaKey: true });
  internals.prepareDrag(tasks[2]);
  await internals.dropListTask(tasks[2], undefined, tasks[1], "after");
  expect(bulkDrop).toHaveBeenCalledExactlyOnceWith([tasks[0], tasks[2]], undefined, tasks[1], "after");
  expect(view.getSelectedTasks()).toEqual([]);
  rows[0].click();
  internals.prepareDrag(tasks[1]);
  expect(view.getSelectedTasks()).toEqual([tasks[1]]);
});

it("offers Edit task properties only for an active view with selected tasks", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  let selected: Task[] = [];
  let active: { getSelectedTasks: () => Task[] } | undefined = { getSelectedTasks: () => selected };
  plugin.app = { workspace: { getActiveViewOfType: () => active } } as unknown as App;
  const open = vi.spyOn(plugin, "openBulkEditor").mockImplementation(() => {});
  const check = (plugin as unknown as { editSelectedTaskProperties(checking: boolean): boolean }).editSelectedTaskProperties.bind(plugin);
  expect(check(false)).toBe(false);
  selected = scanTasks("Work.md", "- [ ] Selected");
  expect(check(true)).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(check(false)).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith(active);
  active = undefined;
  expect(check(false)).toBe(false);
});


it("loads independent wrapping preferences for all layouts", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.loadData = vi.fn().mockResolvedValue({ wrapTaskTitles: true, wrapCalendarTaskTitles: false, wrapKanbanTaskTitles: false });
  await plugin.loadSettings();
  expect(plugin.settings).toMatchObject({ wrapTaskTitles: true, wrapCalendarTaskTitles: false, wrapKanbanTaskTitles: false });
});


it("right-click selects titles and other controls, retaining an existing multi-selection", () => {
  const { view, rows } = selectionView();
  rows[0].click(); rows[2].click({ metaKey: true });
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  expect(rows[2].contextmenu(title).preventDefault).not.toHaveBeenCalled();
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["A", "C"]);
  rows[1].contextmenu(title);
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["B"]);
});


it.each([false, true])("opens a real project file and reconciles task mode (already enabled: %s)", async enabled => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const file = Object.assign(new TFile(), { path: "Project.md" });
  const leaf = { openFile: vi.fn().mockResolvedValue(undefined) };
  const sync = vi.fn().mockResolvedValue(undefined);
  const revealLeaf = vi.fn().mockResolvedValue(undefined);
  plugin.app = { vault: { getAbstractFileByPath: () => file }, workspace: { getLeaf: vi.fn(() => leaf), revealLeaf } } as unknown as App;
  plugin.settings.taskMode = enabled;
  const mode = vi.spyOn(plugin, "setTaskMode").mockImplementation(async value => { plugin.settings.taskMode = value; await sync(); });
  (plugin as unknown as { taskModeController: unknown }).taskModeController = { sync };
  await plugin.openProject(file.path);
  expect(leaf.openFile).toHaveBeenCalledExactlyOnceWith(file);
  expect(plugin.settings.taskMode).toBe(true);
  expect(mode).toHaveBeenCalledTimes(enabled ? 0 : 1);
  expect(sync).toHaveBeenCalledOnce();
  expect(sync.mock.invocationCallOrder[0]).toBeGreaterThan(leaf.openFile.mock.invocationCallOrder[0]);
  expect(revealLeaf).toHaveBeenCalledExactlyOnceWith(leaf);
});

it("routes legacy project navigation through file opening", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const open = vi.spyOn(plugin, "openProject").mockResolvedValue(undefined);
  await plugin.openTaskView({ mode: "projects", projectPath: "Project.md" });
  expect(open).toHaveBeenCalledExactlyOnceWith("Project.md");
});

it("does not enable task mode if the project file cannot be opened", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const mode = vi.spyOn(plugin, "setTaskMode").mockResolvedValue(undefined);
  plugin.app = { vault: { getAbstractFileByPath: () => undefined } } as unknown as App;
  await expect(plugin.openProject("Missing.md")).rejects.toThrow("Project note no longer exists");
  expect(mode).not.toHaveBeenCalled();
  const file = new TFile();
  plugin.app = { vault: { getAbstractFileByPath: () => file }, workspace: { getLeaf: () => ({ openFile: async () => { throw new Error("Open failed"); } }) } } as unknown as App;
  await expect(plugin.openProject("Project.md")).rejects.toThrow("Open failed");
  expect(mode).not.toHaveBeenCalled();
});
