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
import type { Task, ProjectProperties, TaskViewState } from "../src/types";

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
    internals.containerEl = { children: [{}, { empty: vi.fn(), addClass: vi.fn(), style: { setProperty: vi.fn() }, classList: { toggle: vi.fn() }, createDiv: vi.fn() }] };
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
    expect(plugin.settings.wrapCalendarTaskTitles).toBe(false);
    expect(plugin.settings.wrapKanbanTaskTitles).toBe(true);
  }
});

it("offers search only in an active project while task mode is enabled", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const focusSearch = vi.fn();
  let active: { pagePath?: string; focusSearch: () => void } | undefined = { pagePath: "Project.md", focusSearch };
  plugin.app = { workspace: { getActiveViewOfType: () => active } } as unknown as App;
  plugin.index = { isProject: (path: string) => path === "Project.md", tagForPath: () => undefined } as never;
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
  const openEditor = vi.fn();
  const openBulkEditor = vi.fn();
  const plugin = { openEditor, openBulkEditor, dateFormat: () => "YYYY-MM-DD", store: { bulkDrop }, index: { taskById: (id: string) => tasks.find(task => task.id === id), refreshPath: vi.fn() } };
  const view = new TaskMainView({} as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  const internals = view as unknown as {
    bindSelection(row: HTMLElement, task: Task): void;
    prepareDrag(task: Task): void;
    editTask(task: Task, focusProperty?: string): void;
    clearSelectionOutside(event: unknown): void;
    renderProperties(parent: unknown, task: Task | ProjectProperties, editProject?: (property: string) => void): void;
    badge: (...args: unknown[]) => unknown;
    dropListTask(task: Task, group?: unknown, anchor?: Task, placement?: string): Promise<void>;
  };
  const rows = tasks.map(task => {
    const handlers = new Map<string, (event: unknown) => void>();
    const classes = new Map<string, boolean>();
    const row = { classList: { toggle: (key: string, value: boolean) => classes.set(key, value) },
      setAttribute: vi.fn(), focus: vi.fn(), closest: () => undefined,
      contains: (target: unknown) => target === row,
      addEventListener: (key: string, callback: (event: unknown) => void) => handlers.set(key, callback)
    };
    internals.bindSelection(row as unknown as HTMLElement, task);
    const click = (options: Record<string, unknown> = {}) => {
      const event = { target: row, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...options };
      handlers.get("click")!(event);
      return event;
    };
    const contextmenu = (target: unknown = row, options: Record<string, unknown> = {}) => {
      const event = { target, preventDefault: vi.fn(), ...options };
      handlers.get("contextmenu")!(event);
      return event;
    };
    const pointerdown = (options: Record<string, unknown> = {}) => {
      const event = { target: row, button: 2, preventDefault: vi.fn(), ...options };
      handlers.get("pointerdown")!(event);
      return event;
    };
    return { row, classes, click, contextmenu, pointerdown };
  });
  return { view, internals, tasks, rows, bulkDrop, openEditor, openBulkEditor };
}

it("left-click opens task properties for a selection and the task editor otherwise", () => {
  const { view, rows, tasks, openEditor, openBulkEditor } = selectionView();
  rows[0].click();
  rows[2].click({ shiftKey: true, metaKey: true });
  expect(view.getSelectedTasks()).toEqual([]);
  expect(openEditor).toHaveBeenCalledTimes(2);
  expect(openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ task: tasks[2] }));
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { shiftKey: true });
  expect(view.getSelectedTasks()).toHaveLength(3);
  rows[1].click();
  expect(openBulkEditor).toHaveBeenCalledExactlyOnceWith(view);
  expect(view.getSelectedTasks()).toHaveLength(3);
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  expect(rows[1].click({ target: title }).preventDefault).not.toHaveBeenCalled();
});

it("drags the selected set together and drags an unselected task without selecting it", async () => {
  const { view, internals, rows, tasks, bulkDrop } = selectionView();
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
  internals.prepareDrag(tasks[2]);
  await internals.dropListTask(tasks[2], undefined, tasks[1], "after");
  expect(bulkDrop).toHaveBeenCalledExactlyOnceWith([tasks[0], tasks[2]], undefined, tasks[1], "after");
  expect(view.getSelectedTasks()).toEqual([]);
  internals.prepareDrag(tasks[1]);
  expect(view.getSelectedTasks()).toEqual([]);
  await internals.dropListTask(tasks[1], undefined, tasks[2], "before");
  expect(bulkDrop).toHaveBeenLastCalledWith([tasks[1]], undefined, tasks[2], "before");
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
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
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
  plugin.app = { vault: { getAbstractFileByPath: () => file }, workspace: { getLeavesOfType: () => [], getLeaf: vi.fn(() => leaf), revealLeaf } } as unknown as App;
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


it("selects on right-button press before contextmenu, including range and additive selection", () => {
  const { view, rows, tasks, openEditor } = selectionView();
  rows[0].pointerdown({ button: 0 });
  expect(view.getSelectedTasks()).toEqual([]);
  rows[0].pointerdown();
  expect(view.getSelectedTasks()).toEqual([tasks[0]]);
  expect(rows[0].classes.get("is-selected")).toBe(true);
  rows[2].pointerdown({ shiftKey: true });
  expect(view.getSelectedTasks()).toEqual(tasks);
  rows[2].contextmenu(undefined, { shiftKey: true });
  expect(view.getSelectedTasks()).toEqual(tasks);
  view.clearSelection();
  rows[0].pointerdown();
  rows[2].pointerdown({ metaKey: true });
  expect(view.getSelectedTasks()).toEqual([tasks[0], tasks[2]]);
  rows[2].contextmenu(undefined, { metaKey: true });
  expect(view.getSelectedTasks()).toEqual([tasks[0], tasks[2]]);
  expect(openEditor).not.toHaveBeenCalled();
});

it("selects immediately on macOS control-click, including task titles", () => {
  const { view, rows, tasks } = selectionView();
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  rows[1].pointerdown({ button: 0, ctrlKey: true, target: title });
  expect(view.getSelectedTasks()).toEqual([tasks[1]]);
});


it("keeps the pressed task selected if layout movement retargets contextmenu", () => {
  const { view, rows, tasks } = selectionView();
  rows[0].contextmenu();
  rows[2].pointerdown();
  rows[0].contextmenu();
  expect(view.getSelectedTasks()).toEqual([tasks[2]]);
  rows[1].contextmenu();
  expect(view.getSelectedTasks()).toEqual([tasks[1]]);
});


it("allows normal navigation from project files while keeping dashboards persistent", async () => {
  const view = new TaskMainView({} as WorkspaceLeaf, {} as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  expect(view.navigation).toBe(false);
  await view.setState({ mode: "all", pagePath: "Project.md" });
  expect(view.navigation).toBe(true);
  await view.setState({ mode: "projects", projectPath: "Legacy.md" });
  expect(view.navigation).toBe(true);
  await view.setState({ mode: "projects" });
  expect(view.navigation).toBe(false);
});

it.each([
  [{ property: "priority", value: 2 }, { priority: 2, destination: "Inbox.md" }],
  [{ property: "date", value: "2026-09-10" }, { scheduledDate: "2026-09-10" }],
  [{ destination: "Work.md#Next" }, { destination: "Work.md#Next" }],
  [{ property: "tags", value: "#[[work]] #[[client]]" }, { tags: ["work", "client"] }]
])("adds an empty group's task with its properties: %j", (target, expected) => {
  const openEditor = vi.fn();
  const view = new TaskMainView({} as WorkspaceLeaf, { settings: { inboxPath: "Inbox.md" }, openEditor } as unknown as TaskManagerPlugin);
  let click: ((event: { stopPropagation: () => void }) => void) | undefined;
  let buttonOptions: { text?: string; attr?: Record<string, string> } | undefined;
  const element = {
    createEl: (tag: string, options?: typeof buttonOptions) => {
      if (tag === "button") buttonOptions = options;
      return element;
    },
    createSpan: () => element,
    addEventListener: (_name: string, callback: typeof click) => { click = callback; }
  };
  const internals = view as unknown as {
    renderSection(parent: unknown, title: string, tasks: Task[], variant: undefined, target: unknown): void;
    renderTaskList(): void;
  };
  vi.spyOn(internals, "renderTaskList").mockImplementation(() => {});
  internals.renderSection(element, "Next", [], undefined, target);
  expect(buttonOptions?.text).toBeUndefined();
  expect(buttonOptions?.attr?.["aria-label"]).toBe("Add task to Next");
  click!({ stopPropagation: vi.fn() });
  expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ preset: expect.objectContaining(expected) }));
});

it("clears selection on outside left clicks, but preserves it on selected rows and right clicks", () => {
  const { view, internals, rows } = selectionView();
  rows[0].contextmenu();
  internals.clearSelectionOutside({ button: 0, target: rows[0].row });
  expect(view.getSelectedTasks()).toHaveLength(1);
  internals.clearSelectionOutside({ button: 2, target: {} });
  expect(view.getSelectedTasks()).toHaveLength(1);
  internals.clearSelectionOutside({ button: 0, target: rows[1].row });
  expect(view.getSelectedTasks()).toHaveLength(0);
  rows[0].contextmenu();
  internals.clearSelectionOutside({ button: 0, target: {} });
  expect(view.getSelectedTasks()).toHaveLength(0);
});

it("opens properties for one selected task and clears selection when opening another task", () => {
  const { view, internals, rows, tasks, openEditor, openBulkEditor } = selectionView();
  rows[0].contextmenu();
  internals.editTask(tasks[0]);
  expect(openBulkEditor).toHaveBeenCalledExactlyOnceWith(view);
  internals.editTask(tasks[1]);
  expect(view.getSelectedTasks()).toHaveLength(0);
  expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ task: tasks[1] }));
});

it.each(["scheduledDate", "deadline", "durationMinutes", "priority", "tags"])("property clicks focus %s in the bulk editor when selected", property => {
  const { view, internals, rows, tasks, openEditor, openBulkEditor } = selectionView();
  rows[0].contextmenu(); rows[1].contextmenu(undefined, { metaKey: true });
  internals.editTask(tasks[0], property);
  expect(openBulkEditor).toHaveBeenCalledExactlyOnceWith(view, property);
  expect(openEditor).not.toHaveBeenCalled();
  expect(view.getSelectedTasks()).toHaveLength(2);
});

it("binds each rendered property badge to its field without opening the row editor", () => {
  const { internals, tasks, openEditor, openBulkEditor } = selectionView();
  const badges: Array<{ handlers: Map<string, (event: unknown) => void> }> = [];
  internals.badge = () => {
    const badge = { handlers: new Map<string, (event: unknown) => void>(), setAttribute: vi.fn(),
      addEventListener(type: string, callback: (event: unknown) => void) { this.handlers.set(type, callback); } };
    badges.push(badge);
    return badge;
  };
  const task = { ...tasks[0], scheduledDate: "2026-09-16", deadline: "2026-09-17", durationMinutes: 60, priority: 1 as const, tags: ["Work"] };
  internals.renderProperties({}, task);
  expect(badges).toHaveLength(5);
  for (const [index, property] of ["scheduledDate", "durationMinutes", "deadline", "priority", "tags"].entries()) {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    badges[index].handlers.get("click")!(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ task, focusProperty: property }));
  }
  expect(openEditor).toHaveBeenCalledTimes(5);
  expect(openBulkEditor).not.toHaveBeenCalled();
});

it("restores tag page state and clears it when navigating to All Tasks", async () => {
  const view = new TaskMainView({} as WorkspaceLeaf, {} as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  await view.setState({ mode: "tags", tag: "client notes" });
  expect(view.getState()).toMatchObject({ mode: "tags", tag: "client notes" });
  expect(view.getDisplayText()).toBe("client notes");
  await view.setState({ mode: "all" });
  expect(view.getState().tag).toBeUndefined();
  expect(view.getDisplayText()).toBe("All Tasks");
});

it("routes project date and priority pills to the matching editor fields", () => {
  const { internals, openEditor } = selectionView();
  const badges: Array<Map<string, (event: unknown) => void>> = [];
  internals.badge = () => {
    const handlers = new Map<string, (event: unknown) => void>();
    badges.push(handlers);
    return { setAttribute: vi.fn(), addEventListener: (type: string, callback: (event: unknown) => void) => handlers.set(type, callback) };
  };
  const edit = vi.fn();
  internals.renderProperties({}, { scheduledDate: "2026-09-18", endDate: "2026-09-20", deadline: "2026-09-21", priority: 1 }, edit);
  for (const [index, field] of ["date", "endDate", "deadline", "priority"].entries()) {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), key: "Enter" };
    badges[index].get("click")!(event);
    expect(edit).toHaveBeenLastCalledWith(field);
    badges[index].get("keydown")!(event);
    expect(edit).toHaveBeenLastCalledWith(field);
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
  }
  expect(openEditor).not.toHaveBeenCalled();
});

it.each([false, true])("opens a tag note and enables task mode (already enabled: %s)", async enabled => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const file = Object.assign(new TFile(), { path: "Tags/work.md" });
  const leaf = { openFile: vi.fn().mockResolvedValue(undefined) };
  const sync = vi.fn().mockResolvedValue(undefined);
  const revealLeaf = vi.fn().mockResolvedValue(undefined);
  plugin.index = { tagFile: () => file } as never;
  plugin.app = { workspace: { getLeavesOfType: () => [], getLeaf: vi.fn(() => leaf), revealLeaf } } as unknown as App;
  plugin.settings.taskMode = enabled;
  const mode = vi.spyOn(plugin, "setTaskMode").mockImplementation(async value => { plugin.settings.taskMode = value; await sync(); });
  (plugin as unknown as { taskModeController: unknown }).taskModeController = { sync };
  await plugin.openTag("work");
  expect(leaf.openFile).toHaveBeenCalledExactlyOnceWith(file);
  expect(plugin.settings.taskMode).toBe(true);
  expect(mode).toHaveBeenCalledTimes(enabled ? 0 : 1);
  expect(sync).toHaveBeenCalledOnce();
  expect(sync.mock.invocationCallOrder[0]).toBeGreaterThan(leaf.openFile.mock.invocationCallOrder[0]);
  expect(revealLeaf).toHaveBeenCalledExactlyOnceWith(leaf);
});

it("keeps tags without notes accessible without creating a file", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.index = { tagFile: () => undefined } as never;
  const open = vi.spyOn(plugin, "openTaskView").mockResolvedValue(undefined);
  await plugin.openTag("missing");
  expect(open).toHaveBeenCalledExactlyOnceWith({ mode: "tags", tag: "missing" });
});

it("queries a file-backed tag across the vault instead of restricting results to the tag note", async () => {
  const query = vi.fn(() => []);
  const view = new TaskMainView({} as WorkspaceLeaf, { index: { query } } as unknown as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  await view.setState({ mode: "tags", tag: "work", pagePath: "Tags/work.md" });
  const internals = view as unknown as {
    taskResults: { empty(): void };
    updateSelection(): void;
    renderTaskLayouts(): void;
    renderTaskResults(): void;
    taskSourcePath?: string;
  };
  internals.taskResults = { empty: vi.fn() };
  vi.spyOn(internals, "updateSelection").mockImplementation(() => {});
  vi.spyOn(internals, "renderTaskLayouts").mockImplementation(() => {});
  internals.renderTaskResults();
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ mode: "tags", tagPath: "Tags/work.md", tag: undefined, projectPath: undefined }));
  expect(internals.taskSourcePath).toBeUndefined();
  expect(view.navigation).toBe(true);
});

it.each([
  ["tags", ["09:00", "10:00", "1h", "P1"], ["work"]],
  ["priority", ["work", "1h"], ["P1"]],
  ["duration", ["work", "P1"], ["1h"]],
  ["scheduledDate", ["09:00", "2026-09-20 10:00"], ["2026-09-18"]],
  ["scheduledTime", ["2026-09-18", "10:00"], ["09:00"]],
  ["deadline", ["10:00", "2026-09-18 09:00"], ["2026-09-20"]],
  ["deadlineTime", ["2026-09-20", "09:00"], ["10:00"]],
  ["date", ["09:00", "2026-09-20 10:00"], ["2026-09-18"]],
  ["none", ["2026-09-18 09:00", "2026-09-20 10:00", "1h", "P1", "work"], []]
])("hides only metadata represented by %s grouping", (grouping, present, absent) => {
  const { view, internals, tasks } = selectionView();
  Object.assign(view, { grouping });
  const labels: string[] = [];
  internals.badge = (_parent, _icon, text) => {
    labels.push(String(text));
    return { setAttribute: vi.fn(), addEventListener: vi.fn() };
  };
  internals.renderProperties({}, { ...tasks[0], scheduledDate: "2026-09-18", scheduledTime: "09:00", deadline: "2026-09-20", deadlineTime: "10:00", durationMinutes: 60, priority: 1, tags: ["work"] });
  for (const text of present) expect(labels.some(label => label.includes(text))).toBe(true);
  for (const text of absent) expect(labels.some(label => label.includes(text))).toBe(false);
});
