// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

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
    registerEvent(): void {}
    register(): void {}
  }
  return { ...original, ItemView, Menu: class {}, Notice: class {}, setIcon: vi.fn() };
});

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { TaskMainView } from "../src/task-view";
import { TaskSidebarView } from "../src/task-sidebar";
import { DEFAULT_SETTINGS, type Task, type TaskDraft } from "../src/types";
import { todayIso } from "../src/date";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => {
  installObsidianDom();
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => { document.body.innerHTML = ""; });

/** A task view and the sidebar beside it, over real notes; writes rewrite the notes, as the store would. */
async function setup(notes: Array<[string, string]>) {
  const files = new Map(notes.map(([path]) => [path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") })]));
  const contents = new Map(notes);
  let active: unknown;
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path) ?? "",
      on: () => ({}), offref: () => {}
    },
    metadataCache: { getFileCache: () => ({}), on: () => ({}), offref: () => {}, getFirstLinkpathDest: () => null },
    workspace: {
      getActiveViewOfType: (type: new (...args: never[]) => unknown) => active instanceof type ? active : null,
      getMostRecentLeaf: () => ({ view: active }), on: () => ({}), getLeaf: () => ({ openFile: vi.fn() }), requestSaveLayout: vi.fn()
    }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  /** Rewrites a task's line from a draft's title and tags (enough to change its text, and so its snapshot). */
  const rewrite = (task: Task, draft: TaskDraft): void => {
    const lines = contents.get(task.path)!.split("\n");
    lines[task.line] = `${lines[task.line].match(/^\s*- \[.\] /)![0]}${draft.title}${(draft.tags ?? []).map(tag => ` #[[${tag}]]`).join("")}`;
    contents.set(task.path, lines.join("\n"));
  };
  const store = {
    toggle: vi.fn(async (task: Task, completed: boolean) => {
      const lines = contents.get(task.path)!.split("\n");
      lines[task.line] = lines[task.line].replace(/\[.\]/, completed ? "[x]" : "[ ]");
      contents.set(task.path, lines.join("\n"));
    }),
    update: vi.fn(async (task: Task, draft: TaskDraft) => rewrite(task, draft)),
    bulkUpdate: vi.fn(async (tasks: Task[], patch: { priority?: number }) => {
      for (const task of tasks) {
        const lines = contents.get(task.path)!.split("\n");
        lines[task.line] = `${lines[task.line].replace(/ p\d/, "")} p${patch.priority}`;
        contents.set(task.path, lines.join("\n"));
      }
      return [...new Set(tasks.map(task => task.path))];
    }),
    setStatus: vi.fn().mockResolvedValue([]), addSubtask: vi.fn().mockResolvedValue(undefined), bulkDrop: vi.fn().mockResolvedValue([])
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, index, store, dateFormat: () => "YYYY-MM-DD",
    openEditor: vi.fn(), openTag: vi.fn().mockResolvedValue(undefined), openQuickSwitcher: vi.fn(), undoTaskChange: vi.fn(), redoTaskChange: vi.fn(),
    refreshTaskSidebar: () => sidebar.render()
  };
  const view = new TaskMainView({ app } as unknown as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  const sidebar = new TaskSidebarView({ app } as unknown as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  active = view;
  await view.onOpen();
  await sidebar.onOpen();
  const content = (target: { containerEl: HTMLElement }) => target.containerEl.children[1] as HTMLElement;
  return { view, sidebar, plugin, store, contents, files, main: () => content(view), side: () => content(sidebar), setActive: (next: unknown) => { active = next; } };
}

const rows = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".tm-task-item[data-task-id]"));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("what the task sidebar shows", () => {
  it("follows the task view in front: today's calendar for Today, the tasks with no date for Upcoming, else the selected task", async () => {
    const today = todayIso();
    const { view, sidebar, side, setActive, contents } = await setup([["A.md", [`- [ ] Due today ${today}`, "- [ ] No date", `- [ ] Only a deadline {${today}}`, "- [ ] Another undated"].join("\n")]]);
    await view.setState({ mode: "today" });
    expect(side().classList.contains("is-today")).toBe(true);
    expect(side().querySelector(".tm-calendar.is-day-scope")).not.toBeNull();
    expect(Array.from(side().querySelectorAll(".tm-calendar-allday .tm-calendar-task-title")).map(title => title.textContent)).toEqual(["Due today", "Only a deadline"]);
    // Only the tasks: no heading, no calendar controls, and no tray for tasks without a date.
    expect(side().querySelector("h4, .tm-calendar-toolbar, .tm-calendar-unscheduled")).toBeNull();

    await view.setState({ mode: "upcoming" });
    expect(side().classList.contains("is-upcoming")).toBe(true);
    expect(Array.from(side().querySelectorAll(".tm-calendar-unscheduled .tm-calendar-task-title")).map(title => title.textContent)).toEqual(["No date", "Another undated"]);
    expect(side().querySelector("h4, .tm-calendar-toolbar, .tm-calendar-grid, .tm-calendar-day-scroll")).toBeNull();
    contents.set("A.md", `- [ ] Due today ${today}`);
    await (view as unknown as { plugin: { index: { refreshPath(path: string): Promise<void> } } }).plugin.index.refreshPath("A.md");
    sidebar.render();
    expect(side().querySelector(".tm-sidebar-empty h3")!.textContent).toBe("Every task has a date");

    await view.setState({ mode: "all" });
    expect(side().classList.contains("is-details")).toBe(true);
    expect(side().querySelector(".tm-sidebar-empty h3")!.textContent).toBe("No task selected");
    // With a note (not a task view) in front, there is nothing to show either.
    setActive(undefined);
    sidebar.render();
    expect(side().querySelector(".tm-sidebar-empty p")!.textContent).toBe("Select a task in a task view to see its details here.");
  });

  it("shows the selected task as a list of its properties in either style, and a count for several", async () => {
    const { view, sidebar, plugin, main, side } = await setup([["A.md", "- [ ] Parent 2026-10-08 p2 every week #[[work]]\n  - [ ] Child\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    const property = (name: string) => Array.from(side().querySelectorAll<HTMLElement>(".tm-sidebar-property"))
      .find(row => row.querySelector(".tm-sidebar-property-name")!.textContent === name)!.querySelector(".tm-sidebar-property-value")!;
    for (const style of ["things", "griply"] as const) {
      plugin.settings.style = style;
      sidebar.render(true);
      expect(side().classList.contains(`tm-style-${style}`)).toBe(true);
      expect(side().querySelector(".tm-things-card")).toBeNull();
      expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!.value).toBe("Parent");
      expect(property("Priority").textContent).toBe("P2 · Medium");
      expect(property("Tags").textContent).toBe("work");
      expect(property("Repeat").textContent).toBe("Every week");
      expect(property("Deadline").classList.contains("is-empty")).toBe(true);
      expect(Array.from(side().querySelectorAll<HTMLInputElement>(".tm-sidebar-subtask-title")).map(input => input.value)).toEqual(["Child", ""]);
      // A recurring task's checkbox is its repeat icon in the Things style, as in its row.
      expect(Boolean(side().querySelector(".tm-sidebar-head .tm-repeat-icon"))).toBe(style === "things");
    }

    rows(main()).find(row => row.textContent!.includes("Other"))!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(side().querySelector(".tm-sidebar-empty h3")!.textContent).toBe("2 tasks selected");
  });
});

describe("editing in the task sidebar", () => {
  it("saves a typed title once focus leaves it, and the task stays selected", async () => {
    const { view, main, side, store, contents } = await setup([["A.md", "- [ ] Draft the brief\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    const title = side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!;
    title.focus();
    title.value = "Draft the launch brief";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    // Moving on to the notes keeps typing.
    side().querySelector<HTMLTextAreaElement>(".tm-sidebar-notes")!.focus();
    expect(store.update).not.toHaveBeenCalled();
    side().querySelector<HTMLElement>(".tm-sidebar-open-note")!.focus();
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [ ] Draft the launch brief\n- [ ] Other"));
    await settle();
    expect(view.getSelectedTasks().map(task => task.title)).toEqual(["Draft the launch brief"]);
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!.value).toBe("Draft the launch brief");
  });

  it("keeps the task selected through writes in quick succession, before its row is redrawn", async () => {
    const { view, main, side, contents } = await setup([["A.md", "- [ ] Book flights\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    // Completed tasks stay listed, so the task can stay selected once checked off.
    (view as unknown as { showCompleted: boolean }).showCompleted = true;
    view.render();
    rows(main())[0].click();
    const title = side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!;
    title.value = "Book the flights";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    // Checking it off saves the title first, then writes again at once.
    const box = side().querySelector<HTMLInputElement>(".tm-sidebar-head .tm-task-checkbox")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [x] Book the flights\n- [ ] Other"));
    await settle();
    expect(view.sidebarSelection().map(task => task.raw)).toEqual(["- [x] Book the flights"]);
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!.value).toBe("Book the flights");
  });

  it("saves typing before the shown task changes", async () => {
    const { view, main, side, contents } = await setup([["A.md", "- [ ] First\n- [ ] Second"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    const title = side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!;
    title.value = "First, renamed";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    rows(main())[1].click();
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [ ] First, renamed\n- [ ] Second"));
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!.value).toBe("Second");
  });

  it("edits a property in its popover through the task view, which keeps the task selected", async () => {
    const { view, sidebar, main, side, store } = await setup([["A.md", "- [ ] Plan the offsite\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    const priority = Array.from(side().querySelectorAll<HTMLElement>(".tm-sidebar-property")).find(row => row.textContent!.includes("Priority"))!;
    priority.click();
    // The popover opens once any typing is saved.
    await settle();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='1']")!.click();
    await vi.waitFor(() => expect(store.bulkUpdate).toHaveBeenCalledOnce());
    await settle();
    expect(view.getSelectedTasks().map(task => task.priority)).toEqual([1]);
    sidebar.render();
    expect(side().querySelector(".tm-sidebar-property.is-p1")).not.toBeNull();
  });

  it("completes the shown task from its own checkbox", async () => {
    const { view, main, side, store } = await setup([["A.md", "- [ ] Call the venue\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    const box = side().querySelector<HTMLInputElement>(".tm-sidebar-head .tm-task-checkbox")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(store.toggle).toHaveBeenCalledOnce());
    expect(store.toggle.mock.calls[0]).toEqual([expect.objectContaining({ title: "Call the venue" }), true]);
  });

  it("keeps the selection when clicking inside the sidebar", async () => {
    const { view, main, side } = await setup([["A.md", "- [ ] Keep me\n- [ ] Other"]]);
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    side().querySelector<HTMLElement>(".tm-sidebar-notes")!.click();
    side().click();
    expect(view.getSelectedTasks().map(task => task.title)).toEqual(["Keep me"]);
    document.body.click();
    expect(view.getSelectedTasks()).toEqual([]);
  });
});
