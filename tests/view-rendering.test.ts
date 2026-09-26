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

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.innerHTML = ""; menus.length = 0; vi.unstubAllGlobals(); });

function note(path: string, count: number, line: (i: number) => string = i => `- [ ] ${path} task ${i}`): [string, string] {
  return [path, Array.from({ length: count }, (_, i) => line(i)).join("\n")];
}

async function setup(notes: Array<[string, string]>) {
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
    metadataCache: { getFileCache: () => ({}), on: () => ({}), offref: () => {}, getFirstLinkpathDest: () => null },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }) }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const store = { toggle: vi.fn().mockResolvedValue(undefined), bulkDrop: vi.fn().mockResolvedValue([]), bulkChange: vi.fn().mockResolvedValue([]) };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, index, store, dateFormat: () => "YYYY-MM-DD",
    openEditor: vi.fn(), openBulkEditor: vi.fn(), openTaskView: vi.fn(), openProjectEditor: vi.fn(), undoTaskChange: vi.fn()
  };
  const view = new TaskMainView({ app } as unknown as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  const internals = view as unknown as { refresh(): void; content: HTMLElement };
  const edit = async (path: string, content: string) => { contents.set(path, content); emitModify(files.get(path)!); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { view, internals, index, store, plugin, edit, content: () => internals.content };
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

  it("keeps the filter panel, including a half-built filter, when tasks change", async () => {
    const { view, internals, content } = await setup([note("A.md", 3)]);
    await view.setState({ mode: "all" });
    const panel = content().querySelector(".tm-filters");
    const condition = content().querySelector<HTMLSelectElement>(".tm-property-conditions select")!;
    condition.value = condition.options[1].value;
    internals.refresh();
    expect(content().querySelector(".tm-filters")).toBe(panel);
    expect(content().querySelector<HTMLSelectElement>(".tm-property-conditions select")!.value).toBe(condition.options[1].value);
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

  it("moves between rows with arrows and extends the selection with Shift", async () => {
    const { view, content } = await setup([note("A.md", 4)]);
    await view.setState({ mode: "all" });
    rows(content())[0].focus();
    key(rows(content())[0], "ArrowDown");
    expect(document.activeElement).toBe(rows(content())[1]);
    key(rows(content())[1], "ArrowDown", { shiftKey: true });
    expect(view.getSelectedTasks().map(task => task.line)).toEqual([1, 2]);
    expect(rows(content())[2].querySelector(".tm-selected-marker")!.textContent).toBe("Selected");
    key(rows(content())[2], "End");
    expect(document.activeElement).toBe(rows(content())[3]);
  });

  it("reorders, nests and outdents with Alt+arrows", async () => {
    const { view, content, store, index } = await setup([["A.md", "- [ ] One\n- [ ] Two\n  - [ ] Child\n- [ ] Three"]]);
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
      "Snooze until tomorrow", "Snooze until next week", "Snooze to someday"]);
    menus[0].items[1].click();
    await Promise.resolve();
    expect(store.bulkDrop).toHaveBeenLastCalledWith([index.allTasks()[0]], { destination: "B.md" }, undefined, undefined);
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
    expect(later.querySelector(".tm-task-defer")!.textContent).toContain("Someday");
    key(later, "m");
    key(rows(content()).find(row => row.textContent!.includes("Now"))!, "m");
    expect(menus[0].items.map(item => item.title)).toContain("Stop snoozing");
    expect(menus[1].items.map(item => item.title)).not.toContain("Stop snoozing");
  });
});

it("shows the tag list's empty message outside the list", async () => {
  const { view, content } = await setup([note("A.md", 1)]);
  await view.setState({ mode: "tags" });
  const empty = content().querySelector<HTMLElement>(".tm-empty")!;
  expect(empty.hidden).toBe(false);
  expect(empty.closest("[role=list]")).toBeNull();
});
