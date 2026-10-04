// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
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

import { Platform, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { TaskMainView } from "../src/task-view";
import { TaskSidebarView } from "../src/task-sidebar";
import { TASK_DRAG_TYPE } from "../src/sidebar-drop";
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
    setStatus: vi.fn().mockResolvedValue([]), addSubtask: vi.fn().mockResolvedValue(undefined), bulkDrop: vi.fn().mockResolvedValue([]),
    bulkChange: vi.fn().mockResolvedValue([]),
    /** Writes a new task at the top of its note, as the store does with New task position › Top. */
    create: vi.fn(async (draft: TaskDraft) => {
      const path = draft.destination.split("#")[0];
      contents.set(path, `- [ ] ${draft.title}${draft.priority ? ` p${draft.priority}` : ""}\n${contents.get(path) ?? ""}`.replace(/\n$/, ""));
      return 0;
    })
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, index, store, dateFormat: () => "YYYY-MM-DD",
    openEditor: vi.fn(), openTag: vi.fn().mockResolvedValue(undefined), openQuickSwitcher: vi.fn(), undoTaskChange: vi.fn(), redoTaskChange: vi.fn(),
    refreshTaskSidebar: () => sidebar.render(),
    showInTaskSidebar: vi.fn(async (id: string, options?: { focus?: boolean }) => sidebar.showTask(id, options)),
    newTaskDraft: () => ({ title: "", completed: false, indent: 0, destination: "A.md" })
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
  it("follows the task view in front: today's hours for Today, the tasks with no date for Upcoming, else the selected task", async () => {
    const today = todayIso();
    const { view, sidebar, side, setActive, contents } = await setup([["A.md", [`- [ ] At nine ${today} 09:00`, `- [ ] Due today ${today}`, "- [ ] No date", "  - [ ] Its subtask", `- [ ] Only a deadline {${today}}`, "- [ ] Another undated"].join("\n")]]);
    await view.setState({ mode: "today" });
    expect(side().classList.contains("is-today")).toBe(true);
    expect(side().querySelector(".tm-sidebar-planner .tm-calendar.is-day-scope")).not.toBeNull();
    expect(Array.from(side().querySelectorAll(".tm-calendar-lane .tm-calendar-task-title")).map(title => title.textContent)).toEqual(["At nine"]);
    // Only the hours: no heading, no calendar controls, no all-day row, no tray for tasks without a date.
    expect(side().querySelector("h4, .tm-calendar-toolbar, .tm-calendar-allday, .tm-calendar-unscheduled")).toBeNull();
    // With no task selected, the hours have the sidebar to themselves.
    expect(side().querySelector<HTMLElement>(".tm-sidebar-pane")!.hidden).toBe(true);
    expect(side().querySelector(".tm-sidebar-pane")!.childElementCount).toBe(0);

    await view.setState({ mode: "upcoming" });
    expect(side().classList.contains("is-upcoming")).toBe(true);
    // As a list's rows, subtasks with their task.
    expect(Array.from(side().querySelectorAll(".tm-sidebar-planner .tm-task-item .tm-task-title")).map(title => title.textContent)).toEqual(["No date", "Another undated"]);
    expect(side().querySelector("h4, .tm-calendar, .tm-calendar-task")).toBeNull();
    expect(side().querySelector<HTMLElement>(".tm-sidebar-pane")!.hidden).toBe(true);
    contents.set("A.md", `- [ ] Due today ${today}`);
    await (view as unknown as { plugin: { index: { refreshPath(path: string): Promise<void> } } }).plugin.index.refreshPath("A.md");
    sidebar.render();
    expect(side().querySelector(".tm-sidebar-planner .tm-sidebar-empty h3")!.textContent).toBe("Every task has a date");

    await view.setState({ mode: "all" });
    expect(side().classList.contains("is-details")).toBe(true);
    expect(side().querySelector(".tm-sidebar-planner")).toBeNull();
    expect(side().querySelector(".tm-sidebar-empty h3")!.textContent).toBe("No task selected");
    // With a note (not a task view) in front, there is nothing to show either.
    setActive(undefined);
    sidebar.render();
    expect(side().querySelector(".tm-sidebar-empty p")!.textContent).toBe("Select a task in a task view to see its details here.");
  });

  it("lists the tasks without a date beside any view's calendar, as for Upcoming, under the plugin's icon", async () => {
    const today = todayIso();
    const { view, sidebar, main, side } = await setup([["A.md", [`- [ ] At nine ${today} 09:00`, "- [ ] No date"].join("\n")]]);
    expect(sidebar.getIcon()).toBe("circle-check-big");
    const layout = (name: string) => main().querySelector<HTMLButtonElement>(`[data-tm-focus-key="layout-${name}"]`)!.click();
    await view.setState({ mode: "all" });
    expect(side().classList.contains("is-details")).toBe(true);
    layout("calendar");
    expect(side().classList.contains("is-upcoming")).toBe(true);
    expect(Array.from(side().querySelectorAll(".tm-sidebar-planner .tm-task-item .tm-task-title")).map(title => title.textContent)).toEqual(["No date"]);
    // Today's calendar too, rather than its hours again.
    await view.setState({ mode: "today", layout: "calendar" });
    expect(side().classList.contains("is-upcoming")).toBe(true);
    layout("list");
    expect(side().classList.contains("is-today")).toBe(true);
  });

  it("lists the view's own tasks without a date beside its calendar: a project's or a smart list's, through its filters but those on dates", async () => {
    const today = todayIso();
    const { view, plugin, side } = await setup([["A.md", "- [ ] Elsewhere p2"], ["Site.md", [`- [ ] Launch ${today}`, "- [ ] Write copy p1", "- [ ] Pick fonts"].join("\n")]]);
    const listed = () => Array.from(side().querySelectorAll(".tm-sidebar-planner .tm-task-item .tm-task-title")).map(title => title.textContent);
    await view.setState({ mode: "all", layout: "calendar" });
    expect(listed()).toEqual(["Write copy", "Elsewhere", "Pick fonts"]);
    // The project's view shows its P1 tasks with a date; beside it, its P1 tasks without one.
    plugin.settings.viewOptions = { "project:Site.md": { filters: [{ property: "priority", operator: "is", values: ["1"] }, { property: "scheduledDate", operator: "has", values: [] }], sort: "date", descending: false, grouping: "default" } };
    await view.setState({ mode: "all", pagePath: "Site.md", layout: "calendar" });
    expect(listed()).toEqual(["Write copy"]);
    plugin.settings.smartLists = [{ id: "p2", name: "P2", filters: [{ property: "priority", operator: "is", values: ["2"] }], sort: "date", descending: false, grouping: "default" }];
    await view.setState({ mode: "smartLists", smartListId: "p2", layout: "calendar" });
    expect(listed()).toEqual(["Elsewhere"]);
  });

  it("takes the dates off a card dragged from the view's calendar into the tasks without a date", async () => {
    const today = todayIso();
    const { view, main, side, store } = await setup([["A.md", [`- [ ] At nine ${today} 09:00`, "- [ ] No date"].join("\n")]]);
    await view.setState({ mode: "all", layout: "calendar", calendarScope: "day", calendarAnchor: today });
    const transfer = { types: [TASK_DRAG_TYPE], dropEffect: "", effectAllowed: "", setData: () => {} };
    const drag = (target: EventTarget, type: string) => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: transfer, clientY: 0 }));
    drag(main().querySelector<HTMLElement>(".tm-calendar-lane .tm-calendar-task")!, "dragstart");
    const planner = side().querySelector<HTMLElement>(".tm-sidebar-planner")!;
    drag(planner, "dragover");
    expect(planner.querySelector(".tm-task-list > .tm-drop-gap:first-child")).not.toBeNull();
    drag(planner, "drop");
    await vi.waitFor(() => expect(store.bulkChange).toHaveBeenCalledOnce());
    const [tasks, draft] = store.bulkChange.mock.calls[0] as unknown as [Task[], (task: Task) => TaskDraft];
    expect(tasks.map(task => task.title)).toEqual(["At nine"]);
    expect(draft(tasks[0])).toMatchObject({ scheduledDate: undefined, scheduledTime: undefined });
    expect(planner.querySelector(".tm-drop-gap")).toBeNull();
  });

  it("shows the details of a task selected in the sidebar's day or list, until the view's selection changes", async () => {
    const today = todayIso();
    const { view, main, side } = await setup([["A.md", [`- [ ] At nine ${today} 09:00`, `- [ ] Later ${today}`, "- [ ] No date"].join("\n")]]);
    await view.setState({ mode: "today" });
    expect(side().querySelector<HTMLElement>(".tm-sidebar-pane")!.hidden).toBe(true);
    side().querySelector<HTMLElement>(".tm-calendar-lane .tm-calendar-task")!.click();
    // A selected task's details appear below the hours.
    expect(side().querySelector<HTMLElement>(".tm-sidebar-pane")!.hidden).toBe(false);
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-pane .tm-sidebar-title-field")!.value).toBe("At nine");
    expect(side().querySelector(".tm-calendar-task.is-selected")).not.toBeNull();
    rows(main()).find(row => row.textContent!.includes("Later"))!.click();
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-pane .tm-sidebar-title-field")!.value).toBe("Later");
    expect(side().querySelector(".tm-calendar-task.is-selected")).toBeNull();

    await view.setState({ mode: "upcoming" });
    side().querySelector<HTMLElement>(".tm-sidebar-planner .tm-task-item .tm-task-title")!.click();
    expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-pane .tm-sidebar-title-field")!.value).toBe("No date");
    expect(side().querySelector(".tm-sidebar-planner .tm-task-item.is-selected")).not.toBeNull();
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

describe("three panes (Task details › Three panes: in the sidebar)", () => {
  it("opens a task in the sidebar, with the caret in its title, rather than as a card or in the task editor", async () => {
    const { view, plugin, main, side } = await setup([["A.md", "- [ ] First\n- [ ] Second"]]);
    plugin.settings.taskDetails = "sidebar";
    const title = () => side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field");
    for (const style of ["things", "griply"] as const) {
      plugin.settings.style = style;
      await view.setState({ mode: "all" });
      rows(main())[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(title()?.value).toBe("Second"));
      expect(document.activeElement).toBe(title());
      expect(main().querySelector(".tm-things-card")).toBeNull();
      expect(view.getSelectedTasks().map(task => task.title)).toEqual(["Second"]);
      // So does Enter on a selected task.
      rows(main())[0].click();
      rows(main())[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(document.activeElement).toBe(title()));
      expect(title()!.value).toBe("First");
    }
    expect(plugin.openEditor).not.toHaveBeenCalled();
    expect(plugin.showInTaskSidebar).toHaveBeenCalledWith(expect.any(String), { focus: true });
  });

  it("on phones and tablets, shows a tapped task in the sidebar (its drawer slides in), without the keyboard", async () => {
    const platform = Platform as { isMobile?: boolean };
    platform.isMobile = true;
    onTestFinished(() => { platform.isMobile = false; });
    const { view, plugin, main, side } = await setup([["A.md", "- [ ] First\n- [ ] Second"]]);
    plugin.settings.taskDetails = "sidebar";
    await view.setState({ mode: "all" });
    rows(main())[0].click();
    await vi.waitFor(() => expect(side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")?.value).toBe("First"));
    expect(plugin.showInTaskSidebar).toHaveBeenCalledExactlyOnceWith(rows(main())[0].getAttribute("data-task-id"), { focus: false });
    expect(document.activeElement).not.toBe(side().querySelector(".tm-sidebar-title-field"));
    expect(main().querySelector(".tm-things-card")).toBeNull();
    expect(plugin.openEditor).not.toHaveBeenCalled();
  });

  it("starts a new task in the sidebar, written only by Enter once titled: Escape drops it untitled, and leaving it titled writes it", async () => {
    const { view, plugin, store, main, side, contents } = await setup([["A.md", "- [ ] Existing"]]);
    plugin.settings.taskDetails = "sidebar";
    await view.setState({ mode: "all" });
    const title = () => side().querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")!;
    const key = (name: string) => title().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    const type = (text: string) => { title().value = text; title().dispatchEvent(new Event("input", { bubbles: true })); };
    view.newTask();
    await vi.waitFor(() => expect(title()?.placeholder).toBe("New To-Do"));
    expect(title().value).toBe("");
    expect(document.activeElement).toBe(title());
    // Nothing is written (or listed) yet; its subtasks and note wait until it is.
    expect(contents.get("A.md")).toBe("- [ ] Existing");
    expect(view.getSelectedTasks()).toEqual([]);
    expect(side().querySelector(".tm-sidebar-subtasks, .tm-sidebar-open-note")).toBeNull();
    expect(main().querySelector(".tm-things-card")).toBeNull();
    // Enter without a title does nothing; Escape drops it.
    key("Enter");
    key("Escape");
    await settle();
    expect(store.create).not.toHaveBeenCalled();
    expect(side().querySelector(".tm-sidebar-empty h3")!.textContent).toBe("No task selected");

    // What is set before it is written goes with it; Enter writes it, and it stays shown, now selected.
    view.newTask();
    await vi.waitFor(() => expect(title()?.placeholder).toBe("New To-Do"));
    type("Buy milk");
    side().querySelector<HTMLElement>("[data-tm-focus-key='sidebar-priority']")!.click();
    await vi.waitFor(() => expect(document.querySelector(".tm-choice-popover [data-value='1']")).not.toBeNull());
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='1']")!.click();
    await vi.waitFor(() => expect(side().querySelector(".tm-sidebar-property.is-p1")).not.toBeNull());
    expect(contents.get("A.md")).toBe("- [ ] Existing");
    expect(title().value).toBe("Buy milk");
    key("Enter");
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [ ] Buy milk p1\n- [ ] Existing"));
    await vi.waitFor(() => expect(view.getSelectedTasks().map(task => task.title)).toEqual(["Buy milk"]));
    expect(title().value).toBe("Buy milk");
    expect(title().placeholder).toBe("Title");

    // Selecting another task writes one left titled; that task stays selected though its line moved.
    view.newTask();
    await vi.waitFor(() => expect(title()?.placeholder).toBe("New To-Do"));
    type("Call Sam");
    rows(main()).find(row => row.textContent?.includes("Existing"))!.click();
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [ ] Call Sam\n- [ ] Buy milk p1\n- [ ] Existing"));
    await vi.waitFor(() => expect(view.getSelectedTasks().map(task => task.title)).toEqual(["Existing"]));
    expect(store.create).toHaveBeenCalledTimes(2);
    expect(plugin.openEditor).not.toHaveBeenCalled();
  });
});

describe("dragging between the task sidebar and the view", () => {
  const pointer = (target: EventTarget, type: string, clientX: number, clientY: number) =>
    target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", button: 0, clientX, clientY, bubbles: true, cancelable: true }));
  const frame = () => new Promise(resolve => window.requestAnimationFrame(resolve));
  /** Whatever the pointer is over, as the browser would say. */
  function under(element: Element): void {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [element] });
    onTestFinished(() => { delete (document as unknown as Record<string, unknown>).elementFromPoint; delete (document as unknown as Record<string, unknown>).elementsFromPoint; });
  }
  /** Drags `row` by its title to wherever `under` points, showing the drop on the way. */
  async function drag(row: HTMLElement, y: number): Promise<void> {
    const title = row.querySelector<HTMLElement>(".tm-task-title")!;
    pointer(title, "pointerdown", 10, 10);
    pointer(row, "pointermove", 10, y);
    await frame();
  }

  it("schedules a task dragged from Today's list onto an hour of the sidebar's day, showing the slot it would fill", async () => {
    const today = todayIso();
    const { view, main, side, store } = await setup([["A.md", `- [ ] Plan the launch ${today} 45m\n- [ ] Call ${today}`]]);
    await view.setState({ mode: "today" });
    const lane = side().querySelector<HTMLElement>(".tm-calendar-lane")!;
    lane.getBoundingClientRect = () => ({ top: 0, bottom: 1152, left: 0, right: 300, height: 1152, width: 300 }) as DOMRect;
    under(lane);
    const row = rows(main()).find(item => item.textContent!.includes("Plan the launch"))!;
    await drag(row, 600);
    const gap = lane.querySelector<HTMLElement>(".tm-calendar-drop-gap.is-timed")!;
    // At 12:30, as long as the task.
    expect([gap.style.top, gap.style.height]).toEqual(["600px", "36px"]);
    pointer(row, "pointerup", 10, 600);
    await vi.waitFor(() => expect(store.bulkChange).toHaveBeenCalledOnce());
    const [tasks, draft] = store.bulkChange.mock.calls[0] as unknown as [Task[], (task: Task) => TaskDraft];
    expect(tasks.map(task => task.title)).toEqual(["Plan the launch"]);
    expect(draft(tasks[0])).toMatchObject({ scheduledDate: today, scheduledTime: "12:30" });
    expect(lane.querySelector(".tm-calendar-drop-gap")).toBeNull();
  });

  it("dates a task dragged from the sidebar's list onto one of Upcoming's days, keeping its place in its note", async () => {
    const { view, main, side, store } = await setup([["A.md", "- [ ] Undated idea\n- [ ] Launch 2999-01-02"]]);
    await view.setState({ mode: "upcoming" });
    const list = main().querySelector<HTMLElement>("section.tm-section .tm-task-list")!;
    under(list);
    const row = side().querySelector<HTMLElement>(".tm-sidebar-planner .tm-task-item")!;
    await drag(row, 300);
    // The day's list opens its slot, as for its own rows.
    expect(list.querySelector(".tm-drop-gap")).not.toBeNull();
    pointer(row, "pointerup", 10, 300);
    await vi.waitFor(() => expect(store.bulkDrop).toHaveBeenCalledOnce());
    expect(store.bulkDrop).toHaveBeenCalledWith([expect.objectContaining({ title: "Undated idea" })], expect.objectContaining({ property: "date", value: "2999-01-02" }), undefined, undefined);
  });

  it("takes the dates off a task dragged from Upcoming into the sidebar's tasks without a date", async () => {
    const { view, main, side, store } = await setup([["A.md", "- [ ] Undated idea\n- [ ] Launch 2999-01-02 {2999-01-05}"]]);
    await view.setState({ mode: "upcoming" });
    const planner = side().querySelector<HTMLElement>(".tm-sidebar-planner")!;
    under(planner);
    const row = rows(main()).find(item => item.textContent!.includes("Launch"))!;
    await drag(row, 300);
    expect(planner.querySelector(".tm-task-list > .tm-drop-gap:first-child")).not.toBeNull();
    pointer(row, "pointerup", 10, 300);
    await vi.waitFor(() => expect(store.bulkChange).toHaveBeenCalledOnce());
    const [tasks, draft] = store.bulkChange.mock.calls[0] as unknown as [Task[], (task: Task) => TaskDraft];
    expect(draft(tasks[0])).toMatchObject({ scheduledDate: undefined, deadline: undefined });
    expect(planner.querySelector(".tm-drop-gap")).toBeNull();
  });
});
