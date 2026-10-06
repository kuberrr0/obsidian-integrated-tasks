// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  const original = await importOriginal<typeof import("./obsidian-mock")>();
  return { ...original, Menu: class {}, Notice: class {}, setIcon: vi.fn() };
});

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { TaskMainView } from "../src/task-view";
import { parseTaskQuery } from "../src/task-query";
import { type ViewPeriod, DEFAULT_SETTINGS, type SavedViewOptions, type SmartList, type ViewLayout } from "../src/types";
import { todayIso } from "../src/date";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.innerHTML = ""; });

async function setup(notes: Array<[string, string]>, frontmatter: Record<string, Record<string, unknown>> = {}) {
  const files = new Map(notes.map(([path]) => [path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") })]));
  const contents = new Map(notes);
  const app = {
    vault: { getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: (path: string) => files.get(path) ?? null, cachedRead: async (file: TFile) => contents.get(file.path) ?? "", on: () => ({}), offref: () => {} },
    metadataCache: { getFileCache: (file: TFile) => frontmatter[file.path] ? { frontmatter: frontmatter[file.path] } : {}, on: () => ({}), offref: () => {}, getFirstLinkpathDest: () => null },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }), requestSaveLayout: vi.fn() }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const settings = { ...DEFAULT_SETTINGS, viewOptions: {} as Record<string, SavedViewOptions>, viewLayouts: {} as Record<string, ViewLayout>, viewPeriods: {} as Record<string, ViewPeriod>, smartLists: [] as SmartList[] };
  const plugin = {
    settings, index, store: {}, dateFormat: () => "YYYY-MM-DD", openEditor: vi.fn(), openTaskView: vi.fn().mockResolvedValue(undefined),
    projectDraft: vi.fn(() => ({ tags: "" })),
    saveViewOptions: vi.fn((key: string, options?: SavedViewOptions) => { if (options) settings.viewOptions[key] = options; else delete settings.viewOptions[key]; }),
    saveViewLayout: vi.fn((key: string, layout?: ViewLayout) => { if (layout && layout !== "list") settings.viewLayouts[key] = layout; else delete settings.viewLayouts[key]; }),
    saveViewPeriod: vi.fn((key: string, period?: ViewPeriod) => { if (period && Object.keys(period).length) settings.viewPeriods[key] = period; else delete settings.viewPeriods[key]; }),
    saveSmartList: vi.fn(async (draft: Omit<SmartList, "id">) => { const list = { ...draft, id: "new" }; settings.smartLists.push(list); return list; })
  };
  const view = new TaskMainView({ app } as unknown as WorkspaceLeaf, plugin as unknown as TaskManagerPlugin);
  const content = () => view.containerEl.children[1] as HTMLElement;
  return { view, plugin, settings, content };
}

const titles = (container: HTMLElement) => Array.from(container.querySelectorAll(".tm-task-item .tm-task-title")).map(title => title.textContent);
/** Picks P1 in View options › Priority. */
function filterP1(content: HTMLElement): void {
  content.querySelector<HTMLButtonElement>(".tm-filter-toggle")!.click();
  content.querySelector<HTMLButtonElement>("[data-tm-focus-key='option-priority']")!.click();
  content.querySelector<HTMLElement>(".tm-options-dropdown [data-value='1']")!.click();
}

describe("View options kept for each view", () => {
  it("keeps each view's options between visits, by list, project and tag, and forgets them once cleared", async () => {
    const today = todayIso();
    const { view, plugin, settings, content } = await setup([["A.md", `- [ ] Urgent ${today} p1\n- [ ] Later ${today}`], ["Site.md", "- [ ] Page p2\n- [ ] Copy"]], { "Site.md": { tags: ["project"] } });
    await view.setState({ mode: "today" });
    filterP1(content());
    expect(titles(content())).toEqual(["Urgent"]);
    expect(plugin.saveViewOptions).toHaveBeenLastCalledWith("today", expect.objectContaining({ filters: [{ property: "priority", operator: "is", values: ["1"] }] }));

    // Another view starts from its own options (none kept: the defaults).
    await view.setState({ mode: "all" });
    expect(titles(content())).toEqual(["Urgent", "Later", "Page", "Copy"]);
    await view.setState({ mode: "all", pagePath: "Site.md" });
    content().querySelector<HTMLButtonElement>(".tm-filter-toggle")!.click();
    content().querySelector<HTMLButtonElement>("[data-tm-focus-key='option-sort']")!.click();
    content().querySelector<HTMLElement>(".tm-options-dropdown [data-value='title']")!.click();
    expect(Object.keys(settings.viewOptions).sort()).toEqual(["project:Site.md", "today"]);

    // Back on Today, its filter is there again.
    await view.setState({ mode: "today" });
    expect(titles(content())).toEqual(["Urgent"]);
    expect(content().querySelector(".tm-options-badge")!.textContent).toBe("1");
    content().querySelector<HTMLButtonElement>(".tm-filter-toggle")!.click();
    content().querySelector<HTMLButtonElement>(".tm-options-clear")!.click();
    expect(settings.viewOptions.today).toBeUndefined();
    await view.setState({ mode: "all", pagePath: "Site.md" });
    expect(titles(content())).toEqual(["Copy", "Page"]);
  });

  it("opens a new tab of a view with its kept options", async () => {
    const today = todayIso();
    const first = await setup([["A.md", `- [ ] Urgent ${today} p1\n- [ ] Later ${today}`]]);
    first.settings.viewOptions.today = { filters: [{ property: "priority", operator: "is", values: ["1"] }], sort: "date", descending: false, grouping: "default", showProjects: false };
    await first.view.setState({ mode: "today" });
    expect(titles(first.content())).toEqual(["Urgent"]);
    expect(first.view.getState().showProjects).toBe(false);
  });
});

describe("Layouts kept for each view", () => {
  it("opens each view in the layout it was left in, a list until then, and keeps the Projects list's and a smart list's too", async () => {
    const today = todayIso();
    const { view, plugin, settings, content } = await setup([["A.md", `- [ ] Call ${today}`], ["Site.md", "- [ ] Page"]], { "Site.md": { tags: ["project"] } });
    settings.smartLists.push({ id: "p1", name: "P1", filters: [], sort: "date", descending: false, grouping: "default" });
    const layoutButton = (name: string) => content().querySelector<HTMLButtonElement>(`[data-tm-focus-key="${name}"]`)!;
    await view.setState({ mode: "today" });
    layoutButton("layout-calendar").click();
    expect(plugin.saveViewLayout).toHaveBeenLastCalledWith("today", "calendar");
    await view.setState({ mode: "upcoming" });
    expect(view.getState().layout).toBe("list");
    layoutButton("layout-kanban").click();
    await view.setState({ mode: "projects" });
    layoutButton("project-layout-gantt").click();
    await view.setState({ mode: "smartLists", smartListId: "p1" });
    layoutButton("layout-calendar").click();
    expect(settings.viewLayouts).toEqual({ today: "calendar", upcoming: "kanban", projects: "gantt", "smartList:p1": "calendar" });

    await view.setState({ mode: "today" });
    expect(view.getState().layout).toBe("calendar");
    await view.setState({ mode: "projects" });
    expect(view.getState().projectLayout).toBe("gantt");
    // A layout the state names (a restored tab, or Back) holds; switching to it by command keeps it for the view.
    await view.setState({ mode: "upcoming", layout: "list" });
    expect(view.getState().layout).toBe("list");
    await view.setState({ ...view.getState(), layout: "calendar" });
    expect(settings.viewLayouts.upcoming).toBe("calendar");
    // Back to a list, nothing is kept.
    layoutButton("layout-list").click();
    expect(settings.viewLayouts.upcoming).toBeUndefined();
  });
});

describe("Calendar scope and Gantt range kept for each view", () => {
  it("opens each view's calendar at the scope it was left at, and the Projects Gantt at its range", async () => {
    const today = todayIso();
    const { view, settings, content } = await setup([["A.md", `- [ ] Call ${today}`], ["Site.md", "- [ ] Page"]], { "Site.md": { tags: ["project"], start: today, end: today } });
    const scope = (label: string) => content().querySelector<HTMLButtonElement>(`.tm-calendar-scopes button[aria-label="${label}"]`)!;
    await view.setState({ mode: "today", layout: "calendar" });
    scope("Week").click();
    expect(settings.viewPeriods.today).toEqual({ calendarScope: "week" });
    // Another view keeps its own (a month until changed); back again, the week holds.
    await view.setState({ mode: "upcoming", layout: "calendar" });
    expect(view.getState().calendarScope).toBe("month");
    await view.setState({ mode: "today", layout: "calendar" });
    expect(view.getState().calendarScope).toBe("week");
    // Back to a month, nothing is kept.
    scope("Month").click();
    expect(settings.viewPeriods.today).toBeUndefined();

    await view.setState({ mode: "projects" });
    content().querySelector<HTMLButtonElement>('[data-tm-focus-key="project-layout-gantt"]')!.click();
    content().querySelector<HTMLButtonElement>('.tm-gantt-zoom button[aria-label="Zoom in"]')!.click();
    const range = settings.viewPeriods.projects;
    expect(range?.ganttScale ?? range?.ganttZoom).toBeDefined();
    await view.setState({ mode: "today" });
    await view.setState({ mode: "projects" });
    expect([view.getState().ganttZoom, view.getState().ganttScale]).toEqual([range!.ganttZoom, range!.ganttScale]);
  });
});

describe("Convert to smart list", () => {
  it("makes a smart list of the view's options that filters the view's own tasks, and opens it", async () => {
    const today = todayIso();
    const { view, plugin, settings, content } = await setup([["A.md", `- [ ] Urgent today ${today} p1\n- [ ] Urgent later 2999-01-01 p1\n- [ ] Plain today ${today}`]]);
    await view.setState({ mode: "today" });
    filterP1(content());
    content().querySelector<HTMLButtonElement>(".tm-options-convert")!.click();
    // The panel closes for a popover naming the list.
    expect(content().querySelector<HTMLElement>(".tm-options-panel")!.hidden).toBe(true);
    const input = document.querySelector<HTMLInputElement>(".tm-choice-popover input")!;
    input.value = "Urgent today";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(plugin.openTaskView).toHaveBeenCalledWith({ mode: "smartLists", smartListId: "new" }));
    expect(plugin.saveSmartList).toHaveBeenCalledWith({ name: "Urgent today", filters: [{ property: "priority", operator: "is", values: ["1"] }],
      sort: "date", descending: false, grouping: "default", scope: { mode: "today" } });

    // The list shows Today's P1 tasks, grouped as Today groups them; a smart list offers no conversion of its own.
    await view.setState({ mode: "smartLists", smartListId: "new" });
    expect(titles(content())).toEqual(["Urgent today"]);
    expect(Array.from(content().querySelectorAll(".tm-section > h2")).map(heading => heading.textContent)).toContain("Today");
    expect(content().querySelector(".tm-options-convert")).toBeNull();
    // So does a task-query block that names it.
    const parsed = parseTaskQuery("smart list: Urgent today", { sourcePath: "Note.md", dateFormat: "YYYY-MM-DD", smartLists: settings.smartLists, resolveNote: () => undefined });
    expect(parsed.query).toMatchObject({ mode: "today", filters: [{ property: "priority", operator: "is", values: ["1"] }] });
  });
});
