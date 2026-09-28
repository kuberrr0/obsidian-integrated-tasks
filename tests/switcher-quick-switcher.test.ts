// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

const opened: unknown[] = [];
vi.mock("obsidian", async importOriginal => {
  class FuzzySuggestModal<T> {
    limit = 100;
    placeholder = "";
    constructor(public app: unknown) {}
    setPlaceholder(text: string): void { this.placeholder = text; }
    open(): void { opened.push(this); }
    close(): void {}
    getItems(): T[] { return []; }
    getItemText(_item: T): string { return ""; }
    // Stand-in for Obsidian's fuzzy search: substring match, best (earliest) match first.
    getSuggestions(query: string) {
      const q = query.toLowerCase();
      return this.getItems()
        .map(item => ({ item, index: this.getItemText(item).toLowerCase().indexOf(q) }))
        .filter(result => result.index >= 0)
        .sort((a, b) => a.index - b.index)
        .map(({ item, index }) => ({ item, match: { score: -index, matches: [[index, index + q.length]] } }));
    }
  }
  const commands: Array<{ id: string; name: string; callback?: () => void }> = [];
  class Plugin {
    constructor(public app: unknown) {}
    async loadData(): Promise<unknown> { return null; }
    registerView(): void {}
    registerEditorExtension(): void {}
    registerMarkdownPostProcessor(): void {}
    registerMarkdownCodeBlockProcessor(): void {}
    addSettingTab(): void {}
    addRibbonIcon() { return { setAttribute() {}, classList: { toggle() {} } }; }
    addCommand(command: { id: string; name: string }) { commands.push(command); return command; }
    registerEvent(): void {}
    register(): void {}
  }
  return {
    ...await importOriginal<typeof import("./obsidian-mock")>(),
    FuzzySuggestModal, Plugin, commands, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {},
    Notice: class {}, setIcon: vi.fn(),
    renderResults: (el: HTMLElement, text: string) => { el.textContent = text; }
  };
});
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));

import type { App } from "obsidian";
import * as obsidian from "obsidian";
import TaskManagerPlugin from "../src/main";
import { SWITCHER_TASK_LIMIT, TaskQuickSwitcher, switcherItems, type SwitcherItem } from "../src/quick-switcher";
import { scanTasks } from "../src/parser";
import type { Project } from "../src/types";

beforeAll(() => installObsidianDom());

const project = (name: string, archived = false): Project => ({ path: `Projects/${name}.md`, name, archived, openTasks: 0, completedTasks: 0 });

function host(taskCount = 2) {
  const tasks = scanTasks("Notes/Work.md", Array.from({ length: taskCount }, (_, i) => `- [ ] Task ${i}`).join("\n"));
  const query = vi.fn(() => tasks);
  return {
    index: { projects: () => [project("Old", true), project("Launch")], tagSummaries: () => [{ name: "#work", openTasks: 1, completedTasks: 0 }], query },
    settings: { smartLists: [{ id: "focus", name: "Focus", filters: [], sort: "date", descending: false, grouping: "none" }] },
    openTaskView: vi.fn().mockResolvedValue(undefined),
    openProject: vi.fn().mockResolvedValue(undefined),
    openTag: vi.fn().mockResolvedValue(undefined),
    openEditor: vi.fn(),
    tasks
  };
}
type Host = ReturnType<typeof host>;
const switcher = (plugin: Host) => new TaskQuickSwitcher({} as App, plugin as unknown as TaskManagerPlugin);

describe("quick switcher items", () => {
  it("lists views, then active and archived projects, tags, smart lists, and open tasks with their note", () => {
    const plugin = host();
    const items = switcherItems(plugin as unknown as TaskManagerPlugin);
    expect(items.map(item => `${item.kind}:${item.label}`)).toEqual([
      "view:Task dashboard", "view:Inbox", "view:Today", "view:Upcoming", "view:All tasks", "view:Projects", "view:Tags", "view:Smart lists", "view:Weekly review",
      "project:Launch", "project:Old", "tag:#work", "smartList:Focus", "task:Task 0", "task:Task 1"
    ]);
    expect(items.find(item => item.label === "Old")).toMatchObject({ archived: true });
    expect(items.at(-1)).toMatchObject({ kind: "task", note: "Work" });
    expect(plugin.index.query).toHaveBeenCalledWith({ mode: "all", showCompleted: false });
  });

  it("caps the number of task items and builds them once per opening", () => {
    const plugin = host(SWITCHER_TASK_LIMIT + 10);
    const modal = switcher(plugin);
    expect(modal.getItems().filter(item => item.kind === "task")).toHaveLength(SWITCHER_TASK_LIMIT);
    modal.getSuggestions("task");
    modal.getSuggestions("tas");
    expect(plugin.index.query).toHaveBeenCalledOnce();
  });

  it("keeps the natural order with an empty query and ranks matches when typing", () => {
    const modal = switcher(host());
    expect(modal.getSuggestions("").map(result => result.item.label).slice(0, 3)).toEqual(["Task dashboard", "Inbox", "Today"]);
    expect(modal.getSuggestions("  ")[0].item.label).toBe("Task dashboard");
    expect(modal.getSuggestions("launch").map(result => result.item.label)).toEqual(["Launch"]);
    expect((modal as unknown as { placeholder: string }).placeholder).toBe("Jump to a view, project, tag, smart list, or task…");
  });

  it("renders an icon, the title, the task's note, and a kind label", () => {
    const modal = switcher(host());
    const render = (item: SwitcherItem) => {
      const el = document.createElement("div");
      modal.renderSuggestion({ item, match: { score: 0, matches: [] } }, el);
      return el;
    };
    const items = modal.getItems();
    const task = render(items.find(item => item.kind === "task")!);
    expect(task.querySelector(".suggestion-icon")).not.toBeNull();
    expect(task.querySelector(".suggestion-title")?.textContent).toBe("Task 0");
    expect(task.querySelector(".suggestion-note")?.textContent).toBe("Work");
    expect(task.querySelector(".suggestion-aux")?.textContent).toBe("Task");
    expect(render(items.find(item => item.label === "Old")!).querySelector(".suggestion-aux")?.textContent).toBe("Archived project");
    expect(render(items[0]).querySelector(".suggestion-note")).toBeNull();
  });
});

describe("choosing a quick switcher item", () => {
  it("opens the matching view, project, tag, smart list, or task editor", () => {
    const plugin = host();
    const modal = switcher(plugin);
    const choose = (label: string) => modal.onChooseItem(modal.getItems().find(item => item.label === label)!);
    choose("Upcoming");
    expect(plugin.openTaskView).toHaveBeenLastCalledWith({ mode: "upcoming" });
    choose("Smart lists");
    expect(plugin.openTaskView).toHaveBeenLastCalledWith({ mode: "smartLists" });
    choose("Launch");
    expect(plugin.openProject).toHaveBeenCalledWith("Projects/Launch.md");
    choose("#work");
    expect(plugin.openTag).toHaveBeenCalledWith("#work");
    choose("Focus");
    expect(plugin.openTaskView).toHaveBeenLastCalledWith({ mode: "smartLists", smartListId: "focus" });
    choose("Task 1");
    expect(plugin.openEditor).toHaveBeenCalledWith({ mode: "all", task: plugin.tasks[1] });
  });
});

describe("quick switcher command", () => {
  it("registers a command that opens the switcher", async () => {
    const app = { workspace: { getLeavesOfType: () => [], onLayoutReady: () => {} }, vault: { on: () => ({}) } };
    const plugin = new TaskManagerPlugin(app as unknown as App, {} as never);
    await plugin.onload();
    const commands = (obsidian as unknown as { commands: Array<{ id: string; name: string; callback?: () => void }> }).commands;
    const command = commands.find(entry => entry.id === "quick-switch")!;
    expect(command.name).toBe("Quick switch to view, project, tag, or task");
    opened.length = 0;
    command.callback!();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBeInstanceOf(TaskQuickSwitcher);
  });
});
