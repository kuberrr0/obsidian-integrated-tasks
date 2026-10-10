// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));

import { TFile, type App } from "obsidian";
import { todayIso } from "../src/date";
import { TaskIndex } from "../src/task-index";
import { TaskQueryBlock } from "../src/task-query-block";
import { DEFAULT_SETTINGS } from "../src/types";

beforeAll(() => installObsidianDom());

async function setup(notes: Record<string, string>) {
  const contents = new Map(Object.entries(notes));
  const files = new Map([...contents.keys()].map(path => [path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") })]));
  let modified: (file: TFile) => void = () => {};
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path)!, offref: () => {},
      on: (event: string, callback: (file: TFile) => void) => { if (event === "modify") modified = callback; return {}; }
    },
    metadataCache: { getFileCache: () => ({}), on: () => ({}), offref: () => {}, getFirstLinkpathDest: (name: string) => files.get(`${name}.md`) ?? null },
    workspace: { getLeaf: () => ({ openFile: vi.fn() }) }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const plugin = {
    app, index, settings: { ...DEFAULT_SETTINGS, smartLists: [] }, dateFormat: () => "YYYY-MM-DD",
    store: { toggle: vi.fn().mockResolvedValue(undefined) }, openEditor: vi.fn(), openTask: vi.fn(), startTask: vi.fn(),
    openTaskView: vi.fn().mockResolvedValue(undefined), openTag: vi.fn().mockResolvedValue(undefined)
  };
  const render = (source: string, sourcePath = "Daily.md") => {
    const element = document.body.appendChild(document.createElement("div"));
    const block = new TaskQueryBlock(element, source, sourcePath, plugin as never);
    block.load();
    return { element, block };
  };
  const edit = async (path: string, content: string) => { contents.set(path, content); modified(files.get(path)!); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { plugin, render, edit };
}

const titles = (element: HTMLElement) => Array.from(element.querySelectorAll(".tm-query-row .tm-task-title")).map(title => title.textContent);
const today = todayIso();

describe("task query blocks", () => {
  it("lists matching tasks with a title and count, and acts on them", async () => {
    const { render, plugin } = await setup({ "Work.md": `- [ ] Ship it ${today} p1\n- [ ] Later task\n- [x] Done ${today}`, "Daily.md": `- [ ] Here ${today}` });
    const { element } = render("view: today\ntitle: Focus\nsort: priority");
    expect(element.querySelector(".tm-query-title")!.textContent).toBe("Focus2");
    expect(titles(element)).toEqual(["Ship it", "Here"]);
    // The block's own note isn't repeated as a source label.
    const rows = element.querySelectorAll<HTMLElement>(".tm-query-row");
    expect(rows[0].querySelector(".tm-task-source")!.textContent).toBe("Work");
    expect(rows[1].querySelector(".tm-task-source")).toBeNull();
    const checkbox = rows[0].querySelector<HTMLInputElement>("input[type=checkbox]")!;
    checkbox.click();
    expect(plugin.store.toggle).toHaveBeenCalledWith(expect.objectContaining({ title: "Ship it" }), true);
    // Opening a task is the plugin's: the task editor, or with three panes the Task Details sidebar.
    rows[0].querySelector<HTMLButtonElement>(".tm-task-title")!.click();
    expect(plugin.openTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Ship it" }));
  });

  it("draws rows as the task views do, in the chosen style", async () => {
    const { render, plugin } = await setup({ "Work.md": `- [ ] Ship it ${today} p1 #[[client]]\n- [ ] Plan it p2` });
    plugin.settings.style = "things";
    const things = render("view: all").element;
    // Shared styles hang off the task views' class; rows are their rows, with the priority on the checkbox.
    expect(things.classList.contains("tm-main-view")).toBe(true);
    expect(things.classList.contains("tm-style-things")).toBe(true);
    const row = things.querySelector<HTMLElement>(".tm-query-row")!;
    expect(row.classList.contains("tm-task-item")).toBe(true);
    expect(row.querySelector(".tm-task-checkbox")!.classList.contains("is-p1")).toBe(true);
    expect(row.querySelector(".tm-things-secondary .tm-things-source")!.textContent).toBe("Work");
    expect(row.querySelector(".tm-things-tag")!.textContent).toContain("client");
    plugin.settings.style = "griply";
    const griply = render("view: all").element;
    expect(griply.classList.contains("tm-style-griply")).toBe(true);
    expect(griply.querySelector(".tm-query-row .tm-task-metadata .tm-task-source")!.textContent).toBe("Work");
  });

  it("lays tasks out as a board, by status unless grouped otherwise", async () => {
    const { render } = await setup({ "Work.md": "- [ ] One\n- [/] Two\n- [x] Three\n- [ ] Four p1" });
    const columns = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>(".tm-kanban-column")).map(column =>
      [column.querySelector("h2")!.textContent, Array.from(column.querySelectorAll(".tm-task-title")).map(title => title.textContent)]);
    const board = render("layout: board").element;
    expect(board.classList.contains("is-kanban-view")).toBe(true);
    // Done and Cancelled stay out unless completed tasks show.
    expect(columns(board)).toEqual([["To do", ["Four", "One"]], ["In progress", ["Two"]], ["Waiting", []]]);
    expect(columns(render("layout: kanban\nshow completed: yes").element).map(([title]) => title)).toEqual(["To do", "In progress", "Waiting", "Done", "Cancelled"]);
    expect(columns(render("layout: board\ngroup: priority").element)).toEqual([["P1", ["Four"]], ["P2", []], ["P3", []], ["No priority", ["One", "Two"]]]);
  });

  it("lays dated tasks out on a calendar, whose toolbar moves it", async () => {
    const { render, plugin } = await setup({ "Work.md": `- [ ] Dated ${today}\n- [ ] Undated` });
    const { element } = render("layout: calendar month\ntitle: Month");
    expect(element.classList.contains("is-calendar-view")).toBe(true);
    expect(element.querySelector(".tm-calendar")!.classList.contains("is-month-scope")).toBe(true);
    expect(element.querySelector(".tm-query-title")!.textContent).toBe("Month1");
    expect(Array.from(element.querySelectorAll(".tm-calendar-task")).map(card => card.textContent)).toEqual([expect.stringContaining("Dated")]);
    element.querySelector<HTMLButtonElement>(".tm-calendar-scopes button[aria-label=Week]")!.click();
    expect(element.querySelector(".tm-calendar")!.classList.contains("is-week-scope")).toBe(true);
    element.querySelector<HTMLElement>(".tm-calendar-task")!.click();
    expect(plugin.openTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Dated" }));
  });

  it("opens a calendar on the date the block names, until its toolbar moves it", async () => {
    const { render } = await setup({ "Work.md": `- [ ] Dated ${today}\n- [ ] Later 2031-03-12` });
    const { element } = render("layout: calendar month 2031-03-10");
    const cards = () => Array.from(element.querySelectorAll(".tm-calendar-task")).map(card => card.textContent);
    expect(element.querySelector(".tm-calendar-toolbar h2")!.textContent).toContain("2031");
    expect(cards()).toEqual([expect.stringContaining("Later")]);
    Array.from(element.querySelectorAll<HTMLButtonElement>(".tm-calendar-controls button")).find(button => button.textContent === "Today")!.click();
    expect(cards()).toEqual([expect.stringContaining("Dated")]);
  });

  it("updates when tasks change and stops after the block unloads", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    const { render, edit } = await setup({ "Work.md": "- [ ] One p1" });
    const { element, block } = render("priority: 1");
    expect(titles(element)).toEqual(["One"]);
    await edit("Work.md", "- [ ] One p1\n- [ ] Two p1");
    frames.shift()!(0);
    expect(titles(element)).toEqual(["One", "Two"]);
    block.unload();
    await edit("Work.md", "- [ ] Three p1");
    expect(frames).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("groups, limits, and offers Show all for a view", async () => {
    const { render, plugin } = await setup({ "A.md": "- [ ] A1\n- [ ] A2\n- [ ] A3", "B.md": "- [ ] B1" });
    const { element } = render("view: all\ngroup: source\nlimit: 3");
    expect(Array.from(element.querySelectorAll(".tm-query-group")).map(group => group.textContent)).toEqual(["A"]);
    expect(titles(element)).toEqual(["A1", "A2", "A3"]);
    expect(element.querySelector(".tm-query-footer")!.textContent).toContain("Showing 3 of 4 tasks.");
    element.querySelector<HTMLButtonElement>(".tm-query-footer button")!.click();
    expect(plugin.openTaskView).toHaveBeenCalledWith({ mode: "all" });
  });

  it("shows this note's tasks, an empty message, and readable errors", async () => {
    const { render } = await setup({ "Daily.md": "- [ ] Mine", "Other.md": "- [ ] Theirs" });
    expect(titles(render("note: this").element)).toEqual(["Mine"]);
    expect(render("priority: 3").element.querySelector(".tm-query-empty")!.textContent).toBe("No matching tasks.");
    const error = render("view: nope").element.querySelector("[role=alert]")!;
    expect(error.textContent).toContain('Line 1: "nope" isn\'t a view.');
    expect(render("layout:").element.querySelector("[role=alert]")!.textContent).toContain('Write a layout after "layout:"');
  });

  it("shows a problem it runs into while drawing, and still redraws when tasks change", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    const { render, edit, plugin } = await setup({ "Work.md": "- [ ] One p1" });
    const query = plugin.index.query.bind(plugin.index);
    const failing = vi.spyOn(plugin.index, "query").mockImplementation(() => { throw new Error("Index unavailable"); });
    const { element } = render("priority: 1");
    expect(element.querySelector("[role=alert]")!.textContent).toContain("Index unavailable");
    failing.mockImplementation(query);
    await edit("Work.md", "- [ ] One p1\n- [ ] Two p1");
    frames.shift()!(0);
    expect(titles(element)).toEqual(["One", "Two"]);
    vi.restoreAllMocks();
  });
});
