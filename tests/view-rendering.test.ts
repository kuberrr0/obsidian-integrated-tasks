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
    metadataCache: { getFileCache: (file: TFile) => frontmatter[file.path] ? { frontmatter: frontmatter[file.path] } : {}, on: () => ({}), offref: () => {}, getFirstLinkpathDest: () => null },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }) }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const store = { toggle: vi.fn().mockResolvedValue(undefined), bulkDrop: vi.fn().mockResolvedValue([]), bulkChange: vi.fn().mockResolvedValue([]), setStatus: vi.fn().mockResolvedValue([]) };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, index, store, dateFormat: () => "YYYY-MM-DD",
    openEditor: vi.fn(), openBulkEditor: vi.fn(), openTaskView: vi.fn(), openProjectEditor: vi.fn(), undoTaskChange: vi.fn(), openQuickSwitcher: vi.fn(), saveSettings: vi.fn()
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
    expect(plugin.openBulkEditor).not.toHaveBeenCalled();
  });

  it("reorders, nests and outdents with Alt+arrows", async () => {
    const { view, content, store, index, plugin } = await setup([["A.md", "- [ ] One\n- [ ] Two\n  - [ ] Child\n- [ ] Three"]]);
    plugin.settings.showSubtasks = true;
    await view.setState({ mode: "all" });
    const byTitle = (title: string) => rows(content()).find(row => row.textContent!.includes(title))!;
    const task = (title: string) => index.allTasks().find(item => item.title === title)!;
    key(byTitle("Three"), "ArrowUp", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Three")], { destination: "A.md" }, task("Two"), "before");
    key(byTitle("Two"), "ArrowRight", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Two")], { destination: "A.md" }, task("One"), "child");
    key(byTitle("Child"), "ArrowLeft", { altKey: true });
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([task("Child")], { destination: "A.md" }, task("Two"), "after");
  });

  it("offers groups and dates in a Move to menu on M", async () => {
    const { view, content, store, index } = await setup([note("A.md", 2), note("B.md", 2)]);
    await view.setState({ mode: "all" });
    key(rows(content())[0], "m");
    const titles = menus[0].items.map(item => item.title);
    expect(titles).toEqual(["Move to A", "Move to B", "Schedule for today", "Schedule for tomorrow", "Schedule for next week", "Remove dates",
      "Snooze until tomorrow", "Snooze until next week", "Snooze to someday", "Mark as in progress", "Mark as waiting", "Mark as done", "Mark as cancelled"]);
    menus[0].items[1].click();
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([index.allTasks()[0]], { destination: "B.md" }, undefined, undefined);
  });

  it("changes status from the M menu, leaving out the current one, for the whole selection", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [/] Draft\n- [ ] Review\n- [ ] Send"]]);
    await view.setState({ mode: "all" });
    key(rows(content())[0], "m");
    const statusItems = menus[0].items.filter(item => item.title.startsWith("Mark as"));
    expect(statusItems.map(item => item.title)).toEqual(["Mark as to do", "Mark as waiting", "Mark as done", "Mark as cancelled"]);
    statusItems[1].click();
    expect(store.setStatus).toHaveBeenLastCalledWith([index.allTasks()[0]], "waiting");
    rows(content())[1].click();
    key(rows(content())[1], "ArrowDown", { shiftKey: true });
    key(rows(content())[2], "m");
    menus[1].items.find(item => item.title === "Mark as cancelled")!.click();
    expect(store.setStatus).toHaveBeenLastCalledWith(index.allTasks().slice(1), "cancelled");
  });

  it("cycles to do, in progress and waiting with S, and reopens closed tasks", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] One\n- [/] Two\n- [?] Three\n- [x] Four\n- [-] Five"]]);
    view["showCompleted"] = true;
    await view.setState({ mode: "all" });
    expect(rows(content())[0].getAttribute("aria-keyshortcuts")).toMatch(/ M S$/);
    const next = rows(content()).map((row, position) => { key(row, position % 2 ? "S" : "s"); return store.setStatus.mock.lastCall; });
    expect(next).toEqual(index.allTasks().map((task, position) => [[task], ["doing", "waiting", "todo", "todo", "todo"][position]]));
    key(rows(content())[0], "s", { altKey: true });
    key(rows(content())[0], "S", { shiftKey: true });
    expect(store.setStatus).toHaveBeenCalledTimes(5);
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

  it("snoozes from the Move to menu", async () => {
    const { view, content, store, index } = await setup([note("A.md", 1)]);
    await view.setState({ mode: "all" });
    key(rows(content())[0], "m");
    menus[0].items.find(item => item.title === "Snooze to someday")!.click();
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([index.allTasks()[0]], { property: "defer", value: "Someday" }, undefined, undefined);
  });

  it("offers Stop snoozing only for a snoozed task, which stays visible in All Tasks", async () => {
    const { view, content } = await setup([["A.md", "- [ ] Later >someday\n- [ ] Now"]]);
    await view.setState({ mode: "all" });
    const later = rows(content()).find(row => row.textContent!.includes("Later"))!;
    expect(later.querySelector(".tm-task-defer")).toBeNull();
    key(later, "m");
    key(rows(content()).find(row => row.textContent!.includes("Now"))!, "m");
    expect(menus[0].items.map(item => item.title)).toContain("Stop snoozing");
    expect(menus[1].items.map(item => item.title)).not.toContain("Stop snoozing");
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
  expect(card.querySelector(".tm-task-primary .tm-things-checklist")).not.toBeNull();
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
