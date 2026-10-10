import { describe, expect, it, vi, onTestFinished } from "vitest";
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";

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
// No DOM here: record what the view asks the choice popover to show.
vi.mock("../src/choice-popover", async original => ({
  ...await original<typeof import("../src/choice-popover")>(),
  openChoicePopover: vi.fn(() => ({ element: {}, close: () => {} }))
}));
import { openChoicePopover, type ChoicePopoverOptions } from "../src/choice-popover";

import TaskManagerPlugin from "../src/main";
import { TaskMainView } from "../src/task-view";
import { TaskPropertyEditors } from "../src/task-property-editors";
import { scanTasks } from "../src/parser";
import { setTagFormat } from "../src/task-tags";
import type { Task, TaskViewState } from "../src/types";
import { activeTaskDrag, type SidebarDrop } from "../src/sidebar-drop";
import { todayIso } from "../src/date";

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
    const view = new TaskMainView({} as WorkspaceLeaf, { settings: {} } as TaskManagerPlugin);
    const internals = view as unknown as {
      containerEl: { children: unknown[] };
      renderHeader: () => void;
      renderFilters: () => void;
      renderTaskResults: () => void;
    };
    internals.containerEl = { children: [{}, { empty: vi.fn(), addClass: vi.fn(), style: { setProperty: vi.fn() }, classList: { toggle: vi.fn() }, createDiv: vi.fn() }] };
    vi.spyOn(internals, "renderHeader").mockImplementation(() => {});
    const filters = vi.spyOn(internals, "renderFilters").mockImplementation(() => {});
    vi.spyOn(internals, "renderTaskResults").mockImplementation(() => {});
    await view.setState({ ...state });
    expect(filters).toHaveBeenCalledOnce();
    expect(view.pagePath).toBe(state.pagePath ?? state.projectPath);
  });
});


it("drops the old title wrapping and hover settings when loading, since titles never wrap", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.loadData = vi.fn().mockResolvedValue({ wrapTaskTitles: true, wrapCalendarTaskTitles: true, wrapKanbanTaskTitles: false, taskHoverHighlight: "all" });
  await plugin.loadSettings();
  for (const key of ["wrapTaskTitles", "wrapCalendarTaskTitles", "wrapKanbanTaskTitles", "taskHoverHighlight"]) expect(key in plugin.settings).toBe(false);
});

function selectionView() {
  const tasks = scanTasks("Work.md", "- [ ] A\n- [ ] B\n- [ ] C");
  const bulkDrop = vi.fn().mockResolvedValue([]);
  const openEditor = vi.fn();
  const update = vi.fn().mockResolvedValue(undefined);
  const addSubtask = vi.fn().mockResolvedValue(undefined);
  const plugin = { settings: {} as Record<string, unknown>, openEditor, dateFormat: () => "YYYY-MM-DD", store: { bulkDrop, update, addSubtask }, index: { taskById: (id: string) => tasks.find(task => task.id === id), tasksForPath: (path: string) => tasks.filter(task => task.path === path), refreshPath: vi.fn() } };
  const view = new TaskMainView({} as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  const internals = view as unknown as {
    bindSelection(row: HTMLElement, task: Task): void;
    prepareDrag(task: Task): void;
    editTask(task: Task, focusProperty?: string): void;
    clearSelectionOutside(event: unknown): void;
    dropListTask(task: Task, group?: unknown, anchor?: Task, placement?: string): Promise<void>;
  };
  // The menu itself needs a real document; here it only records what it was opened for.
  const openTaskMenu = vi.spyOn(view as unknown as { openTaskMenu(task: Task): void }, "openTaskMenu").mockImplementation(() => {});
  const rows = tasks.map(task => {
    const handlers = new Map<string, (event: unknown) => void>();
    const classes = new Map<string, boolean>();
    const row = { classList: { toggle: (key: string, value: boolean) => classes.set(key, value) },
      setAttribute: vi.fn(), focus: vi.fn(), closest: () => undefined, getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
      contains: (target: unknown) => target === row,
      addEventListener: (key: string, callback: (event: unknown) => void) => handlers.set(key, callback)
    };
    internals.bindSelection(row as unknown as HTMLElement, task);
    const click = (options: Record<string, unknown> = {}) => {
      const event = { target: row, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), ...options };
      handlers.get("click")!(event);
      return event;
    };
    const dblclick = (options: Record<string, unknown> = {}) => {
      const event = { target: row, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...options };
      handlers.get("dblclick")!(event);
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
    return { row, classes, click, dblclick, contextmenu, pointerdown };
  });
  return { view, internals, tasks, rows, bulkDrop, openEditor, openTaskMenu, plugin, update, addSubtask };
}

it("left-click selects only the clicked task, with Mod to toggle and Shift for a range", () => {
  const { view, rows, tasks, openEditor, openTaskMenu } = selectionView();
  rows[0].click();
  expect(view.getSelectedTasks()).toEqual([tasks[0]]);
  rows[2].click({ shiftKey: true });
  expect(view.getSelectedTasks()).toEqual(tasks);
  rows[1].click({ metaKey: true });
  expect(view.getSelectedTasks()).toEqual([tasks[0], tasks[2]]);
  // A plain click on an already selected task still narrows the selection to it.
  rows[2].click();
  expect(view.getSelectedTasks()).toEqual([tasks[2]]);
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  expect(rows[1].click({ target: title }).preventDefault).toHaveBeenCalled();
  expect(view.getSelectedTasks()).toEqual([tasks[1]]);
  expect(openEditor).not.toHaveBeenCalled();
  expect(openTaskMenu).not.toHaveBeenCalled();
});

it("double-click opens the task editor for just that task", () => {
  const { view, rows, tasks, openEditor, openTaskMenu } = selectionView();
  rows[0].click(); rows[2].click({ metaKey: true });
  rows[2].dblclick();
  expect(openEditor).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ task: tasks[2] }));
  expect(openTaskMenu).not.toHaveBeenCalled();
  expect(view.getSelectedTasks()).toEqual([tasks[2]]);
  rows[1].dblclick({ metaKey: true });
  expect(openEditor).toHaveBeenCalledOnce();
});

it("in the Things style, double-click and Enter open the task as a card instead of the editor", async () => {
  const { view, rows, tasks, openEditor, plugin } = selectionView();
  plugin.settings.style = "things";
  const card = () => (view as unknown as { expanded?: { id: string; title: string; notes: string } }).expanded;
  rows[1].dblclick();
  await Promise.resolve(); await Promise.resolve();
  expect(openEditor).not.toHaveBeenCalled();
  expect(card()).toEqual({ id: tasks[1].id, title: "B", notes: "" });
  expect(view.getSelectedTasks()).toEqual([]);
});

it("saves only a changed card title or notes when the card closes", async () => {
  const { view, tasks, plugin, update } = selectionView();
  plugin.settings.style = "things";
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string }; collapseCard(): Promise<void> };
  internals.expanded = { id: tasks[0].id, title: "A", notes: "" };
  await internals.collapseCard();
  expect(update).not.toHaveBeenCalled();
  expect(internals.expanded).toBeUndefined();
  internals.expanded = { id: tasks[0].id, title: " Renamed ", notes: "A note" };
  await internals.collapseCard();
  expect(update).toHaveBeenCalledExactlyOnceWith(tasks[0], expect.objectContaining({ title: "Renamed", description: "A note", destination: "Work.md" }));
  // A cleared title keeps the old one rather than erasing the task.
  internals.expanded = { id: tasks[1].id, title: "  ", notes: "" };
  await internals.collapseCard();
  expect(update).toHaveBeenCalledOnce();
});

it("writes a subtask typed in the card and, after Enter, opens the next one below it", async () => {
  const { view, tasks, plugin, addSubtask } = selectionView();
  plugin.settings.style = "things";
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string; subtask?: unknown }; cardFocus?: string; addCardSubtask(id: string, title: string, after: unknown, next: boolean): Promise<void> };
  internals.expanded = { id: tasks[0].id, title: "A", notes: "" };
  await internals.addCardSubtask(tasks[0].id, "First step", undefined, true);
  expect(addSubtask).toHaveBeenCalledExactlyOnceWith(tasks[0], expect.objectContaining({ title: "First step" }), undefined);
  expect(plugin.index.refreshPath).toHaveBeenCalledWith("Work.md");
  expect(internals.expanded.subtask).toEqual({ after: undefined, text: "" });
  expect(internals.cardFocus).toBe("new");
  // Leaving the field (rather than Enter) adds the subtask without opening another.
  internals.expanded = { id: tasks[0].id, title: "A", notes: "" };
  await internals.addCardSubtask(tasks[0].id, "Second step", undefined, false);
  expect(internals.expanded.subtask).toBeUndefined();
  // Properties typed into a new subtask are parsed, dates included.
  await internals.addCardSubtask(tasks[0].id, "Third step p2 #[[Errand]]", undefined, false);
  expect(addSubtask).toHaveBeenLastCalledWith(tasks[0], expect.objectContaining({ title: "Third step", priority: 2, tags: ["Errand"] }), undefined);
});

it("reads a #tag typed at the end of a card title as a task tag in the #tag format", async () => {
  setTagFormat("hash");
  const { view, tasks, plugin, update } = selectionView();
  plugin.settings.style = "things";
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string }; collapseCard(): Promise<void> };
  internals.expanded = { id: tasks[0].id, title: "A #errand", notes: "" };
  await internals.collapseCard();
  expect(update).toHaveBeenCalledExactlyOnceWith(tasks[0], expect.objectContaining({ title: "A", tags: ["errand"] }));
});

it("removes a tag from the card's cross, and saves and closes the card before opening a tag's view", async () => {
  const { view, plugin, update } = selectionView();
  const tagged = scanTasks("Work.md", "- [ ] Tagged #[[Errand]] #[[Office]]")[0];
  plugin.index.taskById = (id: string) => (id === tagged.id ? tagged : undefined) as never;
  const openTag = vi.fn().mockResolvedValue(undefined);
  Object.assign(plugin, { openTag });
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string }; removeCardTag(id: string, tag: string): Promise<void>; openTagView(tag: string): Promise<void> };
  await internals.removeCardTag(tagged.id, "Errand");
  expect(update).toHaveBeenCalledExactlyOnceWith(tagged, expect.objectContaining({ tags: ["Office"] }));
  internals.expanded = { id: tagged.id, title: "Tagged again", notes: "" };
  await internals.openTagView("Office");
  expect(update).toHaveBeenLastCalledWith(tagged, expect.objectContaining({ title: "Tagged again" }));
  expect(internals.expanded).toBeUndefined();
  expect(openTag).toHaveBeenCalledExactlyOnceWith("Office");
});

it("moves a card's task to the project picked from its project button, and closes the card", async () => {
  const { view, tasks, plugin, update } = selectionView();
  plugin.settings.inboxPath = "Inbox.md";
  const projects = [
    { name: "Website", path: "Projects/Website.md", openTasks: 1, completedTasks: 0, archived: false, color: "#f00" },
    { name: "Old", path: "Projects/Old.md", openTasks: 0, completedTasks: 0, archived: true },
    { name: "Autumn", path: "Projects/Autumn.md", openTasks: 1, completedTasks: 0, archived: false, parentPath: "Projects/Studio.md" }
  ];
  Object.assign(plugin.index, { projects: () => projects });
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string }; openProjectPicker(id: string, anchor: HTMLElement): void };
  internals.expanded = { id: tasks[0].id, title: "A", notes: "" };
  const anchor = {} as HTMLElement;
  internals.openProjectPicker(tasks[0].id, anchor);
  const shown = vi.mocked(openChoicePopover).mock.lastCall![0] as ChoicePopoverOptions;
  // Inbox, the task's own note (not a project), then the active projects by name.
  expect(shown.anchor).toBe(anchor);
  expect(shown.choices.map(choice => [choice.label, choice.detail])).toEqual([["Inbox", undefined], ["Work", undefined], ["Autumn", "Studio"], ["Website", undefined]]);
  expect(shown.choices[3].color).toBe("#f00");
  expect(shown.selected).toBe("Work.md");
  shown.choose("Projects/Website.md");
  await vi.waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith(tasks[0], expect.objectContaining({ destination: "Projects/Website.md" })));
  expect(internals.expanded).toBeUndefined();
});

it("applies properties typed into a card title when the card closes", async () => {
  const { view, tasks, plugin, update } = selectionView();
  plugin.settings.style = "things";
  const internals = view as unknown as { expanded?: { id: string; title: string; notes: string }; collapseCard(): Promise<void> };
  internals.expanded = { id: tasks[0].id, title: "A p1 #[[Errand]] 30m", notes: "" };
  await internals.collapseCard();
  expect(update).toHaveBeenCalledExactlyOnceWith(tasks[0], expect.objectContaining({ title: "A", priority: 1, tags: ["Errand"], durationMinutes: 30 }));
});

it("right-click selects the task and opens its menu, for the selection when it is selected", () => {
  const { view, rows, tasks, openTaskMenu } = selectionView();
  rows[0].pointerdown();
  const first = rows[0].contextmenu();
  expect(first.preventDefault).toHaveBeenCalled();
  expect(openTaskMenu).toHaveBeenLastCalledWith(tasks[0], rows[0].row, { x: 24, y: 0 });
  rows[1].click({ metaKey: true });
  rows[1].pointerdown();
  rows[1].contextmenu(undefined, { clientX: 40, clientY: 60 });
  expect(openTaskMenu).toHaveBeenLastCalledWith(tasks[1], rows[1].row, { x: 40, y: 60 });
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["A", "B"]);
  // Cmd-right-clicking a selected task takes it out of the selection, with no menu.
  rows[1].pointerdown({ metaKey: true }); rows[1].contextmenu(undefined, { metaKey: true });
  expect(openTaskMenu).toHaveBeenCalledTimes(2);
  expect(view.getSelectedTasks().map(task => task.title)).toEqual(["A"]);
});

it("drags the selected set together, keeping it selected, and drags an unselected task without selecting it", async () => {
  const { view, internals, rows, tasks, bulkDrop } = selectionView();
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
  internals.prepareDrag(tasks[2]);
  await internals.dropListTask(tasks[2], undefined, tasks[1], "after");
  expect(bulkDrop).toHaveBeenCalledExactlyOnceWith([tasks[0], tasks[2]], undefined, tasks[1], "after");
  expect(view.getSelectedTasks()).toEqual([tasks[0], tasks[2]]);
  internals.prepareDrag(tasks[1]);
  await internals.dropListTask(tasks[1], undefined, tasks[2], "before");
  expect(bulkDrop).toHaveBeenLastCalledWith([tasks[1]], undefined, tasks[2], "before");
  expect(view.getSelectedTasks()).toEqual([tasks[0], tasks[2]]);
});

it("drops dragged tasks on the sidebar's lists: Inbox or a project moves them, Today schedules them, a tag is added", async () => {
  const { view, internals, rows, tasks, plugin } = selectionView();
  const bulkUpdate = vi.fn().mockResolvedValue([]);
  Object.assign(plugin.store, { bulkUpdate });
  Object.assign(plugin.settings, { inboxPath: "Inbox.md" });
  const drop = (tasks: Task[], target: SidebarDrop) => view.dropTasks(tasks, target);
  const tagged = { ...tasks[1], tags: ["work"] };
  await drop([tasks[0], tagged], { kind: "tag", tag: "work" });
  expect(bulkUpdate).toHaveBeenLastCalledWith([tasks[0]], expect.any(Function));
  expect((bulkUpdate.mock.lastCall![1] as (task: Task) => Partial<Task>)({ ...tasks[0], tags: ["home"] })).toEqual({ tags: ["home", "work"] });
  await drop([tasks[0]], { kind: "today" });
  expect(bulkUpdate).toHaveBeenLastCalledWith([tasks[0]], { scheduledDate: todayIso() });
  await drop([tasks[0], tasks[1]], { kind: "project", path: "Home.md" });
  expect(bulkUpdate).toHaveBeenLastCalledWith([tasks[0], tasks[1]], { destination: "Home.md" });
  await drop([tasks[0]], { kind: "note", path: "Notes/Ideas.md" });
  expect(bulkUpdate).toHaveBeenLastCalledWith([tasks[0]], { destination: "Notes/Ideas.md" });
  await drop([tasks[0]], { kind: "inbox" });
  expect(bulkUpdate).toHaveBeenLastCalledWith([tasks[0]], { destination: "Inbox.md" });
  // Nothing to change writes nothing: the task is already in the project.
  bulkUpdate.mockClear();
  await drop([tasks[0]], { kind: "project", path: "Work.md" });
  expect(bulkUpdate).not.toHaveBeenCalled();
  // Starting a drag of the selection hands the sidebar the selected tasks until the pointer is let go.
  const listeners = new Map<string, () => void>();
  const doc = { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener), removeEventListener: (type: string) => listeners.delete(type) };
  for (const { row } of rows) Object.assign(row, { ownerDocument: doc });
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
  internals.prepareDrag(tasks[2]);
  expect(activeTaskDrag()?.tasks).toEqual([tasks[0], tasks[2]]);
  listeners.get("pointerup")!();
  expect(activeTaskDrag()).toBeUndefined();
});

it("selects moved tasks again by their note and title, the nearest one when titles repeat", () => {
  const { view, internals, rows, tasks } = selectionView();
  rows[1].click();
  const moved = scanTasks("Other.md", "- [ ] B\n- [ ] A\n- [ ] B");
  (internals as unknown as { plugin: { index: { tasksForPath(path: string): Task[] } } }).plugin.index.tasksForPath = path => path === "Other.md" ? moved : [];
  (view as unknown as { visibleTasks: Task[] }).visibleTasks.push(...moved);
  (view as unknown as { reselect(before: Task[], moveTo?: string): void }).reselect([tasks[1]], "Other.md");
  expect(view.getSelectedTasks()).toEqual([moved[0]]);
});

it("offers Open task menu only for an active view with selected tasks", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  let selected: Task[] = [];
  const open = vi.fn();
  let active: { getSelectedTasks: () => Task[]; openSelectionMenu: () => void } | undefined = { getSelectedTasks: () => selected, openSelectionMenu: open };
  plugin.app = { workspace: { getActiveViewOfType: () => active } } as unknown as App;
  const check = (plugin as unknown as { editSelectedTaskProperties(checking: boolean): boolean }).editSelectedTaskProperties.bind(plugin);
  expect(check(false)).toBe(false);
  selected = scanTasks("Work.md", "- [ ] Selected");
  expect(check(true)).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(check(false)).toBe(true);
  expect(open).toHaveBeenCalledOnce();
  active = undefined;
  expect(check(false)).toBe(false);
});


it.each([[null, "griply"], [{ style: "unknown" }, "griply"], [{ style: "things" }, "things"], [{ style: "griply" }, "griply"]] as const)(
  "defaults to the Griply style, keeping a saved Things choice (%j)", async (saved, expected) => {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    plugin.loadData = vi.fn().mockResolvedValue(saved);
    await plugin.loadSettings();
    expect(plugin.settings.style).toBe(expected);
  });



it("right-click selects titles and other controls, retaining an existing multi-selection", () => {
  const { view, rows } = selectionView();
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  rows[2].contextmenu(title);
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


it("allows normal navigation from project files while keeping lists persistent", async () => {
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
  const other = { addEventListener: () => {} };
  const add = { addEventListener: (_name: string, callback: typeof click) => { click = callback; } };
  const element = {
    createEl: (tag: string, options?: typeof buttonOptions): unknown => {
      if (tag !== "button") return element;
      // The group's fold chevron is a button too; this test is about the add button.
      if (!options?.attr?.["aria-label"]?.startsWith("Add task")) return other;
      buttonOptions = options;
      return add;
    },
    createSpan: () => element,
    toggleClass: () => {},
    prepend: () => {},
    addEventListener: () => {}
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

it("clears selection on outside left clicks, but preserves it on task rows and right clicks", () => {
  const { view, internals, rows } = selectionView();
  rows[0].contextmenu();
  internals.clearSelectionOutside({ button: 0, target: rows[0].row });
  expect(view.getSelectedTasks()).toHaveLength(1);
  internals.clearSelectionOutside({ button: 2, target: {} });
  expect(view.getSelectedTasks()).toHaveLength(1);
  // Another row's own click handler decides the selection, e.g. extending it with Shift.
  internals.clearSelectionOutside({ button: 0, target: rows[1].row });
  expect(view.getSelectedTasks()).toHaveLength(1);
  // Clicks in the task menu, or a popover it opened, act on the selection.
  for (const popover of [".tm-task-menu", ".tm-tags-popover"]) {
    internals.clearSelectionOutside({ button: 0, target: { closest: (selectors: string) => selectors.split(", ").includes(popover) ? {} : undefined } });
    expect(view.getSelectedTasks()).toHaveLength(1);
  }
  rows[0].contextmenu();
  internals.clearSelectionOutside({ button: 0, target: {} });
  expect(view.getSelectedTasks()).toHaveLength(0);
});

it("opens the editor for one task, the menu for several, and clears the selection when opening another task", () => {
  const { view, internals, rows, tasks, openEditor, openTaskMenu } = selectionView();
  rows[0].contextmenu();
  openTaskMenu.mockClear();
  internals.editTask(tasks[0]);
  expect(openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ task: tasks[0] }));
  rows[1].click({ metaKey: true });
  internals.editTask(tasks[1]);
  expect(openTaskMenu).toHaveBeenCalledExactlyOnceWith(tasks[1], rows[1].row, { x: 24, y: 0 });
  internals.editTask(tasks[2]);
  expect(view.getSelectedTasks()).toHaveLength(0);
  expect(openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ task: tasks[2] }));
});

it.each([["tags", "tags"], ["repeat", "repeat"], ["defer", "snooze"]] as const)("property clicks edit %s in a popover for the selection", (property, editor) => {
  const { view, internals, rows, tasks, openEditor } = selectionView();
  const popover = vi.spyOn(TaskPropertyEditors.prototype, editor).mockImplementation(() => {});
  onTestFinished(() => popover.mockRestore());
  rows[0].contextmenu(); rows[1].contextmenu(undefined, { metaKey: true });
  internals.editTask(tasks[0], property);
  expect(popover).toHaveBeenCalledOnce();
  expect(popover.mock.calls[0][0]).toEqual([tasks[0], tasks[1]]);
  expect(openEditor).not.toHaveBeenCalled();
  expect(view.getSelectedTasks()).toHaveLength(2);
});

it.each(["scheduledDate", "deadline", "durationMinutes", "priority"])("edits %s in a popover, for the whole selection, instead of a modal", property => {
  const { internals, rows, tasks, openEditor } = selectionView();
  const popover = vi.spyOn(TaskPropertyEditors.prototype, "date").mockReturnValue(true);
  onTestFinished(() => popover.mockRestore());
  rows[0].contextmenu(); rows[1].contextmenu(undefined, { metaKey: true });
  internals.editTask(tasks[0], property);
  expect(popover).toHaveBeenCalledExactlyOnceWith([tasks[0], tasks[1]], property, expect.anything());
  internals.editTask(tasks[2], property);
  expect(popover).toHaveBeenLastCalledWith([tasks[2]], property, expect.anything());
  expect(openEditor).not.toHaveBeenCalled();
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
  const view = new TaskMainView({} as WorkspaceLeaf, { index: { query, projects: () => [] } } as unknown as TaskManagerPlugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  await view.setState({ mode: "tags", tag: "work", pagePath: "Tags/work.md" });
  const internals = view as unknown as {
    taskResults: { empty(): void; setAttribute(name: string, value: string): void };
    updateSelection(): void;
    renderTaskLayouts(): void;
    renderTaskResults(): void;
    taskSourcePath?: string;
  };
  internals.taskResults = { empty: vi.fn(), setAttribute: vi.fn() };
  vi.spyOn(internals, "updateSelection").mockImplementation(() => {});
  vi.spyOn(internals, "renderTaskLayouts").mockImplementation(() => {});
  internals.renderTaskResults();
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ mode: "tags", tagPath: "Tags/work.md", tag: undefined, projectPath: undefined }));
  expect(internals.taskSourcePath).toBeUndefined();
  expect(view.navigation).toBe(true);
});

it("edits the task on the current editor line only when task mode is off", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.settings = { ...plugin.settings, taskMode: false };
  vi.spyOn(plugin, "dateFormat").mockReturnValue("YYYY-MM-DD");
  const open = vi.spyOn(plugin, "openEditor").mockImplementation(() => {});
  const file = Object.assign(new TFile(), { path: "Notes.md" });
  let line = 1;
  const editor = { getCursor: () => ({ line }), getValue: () => "# Heading\n- [ ] Current unsaved task\n    - Description\n```\n- [ ] Example\n```" };
  const check = (plugin as unknown as { editCurrentLineTask(checking: boolean, editor: unknown, file: TFile | null): boolean });
  expect(check.editCurrentLineTask(true, editor, file)).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(check.editCurrentLineTask(false, editor, file)).toBe(true);
  expect(open).toHaveBeenCalledWith({ mode: "all", task: expect.objectContaining({ path: "Notes.md", line: 1, title: "Current unsaved task", description: "- Description" }) });
  for (line of [0, 2, 4]) expect(check.editCurrentLineTask(false, editor, file)).toBe(false);
  line = 1;
  plugin.settings.taskMode = true;
  expect(check.editCurrentLineTask(false, editor, file)).toBe(false);
  plugin.settings.taskMode = false;
  expect(check.editCurrentLineTask(false, editor, null)).toBe(false);
  expect(open).toHaveBeenCalledOnce();
});

 it.each(["day", "week", "month", "year"] as const)("switches an open calendar to %s without changing its date", async scope => {
   const plugin = Object.assign(new TaskManagerPlugin({} as App, {} as never), { app: { workspace: { getLeavesOfType: () => [] } } as unknown as App });
   const view = new TaskMainView({} as WorkspaceLeaf, plugin);
   vi.spyOn(view, "render").mockImplementation(() => {});
   await view.setState({ mode: "all", layout: "calendar", calendarAnchor: "2026-09-19" });
   const save = vi.fn();
   const active = vi.fn(() => view as TaskMainView | null);
   plugin.app = { workspace: { getActiveViewOfType: active, requestSaveLayout: save, getLeavesOfType: () => [] } } as unknown as App;
   const command = plugin as unknown as { switchCalendarScope(scope: string, checking: boolean): boolean };
   const change = vi.spyOn(view, "setState");
   expect(command.switchCalendarScope(scope, true)).toBe(true);
   expect(change).not.toHaveBeenCalled();
   expect(command.switchCalendarScope(scope, false)).toBe(true);
   await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
   expect(view.getState()).toMatchObject({ calendarScope: scope, calendarAnchor: "2026-09-19", layout: "calendar" });
   active.mockReturnValue(null);
   expect(command.switchCalendarScope(scope, false)).toBe(false);
 });

 it.each([
   [{ mode: "all", layout: "list" }, false],
   [{ mode: "all", layout: "kanban" }, false],
   [{ mode: "projects", layout: "calendar" }, false],
   [{ mode: "projects", pagePath: "Project.md", layout: "calendar" }, true],
   [{ mode: "tags", layout: "calendar" }, false],
   [{ mode: "tags", tag: "work", layout: "calendar" }, true],
   [{ mode: "smartLists", layout: "calendar" }, false],
   [{ mode: "smartLists", smartListId: "missing", layout: "calendar" }, false]
 ] as const)("enables calendar commands only for a rendered calendar: %j", async (state, expected) => {
   const plugin = Object.assign(new TaskManagerPlugin({} as App, {} as never), { app: { workspace: { getLeavesOfType: () => [] } } as unknown as App });
   const view = new TaskMainView({} as WorkspaceLeaf, plugin);
   vi.spyOn(view, "render").mockImplementation(() => {});
   await view.setState(state);
   expect(view.hasCalendar).toBe(expected);
 });


it("Mod-clicking a selected title deselects only that task without opening an editor", () => {
  const { view, rows, tasks, openEditor, openTaskMenu } = selectionView();
  rows[0].contextmenu(); rows[2].contextmenu(undefined, { metaKey: true });
  openTaskMenu.mockClear();
  const title = { closest: () => ({ tagName: "BUTTON" }) };
  const event = rows[0].click({ metaKey: true, target: title });
  expect(view.getSelectedTasks()).toEqual([tasks[2]]);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(openEditor).not.toHaveBeenCalled();
  expect(openTaskMenu).not.toHaveBeenCalled();
  rows[2].click({ metaKey: true });
  expect(view.getSelectedTasks()).toEqual([]);
});

it.each([false, true])("lets property controls handle clicks before opening an editor (selected: %s)", selected => {
  const { internals, rows, tasks, openEditor } = selectionView();
  const repeat = vi.spyOn(TaskPropertyEditors.prototype, "repeat").mockImplementation(() => {});
  onTestFinished(() => repeat.mockRestore());
  if (selected) rows[0].contextmenu();
  const property = { role: "button" };
  const target = { closest: (selectors: string) => selectors.split(", ").includes("[role=button]") ? property : undefined };
  const event = rows[0].click({ target });
  expect(event.stopPropagation).not.toHaveBeenCalled();
  expect(openEditor).not.toHaveBeenCalled();
  // The property handler receives the event and opens its own popover.
  internals.editTask(tasks[0], "repeat");
  expect(repeat).toHaveBeenCalledOnce();
  expect(repeat.mock.calls[0][0]).toEqual([tasks[0]]);
  expect(openEditor).not.toHaveBeenCalled();
});

it("creates a project note from a name alone, refusing an existing note", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const create = vi.fn().mockResolvedValue(undefined);
  let existing: unknown = null;
  plugin.app = { vault: { getAbstractFileByPath: () => existing, create } } as unknown as App;
  const refreshPath = vi.fn().mockResolvedValue(undefined);
  (plugin as unknown as { index: unknown }).index = { refreshPath };
  await expect(plugin.createProjectNote({ name: "Garden" })).resolves.toBe("Garden.md");
  expect(create).toHaveBeenCalledExactlyOnceWith("Garden.md", expect.stringContaining('tags: ["project"]'));
  expect(refreshPath).toHaveBeenCalledWith("Garden.md");
  existing = {};
  await expect(plugin.createProjectNote({ name: "Garden" })).rejects.toThrow("already exists");
});

it("creates a new task in the open view's context: a task view, a project or tag note, else the Inbox", () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const newTask = vi.fn();
  const taskView = Object.assign(Object.create(TaskMainView.prototype) as TaskMainView, { newTask });
  const note = (path: string) => Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: { path } });
  let active: unknown = taskView;
  let recent: unknown = null;
  plugin.app = { workspace: {
    getActiveViewOfType: (type: new () => unknown) => active instanceof type ? active : null,
    getMostRecentLeaf: () => recent ? { view: recent } : null
  } } as unknown as App;
  (plugin as unknown as { index: unknown }).index = { isProject: (path: string) => path === "Work.md", tagForPath: (path: string) => path === "Tags/Errand.md" ? "Errand" : undefined };
  const open = vi.spyOn(plugin, "openEditor").mockImplementation(() => {});
  plugin.newTask();
  expect(newTask).toHaveBeenCalledOnce();
  // From a sidebar, the context is the last view in the main area.
  active = null; recent = taskView;
  plugin.newTask();
  expect(newTask).toHaveBeenCalledTimes(2);
  expect(open).not.toHaveBeenCalled();
  recent = null;
  for (const path of ["Work.md", "Tags/Errand.md", "Loose.md"]) { active = note(path); plugin.newTask(); }
  active = null;
  plugin.newTask();
  expect(open.mock.calls.map(([state]) => state)).toEqual([
    { mode: "all", projectPath: "Work.md" }, { mode: "tags", tag: "Errand", pagePath: "Tags/Errand.md" }, { mode: "inbox" }, { mode: "inbox" }
  ]);
});
