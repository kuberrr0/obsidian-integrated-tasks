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
    register(): void {}
  }
  return { ...original, ItemView, Menu: class {}, Notice: class {}, setIcon: vi.fn() };
});

import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { TaskMainView } from "../src/task-view";
import { parseTaskQuery } from "../src/task-query";
import { DEFAULT_SETTINGS, type SavedViewOptions, type SmartList } from "../src/types";
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
  const settings = { ...DEFAULT_SETTINGS, viewOptions: {} as Record<string, SavedViewOptions>, smartLists: [] as SmartList[] };
  const plugin = {
    settings, index, store: {}, dateFormat: () => "YYYY-MM-DD", openEditor: vi.fn(), openTaskView: vi.fn().mockResolvedValue(undefined),
    projectDraft: vi.fn(() => ({ tags: "" })),
    saveViewOptions: vi.fn((key: string, options?: SavedViewOptions) => { if (options) settings.viewOptions[key] = options; else delete settings.viewOptions[key]; }),
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
