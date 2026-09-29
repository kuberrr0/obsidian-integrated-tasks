// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

const menus: Array<{ items: Array<{ title: string; click: () => void }>; separators: number }> = [];
vi.mock("obsidian", async importOriginal => {
  const original = await importOriginal<typeof import("./obsidian-mock")>();
  class ItemView {
    app: unknown;
    containerEl: HTMLElement;
    navigation = false;
    constructor(leaf: { app?: unknown }) {
      this.app = leaf.app;
      this.containerEl = document.createElement("div");
      this.containerEl.appendChild(document.createElement("div"));
      this.containerEl.appendChild(document.createElement("div"));
      document.body.appendChild(this.containerEl);
    }
    registerDomEvent(target: EventTarget, type: string, callback: EventListener, options?: boolean): void { target.addEventListener(type, callback, options); }
    register(): void {}
  }
  class Menu {
    items: Array<{ title: string; click: () => void }> = [];
    separators = 0;
    constructor() { menus.push(this); }
    addItem(build: (item: Record<string, (value: unknown) => unknown>) => void): this {
      const entry = { title: "", click: () => {} };
      const item: Record<string, (value: unknown) => unknown> = {
        setTitle: value => { entry.title = String(value); return item; },
        setIcon: () => item,
        onClick: value => { entry.click = value as () => void; return item; }
      };
      build(item);
      this.items.push(entry);
      return this;
    }
    addSeparator(): this { this.separators++; return this; }
    showAtPosition(): void {}
  }
  return { ...original, ItemView, Menu, Notice: class {}, setIcon: vi.fn() };
});

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { TaskMainView } from "../src/task-view";
import { DEFAULT_SETTINGS } from "../src/types";
import { todayIso } from "../src/date";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => {
  installObsidianDom();
  // happy-dom has no pointer capture; row drags and swipes call it.
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => { document.body.innerHTML = ""; menus.length = 0; vi.unstubAllGlobals(); });

function note(path: string, count: number, line: (i: number) => string = i => `- [ ] ${path} task ${i}`): [string, string] {
  return [path, Array.from({ length: count }, (_, i) => line(i)).join("\n")];
}

async function setup(notes: Array<[string, string]>, frontmatter: Record<string, Record<string, unknown>> = {}) {
  const files = new Map(notes.map(([path]) => [path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") })]));
  const contents = new Map(notes);
  let emitModify: (file: TFile) => void = () => {};
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      on: (event: string, callback: (file: TFile) => void) => { if (event === "modify") emitModify = callback; return {}; },
      offref: () => {}
    },
    metadataCache: { getFileCache: (file: TFile) => frontmatter[file.path] ? { frontmatter: frontmatter[file.path] } : {}, on: () => ({}), offref: () => {}, getFirstLinkpathDest: (link: string) => files.get(link.endsWith(".md") ? link : `${link}.md`) ?? null },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }) }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const store = { toggle: vi.fn().mockResolvedValue(undefined), bulkDrop: vi.fn().mockResolvedValue([]), bulkChange: vi.fn().mockResolvedValue([]), setStatus: vi.fn().mockResolvedValue([]) };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, index, store, dateFormat: () => "YYYY-MM-DD",
    openEditor: vi.fn(), openTaskView: vi.fn(), undoTaskChange: vi.fn(), openQuickSwitcher: vi.fn(), saveSettings: vi.fn(),
    projectDraft: vi.fn(() => ({ name: "Site", date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "work", archived: false, color: "" })),
    updateProject: vi.fn().mockResolvedValue("Site.md"), deleteProject: vi.fn().mockResolvedValue(undefined)
  };
  const view = new TaskMainView({ app } as unknown as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  const internals = view as unknown as { refresh(): void; content: HTMLElement };
  const edit = async (path: string, content: string) => { contents.set(path, content); emitModify(files.get(path)!); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { view, internals, index, store, plugin, edit, files, content: () => internals.content };
}

const rows = (container: HTMLElement, section?: HTMLElement) => Array.from((section ?? container).querySelectorAll<HTMLElement>(".tm-task-item"));
const sections = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("section.tm-section"));
const key = (target: HTMLElement, key: string, options: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
/** Row actions (S, M, Alt+arrows) need the task selected: click it first. */
const act = (row: HTMLElement, name: string, options: KeyboardEventInit = {}) => { row.click(); return key(row, name, options); };

describe("paged task lists", () => {
  it("keeps rows the user loaded in a later section across re-renders, with a minimum per section", async () => {
    const { view, internals, content } = await setup([note("A.md", 500), note("B.md", 300)]);
    await view.setState({ mode: "all" });
    let [a, b] = sections(content());
    expect(rows(content(), a)).toHaveLength(200);
    expect(rows(content(), b)).toHaveLength(20);
    b.querySelector<HTMLButtonElement>(".tm-show-more-tasks")!.click();
    expect(rows(content(), b)).toHaveLength(220);
    internals.refresh();
    [a, b] = sections(content());
    expect(rows(content(), a)).toHaveLength(200);
    expect(rows(content(), b)).toHaveLength(220);
    expect(b.querySelector(".tm-show-more-tasks")!.textContent).toBe("Show 80 more (80 hidden)");
  });

  it("shows today's tasks even when overdue tasks fill the page", async () => {
    // Local date: an ISO (UTC) date is yesterday or tomorrow for part of the day in many time zones.
    const { view, content } = await setup([note("Late.md", 300, i => `- [ ] Late ${i} 2020-01-01`), note("Now.md", 5, i => `- [ ] Now ${i} ${todayIso()}`)]);
    await view.setState({ mode: "today" });
    const [overdue, today] = sections(content());
    expect(rows(content(), overdue)).toHaveLength(200);
    expect(rows(content(), today)).toHaveLength(5);
  });

  it("moves focus to the first new row when Show more is used from the keyboard, and observes the pane", async () => {
    const observed: IntersectionObserverInit[] = [];
    vi.stubGlobal("IntersectionObserver", class { constructor(_: unknown, options: IntersectionObserverInit) { observed.push(options); } observe(): void {} disconnect(): void {} });
    const { view, internals, content } = await setup([note("A.md", 250)]);
    await view.setState({ mode: "all" });
    expect(observed[0].root).toBe(internals.content);
    const more = content().querySelector<HTMLButtonElement>(".tm-show-more-tasks")!;
    more.focus();
    more.click();
    expect(document.activeElement).toBe(rows(content())[200]);
    expect(content().querySelector(".tm-show-more-tasks")).toBeNull();
    expect(content().querySelector("[aria-live]")!.textContent).toBe("Showing 50 more tasks");
  });
});

describe("re-rendering", () => {
  it("restores focus to the same control and keeps scroll position", async () => {
    const { view, internals, content } = await setup([note("A.md", 30)]);
    await view.setState({ mode: "all" });
    const checkbox = rows(content())[5].querySelector<HTMLInputElement>("[data-tm-focus-key=checkbox]")!;
    checkbox.focus();
    content().scrollTop = 120;
    internals.refresh();
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("data-tm-focus-key")).toBe("checkbox");
    expect(focused.closest(".tm-task-item")!.getAttribute("data-task-id")).toBe("A.md:5");
    expect(content().scrollTop).toBe(120);
  });

  it("restores the scroll position of elements that are recreated, such as the board", async () => {
    const { view, internals, content } = await setup([note("A.md", 3), note("B.md", 3)]);
    await view.setState({ mode: "all", layout: "kanban" });
    const board = content().querySelector<HTMLElement>("[data-tm-scroll-key=kanban]")!;
    board.scrollLeft = 300;
    internals.refresh();
    const next = content().querySelector<HTMLElement>("[data-tm-scroll-key=kanban]")!;
    expect(next).not.toBe(board);
    expect(next.scrollLeft).toBe(300);
  });

  it("focuses the row now at the same position when the focused task disappears", async () => {
    const { view, content, edit } = await setup([note("A.md", 5)]);
    await view.setState({ mode: "all" });
    rows(content())[2].focus();
    await edit("A.md", "- [ ] A.md task 0\n- [ ] A.md task 1\n- [x] A.md task 2\n- [ ] A.md task 3\n- [ ] A.md task 4");
    (view as unknown as { refresh(): void }).refresh();
    expect((document.activeElement as HTMLElement).getAttribute("data-task-id")).toBe("A.md:3");
  });

  it("keeps the options panel, an open dropdown and a half-built filter when tasks change", async () => {
    const { view, internals, content } = await setup([note("A.md", 3)]);
    await view.setState({ mode: "all" });
    content().querySelector<HTMLButtonElement>(".tm-filter-toggle")!.click();
    const panel = content().querySelector(".tm-options-panel")!;
    content().querySelector<HTMLButtonElement>('[data-tm-focus-key="option-title"]')!.click();
    content().querySelector<HTMLElement>(".tm-options-option.is-action")!.click();
    const condition = content().querySelector<HTMLSelectElement>(".tm-options-conditions select")!;
    condition.value = "contains";
    content().querySelector<HTMLButtonElement>('[data-tm-focus-key="option-status"]')!.click();
    internals.refresh();
    expect(content().querySelector(".tm-options-panel")).toBe(panel);
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect(content().querySelector(".tm-options-dropdown [role=listbox]")!.getAttribute("aria-label")).toBe("Status");
    expect(content().querySelector<HTMLSelectElement>(".tm-options-conditions select")!.value).toBe("contains");
  });

  it("coalesces index updates into one refresh per frame and cancels it when the view closes", async () => {
    const frames: FrameRequestCallback[] = [];
    const { view, index, edit } = await setup([note("A.md", 3)]);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    await view.onOpen();
    const refresh = vi.spyOn(view as unknown as { refresh(): void }, "refresh");
    await edit("A.md", "- [ ] one");
    await edit("A.md", "- [ ] one\n- [ ] two");
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(refresh).toHaveBeenCalledOnce();
    await edit("A.md", "- [ ] three");
    await view.onClose();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(index.allTasks().map(task => task.title)).toEqual(["three"]);
  });
});

describe("keyboard", () => {
  it("keeps one row in the tab order and row controls out of it until the row is focused", async () => {
    const { view, content } = await setup([note("A.md", 4, i => `- [ ] Task ${i} 2026-10-0${i + 1} #[[tag]]`)]);
    await view.setState({ mode: "all" });
    expect(rows(content()).map(row => row.tabIndex)).toEqual([0, -1, -1, -1]);
    const controls = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>("input, button, [role=button]")).map(control => control.tabIndex);
    expect(new Set(controls(rows(content())[1]))).toEqual(new Set([-1]));
    rows(content())[1].focus();
    expect(rows(content()).map(row => row.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(new Set(controls(rows(content())[1]))).toEqual(new Set([0]));
    expect(rows(content())[1].hasAttribute("aria-label")).toBe(false);
  });

  it("moves the selection with arrows and extends it with Shift; with nothing selected, arrows start at an end", async () => {
    const { view, content } = await setup([note("A.md", 4)]);
    await view.setState({ mode: "all" });
    const lines = () => view.getSelectedTasks().map(task => task.line);
    rows(content())[2].focus();
    // Nothing selected, so nothing is "active": Down starts at the first task.
    key(rows(content())[2], "ArrowDown");
    expect(lines()).toEqual([0]);
    expect(document.activeElement).toBe(rows(content())[0]);
    key(rows(content())[0], "ArrowDown");
    expect(lines()).toEqual([1]);
    expect(document.activeElement).toBe(rows(content())[1]);
    key(rows(content())[1], "ArrowDown", { shiftKey: true });
    expect(lines()).toEqual([1, 2]);
    expect(rows(content())[2].querySelector(".tm-selected-marker")!.textContent).toBe("Selected");
    key(rows(content())[2], "End");
    expect(lines()).toEqual([3]);
    expect(document.activeElement).toBe(rows(content())[3]);
    // Escape clears the selection; Up then starts at the last task.
    key(rows(content())[3], "Escape");
    expect(lines()).toEqual([]);
    key(rows(content())[3], "ArrowUp");
    expect(lines()).toEqual([3]);
  });

  it("selects a focused task on Enter instead of opening it while nothing is selected", async () => {
    const { view, content, plugin } = await setup([note("A.md", 2)]);
    await view.setState({ mode: "all" });
    rows(content())[1].focus();
    key(rows(content())[1], "Enter");
    expect(view.getSelectedTasks().map(task => task.line)).toEqual([1]);
    expect(plugin.openEditor).not.toHaveBeenCalled();
    expect(document.querySelector(".tm-task-menu")).toBeNull();
  });

  it("reorders, nests and outdents with Alt+arrows", async () => {
    const { view, content, store, index, plugin } = await setup([["A.md", "- [ ] One\n- [ ] Two\n  - [ ] Child\n- [ ] Three"]]);
    plugin.settings.showSubtasks = true;
    await view.setState({ mode: "all" });
    const byTitle = (title: string) => rows(content()).find(row => row.textContent!.includes(title))!;
    const task = (title: string) => index.allTasks().find(item => item.title === title)!;
    act(byTitle("Three"), "ArrowUp", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Three")], { destination: "A.md" }, task("Two"), "before");
    act(byTitle("Two"), "ArrowRight", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Two")], { destination: "A.md" }, task("One"), "child");
    act(byTitle("Child"), "ArrowLeft", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Child")], { destination: "A.md" }, task("Two"), "after");
  });

  it("offers only the places to move to in the M menu", async () => {
    const { view, content, store, index } = await setup([note("A.md", 2), note("B.md", 2)]);
    await view.setState({ mode: "all" });
    act(rows(content())[0], "m");
    expect(menus[0].items.map(item => item.title)).toEqual(["Move to A", "Move to B"]);
    menus[0].items[1].click();
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([index.allTasks()[0]], { destination: "B.md" }, undefined, undefined);
  });

  it("opens the status list on S, for the whole selection", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [/] Draft\n- [ ] Review\n- [ ] Send"]]);
    await view.setState({ mode: "all" });
    act(rows(content())[0], "s");
    const popover = document.querySelector<HTMLElement>(".tm-choice-popover")!;
    expect(popover.getAttribute("aria-label")).toBe("Status");
    expect(popover.querySelector("[aria-selected=true]")!.getAttribute("data-value")).toBe("doing");
    // S again moves on through the statuses, round to the first after the last; Enter sets the one reached.
    key(document.activeElement as HTMLElement, "s");
    expect(document.activeElement!.getAttribute("data-value")).toBe("waiting");
    for (const next of ["done", "cancelled", "todo"]) {
      key(document.activeElement as HTMLElement, "S", { shiftKey: true });
      expect(document.activeElement!.getAttribute("data-value")).toBe(next);
    }
    key(document.activeElement as HTMLElement, "s");
    key(document.activeElement as HTMLElement, "s");
    expect(store.setStatus).not.toHaveBeenCalled();
    key(document.activeElement as HTMLElement, "Enter");
    expect(store.setStatus).toHaveBeenLastCalledWith([index.allTasks()[0]], "waiting");
    rows(content())[1].click();
    key(rows(content())[1], "ArrowDown", { shiftKey: true });
    key(rows(content())[2], "s");
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='cancelled']")!.click();
    expect(store.setStatus).toHaveBeenLastCalledWith(index.allTasks().slice(1), "cancelled");
  });

  it("completes the selection on C, or reopens it when all of it is complete, and does nothing once deselected", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] One\n- [x] Two"]]);
    view["showCompleted"] = true;
    await view.setState({ mode: "all" });
    expect(rows(content())[0].getAttribute("aria-keyshortcuts")).toMatch(/ M Shift\+T D Shift\+D P T G R S Shift\+S C$/);
    act(rows(content())[0], "c");
    expect(store.setStatus).toHaveBeenLastCalledWith([index.allTasks()[0]], "done");
    act(rows(content())[1], "c");
    expect(store.setStatus).toHaveBeenLastCalledWith([index.allTasks()[1]], "todo");
    // After Escape the row keeps focus but is no longer selected, so the letters do nothing.
    key(rows(content())[0], "Escape");
    key(rows(content())[0], "c");
    key(rows(content())[0], "s");
    expect(store.setStatus).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".tm-choice-popover")).toBeNull();
  });

  it("moves through the priorities on P in the priority list, setting one with Enter", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] Report p2"]]);
    const bulkUpdate = vi.fn().mockResolvedValue([]);
    (store as unknown as { bulkUpdate: typeof bulkUpdate }).bulkUpdate = bulkUpdate;
    await view.setState({ mode: "all" });
    act(rows(content())[0], "p");
    expect(document.activeElement!.getAttribute("data-value")).toBe("2");
    const values = ["3", "", "1", "2"].map(() => { key(document.activeElement as HTMLElement, "p"); return document.activeElement!.getAttribute("data-value"); });
    expect(values).toEqual(["3", "", "1", "2"]);
    key(document.activeElement as HTMLElement, "p");
    expect(bulkUpdate).not.toHaveBeenCalled();
    key(document.activeElement as HTMLElement, "Enter");
    expect(bulkUpdate).toHaveBeenLastCalledWith([index.allTasks()[0]], { priority: 3 });
  });

  it("opens the task's actions on E, for the selection", async () => {
    const { view, content } = await setup([note("A.md", 2)]);
    await view.setState({ mode: "all" });
    key(rows(content())[0], "e");
    expect(document.querySelector(".tm-task-menu")).toBeNull();
    act(rows(content())[0], "e");
    const menu = document.querySelector<HTMLElement>(".tm-task-menu")!;
    expect(menu.getAttribute("aria-label")).toBe("Task actions");
    expect(document.activeElement?.querySelector(".tm-task-menu-label")?.textContent).toBe("Complete");
    menu.remove();
  });

  it("schedules for today on Shift+T and opens each property's popover from its letter", async () => {
    const { view, content, store, index } = await setup([note("A.md", 2)]);
    const bulkUpdate = vi.fn().mockResolvedValue([]);
    (store as unknown as { bulkUpdate: typeof bulkUpdate }).bulkUpdate = bulkUpdate;
    await view.setState({ mode: "all" });
    act(rows(content())[0], "T", { shiftKey: true });
    expect(bulkUpdate).toHaveBeenLastCalledWith([index.allTasks()[0]], { scheduledDate: todayIso() });
    const opened = (letter: string, shiftKey = false) => {
      document.querySelectorAll(".tm-date-popover, .tm-choice-popover, .tm-tags-popover").forEach(element => element.remove());
      key(rows(content())[0], letter, { shiftKey });
      return document.querySelector<HTMLElement>(".tm-date-popover, .tm-choice-popover, .tm-tags-popover")?.getAttribute("aria-label");
    };
    expect([opened("d"), opened("D", true), opened("p"), opened("t"), opened("g"), opened("r"), opened("S", true)])
      .toEqual(["When", "Deadline", "Priority", "Tags", "Move to project", "Repeat", "Snooze"]);
  });

  it("marks each status on the row and in the checkbox's name, and reopens a cancelled task from its checkbox", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] One p1\n- [/] Two p2\n- [?] Three\n- [x] Four\n- [-] Five"]]);
    view["showCompleted"] = true;
    await view.setState({ mode: "all" });
    const boxes = rows(content()).map(row => row.querySelector<HTMLInputElement>("input.tm-task-checkbox")!);
    expect(boxes.map(box => box.getAttribute("aria-label"))).toEqual([
      "Complete One (priority 1)", "Complete Two (in progress, priority 2)", "Complete Three (waiting)", "Complete Four", "Complete Five (cancelled)"]);
    expect(boxes.map(box => ["is-doing", "is-waiting", "is-cancelled"].filter(name => box.classList.contains(name)))).toEqual([[], ["is-doing"], ["is-waiting"], [], ["is-cancelled"]]);
    expect(boxes.map(box => box.checked)).toEqual([false, false, false, true, true]);
    expect(rows(content()).map(row => row.classList.contains("is-cancelled"))).toEqual([false, false, false, false, true]);
    expect(rows(content()).map(row => row.classList.contains("is-completed"))).toEqual([false, false, false, true, true]);
    boxes[4].click();
    expect(store.toggle).toHaveBeenLastCalledWith(index.allTasks()[4], false);
    boxes[1].click();
    expect(store.toggle).toHaveBeenLastCalledWith(index.allTasks()[1], true);
  });
});

describe("undo and snooze", () => {
  it("undoes the last task change on Cmd+Z, but not while typing in a field", async () => {
    const { view, content, plugin } = await setup([note("A.md", 2)]);
    await view.onOpen();
    await view.setState({ mode: "all" });
    key(rows(content())[0], "z", { metaKey: true });
    expect(plugin.undoTaskChange).toHaveBeenCalledOnce();
    key(rows(content())[0], "z", { metaKey: true, shiftKey: true });
    const search = content().appendChild(document.createElement("input"));
    key(search, "z", { metaKey: true });
    expect(plugin.undoTaskChange).toHaveBeenCalledOnce();
  });

  it("snoozes from the Shift+S list, offering Stop snoozing only for a snoozed task, which stays visible in All Tasks", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] Later >someday\n- [ ] Now"]]);
    const bulkUpdate = vi.fn().mockResolvedValue([]);
    (store as unknown as { bulkUpdate: typeof bulkUpdate }).bulkUpdate = bulkUpdate;
    await view.setState({ mode: "all" });
    const row = (title: string) => rows(content()).find(item => item.textContent!.includes(title))!;
    expect(row("Later").querySelector(".tm-task-defer")).toBeNull();
    const values = () => Array.from(document.querySelectorAll(".tm-choice-popover [role=option]")).map(option => option.getAttribute("data-value"));
    act(row("Later"), "S", { shiftKey: true });
    expect(values()).toContain("");
    act(row("Now"), "S", { shiftKey: true });
    expect(values()).not.toContain("");
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='someday']")!.click();
    expect(bulkUpdate).toHaveBeenLastCalledWith([index.allTasks().find(task => task.title === "Now")], { deferDate: undefined, someday: true });
  });
});

describe("today header, density and gestures", () => {
  const pointer = (target: HTMLElement, type: string, x: number, y = 0, pointerType = "touch") =>
    target.dispatchEvent(new PointerEvent(type, { pointerType, pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const swipe = (row: HTMLElement, dx: number, dy = 0, pointerType = "touch") => {
    pointer(row, "pointerdown", 100, 100, pointerType);
    pointer(row, "pointermove", 100 + dx / 2, 100 + dy / 2, pointerType);
    pointer(row, "pointermove", 100 + dx, 100 + dy, pointerType);
    pointer(row, "pointerup", 100 + dx, 100 + dy, pointerType);
  };

  it("summarises today in the Today header", async () => {
    const today = todayIso();
    const { view, content } = await setup([["A.md", `- [x] Done ${today}\n- [ ] Write ${today} 1h30m\n- [ ] Late 2020-01-01\n- [ ] Later ${today} 23:59`]]);
    await view.setState({ mode: "today" });
    const summary = content().querySelector<HTMLElement>(".tm-today-summary")!;
    expect(summary.querySelector(".tm-project-progress[role=progressbar]")!.getAttribute("aria-label")).toBe("Today: 1 of 3 tasks completed");
    expect(summary.textContent).toContain("1h30m planned");
    expect(summary.textContent).toContain("1 overdue");
    expect(summary.textContent).toMatch(/Next: Later at 11:59 PM · (in|now)/);
    await view.setState({ mode: "all" });
    expect(content().querySelector(".tm-today-summary")).toBeNull();
  });

  it("colours the source label of tasks from coloured projects, except on the project's own page", async () => {
    const { view, content } = await setup([note("Site.md", 1), note("Loose.md", 1)], { "Site.md": { tags: ["project"], color: "blue" } });
    await view.setState({ mode: "all" });
    const [site, loose] = [rows(content()).find(row => row.textContent!.includes("Site"))!, rows(content()).find(row => row.textContent!.includes("Loose"))!];
    expect(site.style.getPropertyValue("--tm-project-color")).toBe("var(--color-blue)");
    expect(site.querySelector(".tm-project-dot")).toBeNull();
    expect(loose.style.getPropertyValue("--tm-project-color")).toBe("");
    await view.setState({ mode: "all", pagePath: "Site.md" });
    expect(rows(content())[0].style.getPropertyValue("--tm-project-color")).toBe("");
  });

  it("applies the compact density class", async () => {
    const { view, content, plugin } = await setup([note("A.md", 1)]);
    (plugin.settings as Record<string, unknown>).density = "compact";
    await view.setState({ mode: "all" });
    expect(content().classList.contains("tm-density-compact")).toBe(true);
  });

  it("completes on a right swipe and snoozes until tomorrow on a left swipe, touch only", async () => {
    const { view, content, store, index } = await setup([note("A.md", 2)]);
    await view.setState({ mode: "all" });
    swipe(rows(content())[0], 100);
    expect(store.toggle).toHaveBeenCalledWith(index.allTasks()[0], true);
    swipe(rows(content())[1], -100);
    await Promise.resolve();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    expect(store.bulkDrop).toHaveBeenLastCalledWith([index.allTasks()[1]], { property: "defer", value: todayIso(tomorrow) }, undefined, undefined);
    store.toggle.mockClear(); store.bulkDrop.mockClear();
    swipe(rows(content())[0], 40);
    swipe(rows(content())[0], 30, 120);
    swipe(rows(content())[0], 100, 0, "mouse");
    expect(store.toggle).not.toHaveBeenCalled();
    expect(store.bulkDrop).not.toHaveBeenCalled();
  });

  it("opens the quick switcher on Cmd+K", async () => {
    const { view, content, plugin } = await setup([note("A.md", 1)]);
    await view.onOpen();
    await view.setState({ mode: "all" });
    key(rows(content())[0], "k", { metaKey: true });
    expect(plugin.openQuickSwitcher).toHaveBeenCalledOnce();
  });
});

describe("weekly review", () => {
  const plus = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return todayIso(date); };
  const reviewSections = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".tm-review-section"));
  const section = (container: HTMLElement, title: string) => reviewSections(container).find(item => item.querySelector("h2")!.textContent!.startsWith(title))!;

  async function review() {
    const setupResult = await setup([
      ["Work.md", [`- [ ] Late ${plus(-3)}`, `- [ ] Due soon {${plus(3)}}`, `- [ ] Due later {${plus(30)}}`, "- [ ] Maybe >someday", `- [ ] Hidden late ${plus(-3)} >someday`,
        "- [?] Hear back from Sam", `- [-] Dropped late ${plus(-3)}`].join("\n")],
      ["Old.md", "- [ ] Forgotten idea"],
      ["Done project.md", "- [x] Shipped"]
    ], { "Done project.md": { tags: ["project"] }, "Work.md": { tags: ["project"] } });
    Object.assign(setupResult.files.get("Old.md")!, { stat: { mtime: Date.now() - 60 * 86_400_000 } });
    Object.assign(setupResult.files.get("Work.md")!, { stat: { mtime: Date.now() } });
    await setupResult.view.setState({ mode: "review" });
    return setupResult;
  }

  it("lists what needs attention, section by section", async () => {
    const { content } = await review();
    expect(reviewSections(content()).map(item => item.querySelector("h2 span")!.textContent)).toEqual([
      "Completed this week", "Overdue", "Waiting", "Routines behind", "Deadlines in the next 7 days", "Untouched for a month", "Projects without a next action", "Someday"]);
    const titles = (title: string) => rows(content(), section(content(), title)).map(row => row.querySelector(".tm-task-title")!.textContent);
    expect(titles("Overdue")).toEqual(["Late"]);
    expect(titles("Waiting")).toEqual(["Hear back from Sam"]);
    expect(section(content(), "Waiting").textContent).toContain("Follow up on these.");
    expect(titles("Deadlines in the next 7 days")).toEqual(["Due soon"]);
    expect(titles("Untouched for a month")).toEqual(["Forgotten idea"]);
    expect(titles("Someday").sort()).toEqual(["Hidden late", "Maybe"]);
    expect(section(content(), "Projects without a next action").textContent).toContain("Done project");
    expect(section(content(), "Projects without a next action").textContent).not.toContain("Work");
    expect(section(content(), "Completed this week").textContent).toContain("Turn on Record completion dates");
  });

  it("lists tasks completed in the last 7 days, and inline repeats that fell behind", async () => {
    const { view, content, plugin } = await setup([["A.md", [`- [x] Shipped ✓${plus(-2)}`, `- [x] Long ago ✓${plus(-20)}`, `- [ ] Water plants ${plus(-4)} every week`, `- [-] Dropped ✓${plus(-1)}`].join("\n")]]);
    plugin.settings.completionDates = true;
    await view.setState({ mode: "review" });
    const titles = (title: string) => rows(content(), section(content(), title)).map(row => row.querySelector(".tm-task-title")!.textContent);
    expect(titles("Completed this week")).toEqual(["Shipped"]);
    expect(titles("Routines behind")).toEqual(["Water plants"]);
    expect(titles("Overdue")).toEqual([]);
  });

  it("marks sections reviewed for the week, collapsing them, and starts over", async () => {
    const { view, content, plugin } = await review();
    section(content(), "Overdue").querySelector<HTMLInputElement>(".tm-review-check input")!.click();
    await vi.waitFor(() => expect(plugin.saveSettings).toHaveBeenCalled());
    const week = plugin.settings.weeklyReview;
    expect(week.reviewed).toEqual(["overdue"]);
    expect(new Date(`${week.week}T12:00`).getDay()).toBe(1);
    await vi.waitFor(() => expect(section(content(), "Overdue").classList.contains("is-reviewed")).toBe(true));
    expect(rows(content(), section(content(), "Overdue"))).toHaveLength(0);
    expect(content().querySelector(".tm-review-progress")!.textContent).toContain("1 of 8 reviewed");
    plugin.settings.weeklyReview = { week: "2020-01-06", reviewed: ["overdue"] };
    await view.setState({ mode: "review" });
    view.render();
    expect(section(content(), "Overdue").classList.contains("is-reviewed")).toBe(false);
  });
});

it("lays board cards out like an open task card in the Things style", async () => {
  const { view, content, plugin } = await setup([["A.md", "- [ ] Plan the day 2026-09-17 {2026-09-30} p1 #[[Errand]]\n    - Pack a map\n    - [ ] Step\n- [ ] Plain"]]);
  plugin.settings.style = "things";
  await view.setState({ mode: "all", layout: "kanban" });
  const card = Array.from(content().querySelectorAll<HTMLElement>(".tm-things-board-card")).find(row => row.textContent!.includes("Plan the day"))!;
  const parts = Array.from(card.querySelector(".tm-task-content")!.children).map(child => child.className);
  expect(parts).toEqual(["tm-task-primary", "tm-things-board-notes", "tm-things-card-properties"]);
  // The notes show as text, and a board card has no subtask mark.
  expect(card.querySelector(".tm-things-checklist")).toBeNull();
  expect(card.querySelector(".tm-things-board-notes")!.textContent).toBe("Pack a map");
  expect(Array.from(card.querySelectorAll(".tm-things-card-tag")).map(tag => tag.textContent)).toEqual(["Errand"]);
  expect(card.querySelectorAll(".tm-things-card-property").length).toBe(3);
  // No one-line row parts on a board card.
  expect(card.querySelector(".tm-things-lead, .tm-things-trailing")).toBeNull();
  const plain = Array.from(content().querySelectorAll<HTMLElement>(".tm-things-board-card")).find(row => row.textContent!.includes("Plain"))!;
  expect(Array.from(plain.querySelector(".tm-task-content")!.children).map(child => child.className)).toEqual(["tm-task-primary"]);
});

it("lists a subtask on its own row only with Show subtasks on, or when its task is not in the view", async () => {
  const { view, content, plugin } = await setup([["A.md", `- [ ] Parent 2026-10-20\n  - [ ] Child ${todayIso()}\n- [ ] Other`]]);
  const titles = () => Array.from(content().querySelectorAll<HTMLElement>(".tm-task-row .tm-task-title")).map(title => title.textContent);
  await view.setState({ mode: "all" });
  expect(titles()).toEqual(["Parent", "Other"]);
  // Nothing to fold without subtask rows; the parent still marks that it has subtasks.
  expect(content().querySelector(".tm-row-fold")).toBeNull();
  expect(content().querySelector(".tm-things-checklist")).not.toBeNull();
  // Today holds the child but not its task, so the child shows there.
  await view.setState({ mode: "today" });
  expect(titles()).toEqual(["Child"]);
  plugin.settings.showSubtasks = true;
  await view.setState({ mode: "all" });
  expect(titles()).toEqual(["Parent", "Child", "Other"]);
});

describe("folding", () => {
  const titles = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".tm-task-row .tm-task-title")).map(title => title.textContent);

  it("folds a task's subtasks away from its chevron or with Left and Right", async () => {
    const { view, content, plugin } = await setup([["A.md", "- [ ] Parent\n  - [ ] Child\n    - [ ] Grandchild\n- [ ] Other"]]);
    plugin.settings.showSubtasks = true;
    await view.setState({ mode: "all" });
    expect(titles(content())).toEqual(["Parent", "Child", "Grandchild", "Other"]);
    // Only rows with subtasks get a chevron.
    expect(content().querySelectorAll(".tm-row-fold")).toHaveLength(2);
    const parent = () => rows(content()).find(row => row.textContent!.includes("Parent"))!;
    parent().querySelector<HTMLElement>(".tm-row-fold")!.click();
    expect(titles(content())).toEqual(["Parent", "Other"]);
    expect(parent().classList.contains("is-folded")).toBe(true);
    expect(parent().querySelector(".tm-row-fold")!.getAttribute("aria-expanded")).toBe("false");
    key(parent(), "ArrowRight");
    expect(titles(content())).toEqual(["Parent", "Child", "Grandchild", "Other"]);
    key(parent(), "ArrowLeft");
    expect(titles(content())).toEqual(["Parent", "Other"]);
  });

  it("folds a group's tasks away from its heading", async () => {
    const { view, content } = await setup([note("A.md", 2), note("B.md", 1)]);
    await view.setState({ mode: "all" });
    const section = (name: string) => Array.from(content().querySelectorAll<HTMLElement>(".tm-section")).find(item => item.querySelector("h2")!.textContent!.includes(name))!;
    section("A").querySelector<HTMLElement>(".tm-group-fold")!.click();
    expect(section("A").classList.contains("is-folded")).toBe(true);
    expect(section("A").querySelectorAll(".tm-task-row")).toHaveLength(0);
    expect(section("B").querySelectorAll(".tm-task-row")).toHaveLength(1);
    section("A").querySelector<HTMLElement>(".tm-group-fold")!.click();
    expect(section("A").querySelectorAll(".tm-task-row")).toHaveLength(2);
  });

  it("keeps folds across a reload of the same page and drops them on another page", async () => {
    const { view, content, plugin } = await setup([["A.md", "- [ ] Parent\n  - [ ] Child"]]);
    plugin.settings.showSubtasks = true;
    await view.setState({ mode: "all" });
    content().querySelector<HTMLElement>(".tm-row-fold")!.click();
    const saved = view.getState();
    expect(saved.folded).toEqual(["task:A.md#Parent"]);
    await view.setState({ mode: "today" });
    await view.setState({ ...saved, folded: undefined, mode: "all" });
    expect(titles(content())).toEqual(["Parent", "Child"]);
    await view.setState(saved);
    expect(titles(content())).toEqual(["Parent"]);
  });
});

it("lays tag rows out on one line in the Things style", async () => {
  const { view, content, plugin } = await setup([["A.md", "- [ ] One #[[Errand]]\n- [ ] Two #[[Errand]]\n- [x] Three #[[Errand]]\n- [x] Four #[[Office]]"]]);
  plugin.settings.style = "things";
  await view.setState({ mode: "tags" });
  const rows = Array.from(content().querySelectorAll<HTMLElement>(".tm-things-tag-row"));
  expect(rows.map(row => Array.from(row.querySelector(".tm-task-primary")!.children).map(child => [child.className, child.textContent]))).toEqual([
    [["tm-task-title", "Errand"], ["tm-things-count", "2"], ["tm-things-trailing tm-things-tag-done", "1 completed"]],
    [["tm-task-title", "Office"], ["tm-things-trailing tm-things-tag-done", "1 completed"]]
  ]);
  expect(content().querySelector(".tm-things-tag-row .tm-task-metadata")).toBeNull();
});

it("shows the tag list's empty message outside the list", async () => {
  const { view, content } = await setup([note("A.md", 1)]);
  await view.setState({ mode: "tags" });
  const empty = content().querySelector<HTMLElement>(".tm-empty")!;
  expect(empty.hidden).toBe(false);
  expect(empty.closest("[role=list]")).toBeNull();
});

describe("project actions", () => {
  const blank = { name: "Site", date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "work", archived: false, color: "" };
  const menuButton = (label: string) => Array.from(document.querySelectorAll<HTMLElement>(".tm-task-menu button"))
    .find(button => button.getAttribute("aria-label") === label || button.querySelector(".tm-task-menu-label")?.textContent === label)!;
  /** Applies the last change sent to updateProject to a blank draft. */
  const lastChange = (plugin: { updateProject: ReturnType<typeof vi.fn> }) => (plugin.updateProject.mock.lastCall![1] as (draft: typeof blank) => typeof blank)(blank);

  it("shows the … button beside a project's title, opening its actions", async () => {
    const { view, content, plugin } = await setup([note("Site.md", 1)], { "Site.md": { tags: ["project", "work"] } });
    await view.setState({ mode: "all", pagePath: "Site.md" });
    const more = content().querySelector<HTMLElement>(".tm-title-row .tm-title-more")!;
    expect(more.getAttribute("aria-label")).toBe("Project actions");
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const labels = Array.from(document.querySelectorAll(".tm-task-menu button")).map(button => button.getAttribute("aria-label") ?? button.querySelector(".tm-task-menu-label")?.textContent);
    expect(labels).toEqual(["P1", "P2", "P3", "Start date", "End date", "Deadline", "Parent project", "Tags", "Color", "Rename", "Archive project", "Open note", "Delete project"]);
    menuButton("P1").click();
    expect(plugin.updateProject.mock.lastCall![0]).toBe("Site.md");
    expect(lastChange(plugin).priority).toBe("1");
    expect(document.querySelector(".tm-task-menu")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("edits a project date in a date-only popover beside the menu", async () => {
    const { view, content, plugin } = await setup([note("Site.md", 1)], { "Site.md": { tags: ["project"] } });
    await view.setState({ mode: "all", pagePath: "Site.md" });
    content().querySelector<HTMLElement>(".tm-title-more")!.click();
    menuButton("Deadline").click();
    const popover = document.querySelector<HTMLElement>(".tm-date-popover")!;
    expect(popover.getAttribute("aria-label")).toBe("Deadline");
    const input = popover.querySelector<HTMLInputElement>("input")!;
    expect(input.placeholder).toBe("Type a date");
    input.value = "2026-10-05";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(lastChange(plugin).deadline).toBe("2026-10-05");
    // Choosing closes the menu too.
    expect(document.querySelector(".tm-task-menu")).toBeNull();
  });

  it("renames, recolours and re-parents a project, leaving out itself and its subprojects", async () => {
    const { view, content, plugin } = await setup([note("Site.md", 1), note("Sub.md", 1), note("Other.md", 1)],
      { "Site.md": { tags: ["project"] }, "Sub.md": { tags: ["project"], parent: "[[Site]]" }, "Other.md": { tags: ["project"] } });
    await view.setState({ mode: "all", pagePath: "Site.md" });
    const open = (label: string) => { content().querySelector<HTMLElement>(".tm-title-more")!.click(); menuButton(label).click(); return document.querySelector<HTMLElement>(".tm-choice-popover")!; };
    const enter = (popover: HTMLElement, text: string) => {
      const input = popover.querySelector<HTMLInputElement>("input")!;
      input.value = text; input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    };
    enter(open("Rename"), "Website");
    expect(lastChange(plugin).name).toBe("Website");
    enter(open("Color"), "#3B82F6");
    expect(lastChange(plugin).color).toBe("#3b82f6");
    const parent = open("Parent project");
    expect(Array.from(parent.querySelectorAll("[role=option]")).map(option => option.textContent)).toEqual(["Other", "No parent"]);
    parent.querySelector<HTMLElement>("[data-value='Other.md']")!.click();
    expect(lastChange(plugin).parent).toBe("Other.md");
  });

  it("asks before deleting a project, from the menu or a right-click on its row", async () => {
    const { view, content } = await setup([note("Site.md", 1)], { "Site.md": { tags: ["project"] } });
    const confirm = vi.spyOn(view as unknown as { confirmDeleteProject(project: unknown): void }, "confirmDeleteProject").mockImplementation(() => {});
    await view.setState({ mode: "projects" });
    const row = content().querySelector<HTMLElement>(".tm-project-row")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
    menuButton("Delete project").click();
    expect(confirm).toHaveBeenCalledOnce();
    expect((confirm.mock.calls[0][0] as { path: string }).path).toBe("Site.md");
  });
});

describe("Things card subtasks", () => {
  it("leaves subtasks to their own rows when Show subtasks is on", async () => {
    const { view, content, index, plugin } = await setup([["A.md", "- [ ] Parent\n  - [ ] Child"]]);
    await view.setState({ mode: "all" });
    const parent = index.allTasks()[0];
    const open = (showSubtasks: boolean) => {
      plugin.settings.showSubtasks = showSubtasks;
      (view as unknown as { expanded?: object }).expanded = { id: parent.id, title: "Parent", notes: "" };
      (view as unknown as { renderTaskResults(): void }).renderTaskResults();
      return { checks: content().querySelectorAll(".tm-things-card .tm-things-card-check:not(.is-new)").length, childRow: rows(content()).some(row => row.textContent!.includes("Child")) };
    };
    expect(open(false)).toEqual({ checks: 1, childRow: false });
    expect(open(true)).toEqual({ checks: 0, childRow: true });
  });
});

describe("Insert task in the Things style", () => {
  async function inserted() {
    const inbox = DEFAULT_SETTINGS.inboxPath;
    const ctx = await setup([[inbox, "- [ ] Existing"]]);
    const { view, plugin, store, edit } = ctx;
    plugin.settings.style = "things";
    const extra = store as unknown as Record<string, ReturnType<typeof vi.fn>>;
    extra.create = vi.fn(async (draft: { title: string }) => { await edit(inbox, `- [ ] ${draft.title}\n- [ ] Existing`); return 0; });
    extra.delete = vi.fn().mockResolvedValue(undefined);
    extra.update = vi.fn().mockResolvedValue(undefined);
    (plugin as unknown as { newTaskDraft: () => object }).newTaskDraft = () => ({ title: "", completed: false, indent: 0, destination: inbox });
    await view.setState({ mode: "inbox" });
    view.newTask();
    await vi.waitFor(() => expect(ctx.content().querySelector(".tm-things-card")).not.toBeNull());
    return { ...ctx, extra, card: () => ctx.content().querySelector<HTMLElement>(".tm-things-card")! };
  }

  it("adds the task and opens its card with the title empty, instead of the editor", async () => {
    const { extra, card, plugin } = await inserted();
    expect(extra.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "New To-Do" }));
    const title = card().querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    expect(title.value).toBe("");
    expect(title.placeholder).toBe("New To-Do");
    expect(plugin.openEditor).not.toHaveBeenCalled();
  });

  it("removes the task when its card closes with nothing typed", async () => {
    const { extra, view, index } = await inserted();
    await (view as unknown as { collapseCard(): Promise<void> }).collapseCard();
    expect(extra.delete).toHaveBeenCalledExactlyOnceWith(index.allTasks().find(task => task.title === "New To-Do"));
    expect(extra.update).not.toHaveBeenCalled();
  });

  it("saves the typed title when its card closes", async () => {
    const { extra, view, card } = await inserted();
    const title = card().querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    title.value = "Buy milk p1";
    title.dispatchEvent(new Event("input"));
    await (view as unknown as { collapseCard(): Promise<void> }).collapseCard();
    expect(extra.delete).not.toHaveBeenCalled();
    expect(extra.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "New To-Do" }), expect.objectContaining({ title: "Buy milk", priority: 1 }));
  });

  it("opens the task editor in other styles", async () => {
    const { view, plugin } = await setup([note("A.md", 1)]);
    plugin.settings.style = "griply";
    await view.setState({ mode: "today" });
    view.newTask();
    expect(plugin.openEditor).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: "today" }));
  });
});

describe("row marks", () => {
  it("marks a task's subtasks only while they are not listed as rows, and never on a board", async () => {
    const { view, content, plugin } = await setup([["A.md", "- [ ] Plan\n  - [ ] Step\n  - Notes"]]);
    plugin.settings.style = "things";
    const marks = async (showSubtasks: boolean, layout: string) => {
      plugin.settings.showSubtasks = showSubtasks;
      await view.setState({ mode: "all", layout } as never);
      const row = rows(content()).find(item => item.textContent!.includes("Plan"))!;
      return row.querySelector(".tm-things-checklist") !== null;
    };
    expect(await marks(false, "list")).toBe(true);
    expect(await marks(true, "list")).toBe(false);
    expect(await marks(false, "kanban")).toBe(false);
    // Notes never get a mark, anywhere.
    expect(content().querySelector(".tm-description-indicator")).toBeNull();
  });
});

describe("copy, paste, delete and duplicate on selected tasks", () => {
  async function selected() {
    const ctx = await setup([["A.md", "- [ ] One\n- [ ] Two\n- [ ] Three"]]);
    const extra = ctx.store as unknown as Record<string, ReturnType<typeof vi.fn>>;
    extra.copyTasks = vi.fn().mockResolvedValue("- [ ] Two");
    extra.pasteTasks = vi.fn().mockResolvedValue({ path: "A.md", from: 2, to: 3 });
    extra.bulkDelete = vi.fn().mockResolvedValue([]);
    extra.duplicate = vi.fn().mockResolvedValue([]);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue("- [ ] Two") };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    (ctx.plugin as unknown as { newTaskDraft: () => object }).newTaskDraft = () => ({ destination: "Inbox.md" });
    await ctx.view.onOpen();
    await ctx.view.setState({ mode: "all" });
    rows(ctx.content())[1].click();
    return { ...ctx, extra, clipboard, row: rows(ctx.content())[1], two: ctx.index.allTasks()[1] };
  }

  it("copies the selection to the clipboard on Cmd+C", async () => {
    const { row, extra, clipboard, two } = await selected();
    key(row, "c", { metaKey: true });
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("- [ ] Two"));
    expect(extra.copyTasks).toHaveBeenCalledWith([two]);
  });

  it("pastes after the last selected task on Cmd+V, or where a new task goes with none selected", async () => {
    const { view, row, extra, two } = await selected();
    key(row, "v", { metaKey: true });
    await vi.waitFor(() => expect(extra.pasteTasks).toHaveBeenCalledWith("- [ ] Two", { after: two }));
    view.clearSelection();
    key(row, "v", { metaKey: true });
    await vi.waitFor(() => expect(extra.pasteTasks).toHaveBeenLastCalledWith("- [ ] Two", { destination: "Inbox.md" }));
  });

  it("deletes the selection on Delete or Backspace, and duplicates it on Cmd+D", async () => {
    const { view, row, extra, two } = await selected();
    key(row, "d", { metaKey: true });
    expect(extra.duplicate).toHaveBeenCalledWith([two]);
    key(row, "Backspace");
    await vi.waitFor(() => expect(extra.bulkDelete).toHaveBeenCalledWith([two]));
    expect(view.getSelectedTasks()).toEqual([]);
    extra.bulkDelete.mockClear();
    key(row, "Delete");
    expect(extra.bulkDelete).not.toHaveBeenCalled();
  });

  it("leaves the keys to a field being typed in", async () => {
    const { content, extra } = await selected();
    const field = content().appendChild(document.createElement("textarea"));
    key(field, "Backspace");
    key(field, "c", { metaKey: true });
    expect(extra.bulkDelete).not.toHaveBeenCalled();
    expect(extra.copyTasks).not.toHaveBeenCalled();
  });
});
