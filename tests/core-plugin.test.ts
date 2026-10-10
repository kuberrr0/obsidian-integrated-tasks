import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

vi.mock("obsidian", async importOriginal => {
  class Plugin {
    private readonly cleanups: Array<() => void> = [];
    settingTabs: unknown[] = [];
    constructor(public app: App, public manifest: unknown) {}
    async loadData(): Promise<unknown> { return null; }
    async saveData(): Promise<void> {}
    registerView(): void {}
    registerEditorExtension(): void {}
    registerMarkdownPostProcessor(): void {}
    registerMarkdownCodeBlockProcessor(): void {}
    addSettingTab(tab: unknown): void { this.settingTabs.push(tab); }
    addRibbonIcon() { return { setAttribute() {}, classList: { toggle() {} } }; }
    addCommand(command: unknown) { return command; }
    register(callback: () => void): void { this.cleanups.push(callback); }
    registerInterval(id: number): number { this.cleanups.push(() => window.clearInterval(id)); return id; }
    registerEvent(ref: { e: { offref(ref: unknown): void } }): void { this.cleanups.push(() => ref.e.offref(ref)); }
    onunload(): void {}
    /** Like Obsidian: onunload first, then everything registered through the component. */
    unload(): void {
      this.onunload();
      for (const cleanup of this.cleanups.splice(0)) cleanup();
    }
  }
  class Setting {
    settingEl = { addClass() {} };
    change?: (value: string) => unknown;
    private control() {
      const control: Record<string, unknown> = {};
      for (const method of ["setPlaceholder", "setValue", "addOption", "setButtonText", "setDisabled", "onClick"]) control[method] = () => control;
      control.onChange = (change: (value: string) => unknown) => { this.change = change; return control; };
      return control;
    }
    addText(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addToggle(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addDropdown(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addButton(callback: (control: unknown) => void) { callback(this.control()); return this; }
  }
  return {
    ...await importOriginal<typeof import("./obsidian-mock")>(),
    Plugin, Setting, ItemView: class {}, MarkdownView: class {}, Modal: class { open() {} },
    PluginSettingTab: class { hide() {} }, Notice: class {}, setIcon: vi.fn()
  };
});
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));

import { Setting, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import TaskManagerPlugin from "../src/main";
import * as parser from "../src/parser";
import { TaskManagerSettingTab } from "../src/settings";
import { TASK_MAIN_VIEW } from "../src/task-view";
import { FakeEvents, flush } from "./core-events";

const originalSetViewState = WorkspaceLeaf.prototype.setViewState;

interface FakeLeaf {
  type: string;
  state: Record<string, unknown>;
  getViewState(): { type: string; state: Record<string, unknown> };
  setViewState: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
}

const note = (path: string): TFile => Object.assign(new TFile(), { path, extension: "md" });

function environment(paths: string[] = ["A.md"]) {
  const files = paths.map(note);
  const frontmatter = new Map<string, Record<string, unknown>>();
  const waiting: Array<() => void> = [];
  let hold = false;
  const vault = Object.assign(new FakeEvents(), {
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
    cachedRead: async (file: TFile) => {
      if (hold) await new Promise<void>(resolve => waiting.push(resolve));
      return `- [ ] Task in ${file.path}`;
    }
  });
  const metadataCache = Object.assign(new FakeEvents(), {
    getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) ?? {} }),
    getFirstLinkpathDest: () => null
  });
  const leaves: FakeLeaf[] = [];
  let layoutReady: (() => void) | undefined;
  const workspace = Object.assign(new FakeEvents(), {
    onLayoutReady: (callback: () => void) => { layoutReady = callback; },
    getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.type === type),
    getLeftLeaf: vi.fn(() => null),
    getRightLeaf: vi.fn(() => null),
    getLeaf: vi.fn(),
    getMostRecentLeaf: () => null,
    revealLeaf: vi.fn(async () => {}),
    getActiveViewOfType: () => null,
    requestSaveLayout: vi.fn()
  });
  const fileManager = {
    processFrontMatter: vi.fn(async (file: TFile, update: (value: Record<string, unknown>) => void) => update(frontmatter.get(file.path) ?? {})),
    // Obsidian mutates the file and reports the rename before the promise resolves.
    renameFile: vi.fn(async (file: TFile, path: string) => {
      const oldPath = file.path;
      file.path = path;
      if (frontmatter.has(oldPath)) frontmatter.set(path, frontmatter.get(oldPath)!);
      vault.trigger("rename", file, oldPath);
    })
  };
  const app = { vault, metadataCache, workspace, fileManager } as unknown as App;
  const addLeaf = (type: string, state: Record<string, unknown>): FakeLeaf => {
    const leaf: FakeLeaf = {
      type, state,
      getViewState: () => ({ type: leaf.type, state: leaf.state }),
      setViewState: vi.fn(async (next: { type: string; state: Record<string, unknown> }) => { leaf.type = next.type; leaf.state = next.state; }),
      detach: vi.fn(() => { leaves.splice(leaves.indexOf(leaf), 1); })
    };
    leaves.push(leaf);
    return leaf;
  };
  return {
    app, files, frontmatter, vault, metadataCache, workspace, fileManager, leaves, addLeaf,
    holdReads: () => { hold = true; },
    release: () => { hold = false; for (const resolve of waiting.splice(0)) resolve(); },
    layoutReady: () => layoutReady?.()
  };
}

async function loaded(paths?: string[]) {
  const env = environment(paths);
  const plugin = new TaskManagerPlugin(env.app, {} as never);
  await plugin.onload();
  env.layoutReady();
  await flush();
  return { env, plugin };
}

const controller = (plugin: TaskManagerPlugin): unknown => (plugin as unknown as { taskModeController?: unknown }).taskModeController;
const retargeting = (plugin: TaskManagerPlugin): Promise<void> => (plugin as unknown as { viewRetargeting: Promise<void> }).viewRetargeting;

beforeEach(() => { vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("plugin lifecycle", () => {
  it("indexes on layout ready, starts task mode after the index, and unregisters everything on unload", async () => {
    const env = environment(["A.md", "B.md"]);
    const plugin = new TaskManagerPlugin(env.app, {} as never);
    await plugin.onload();
    // Only the view rename and delete handlers exist before the workspace is ready.
    expect(env.vault.listenerCount()).toBe(2);
    expect(env.metadataCache.listenerCount()).toBe(0);
    const initialize = vi.spyOn(plugin.index, "initialize");
    env.holdReads();
    env.layoutReady();
    expect(initialize).toHaveBeenCalledOnce();
    await flush();
    expect(controller(plugin)).toBeUndefined();
    env.release();
    await flush();
    expect(controller(plugin)).toBeDefined();
    // Project notes open straight as task views: every tab's view change passes through task mode until unload.
    expect(WorkspaceLeaf.prototype.setViewState).not.toBe(originalSetViewState);
    expect(env.vault.listenerCount()).toBe(6);
    expect(env.metadataCache.listenerCount()).toBe(2);
    expect(env.workspace.listenerCount()).toBe(3);
    plugin.unload();
    expect(WorkspaceLeaf.prototype.setViewState).toBe(originalSetViewState);
    expect(env.vault.listenerCount()).toBe(0);
    expect(env.metadataCache.listenerCount()).toBe(0);
    expect(env.workspace.listenerCount()).toBe(0);
  });

  it("parses notes again once a new day starts", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 5, 23, 59));
    const { plugin } = await loaded();
    const rescan = vi.spyOn(plugin.index, "rescanAll");
    vi.advanceTimersByTime(30_000);
    expect(rescan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(rescan).toHaveBeenCalledExactlyOnceWith({ force: false });
    vi.advanceTimersByTime(60_000);
    expect(rescan).toHaveBeenCalledOnce();
    plugin.unload();
  });

  it("opens the task sidebar and Task Details on first run only, so a closed one stays closed", async () => {
    const { env, plugin } = await loaded();
    await flush();
    expect(env.workspace.getLeftLeaf).toHaveBeenCalledOnce();
    expect(env.workspace.getRightLeaf).toHaveBeenCalledOnce();
    expect(plugin.settings.panelsPlaced).toBe(true);
    plugin.unload();
    const again = environment();
    const next = new TaskManagerPlugin(again.app, {} as never);
    vi.spyOn(next, "loadData").mockResolvedValue({ panelsPlaced: true });
    await next.onload();
    again.layoutReady();
    await flush();
    expect(again.workspace.getLeftLeaf).not.toHaveBeenCalled();
    expect(again.workspace.getRightLeaf).not.toHaveBeenCalled();
    next.unload();
  });

  it("turns notes open as task views back into notes on unload, leaving lists such as Today", async () => {
    const { env, plugin } = await loaded(["A.md"]);
    const page = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "A.md", markdownState: { file: "A.md", mode: "source" } });
    const today = env.addLeaf(TASK_MAIN_VIEW, { mode: "today" });
    plugin.unload();
    expect(page.setViewState).toHaveBeenCalledExactlyOnceWith({ type: "markdown", state: { file: "A.md", mode: "source" } });
    expect(today.setViewState).not.toHaveBeenCalled();
  });

  it("starts Create new task in the Task Details sidebar with three panes, else in the task editor", async () => {
    const { plugin } = await loaded();
    const inSidebar = vi.spyOn(plugin as unknown as { newTaskInSidebar(state: unknown): Promise<void> }, "newTaskInSidebar").mockResolvedValue();
    const editor = vi.spyOn(plugin, "openEditor").mockImplementation(() => {});
    plugin.newTask();
    expect(editor).toHaveBeenCalledExactlyOnceWith({ mode: "inbox" });
    expect(inSidebar).not.toHaveBeenCalled();
    plugin.settings.taskDetails = "sidebar";
    plugin.newTask();
    expect(inSidebar).toHaveBeenCalledExactlyOnceWith({ mode: "inbox" });
    expect(editor).toHaveBeenCalledOnce();
    plugin.unload();
  });

  it("opens a task from a task-query block in the task editor, or with three panes in the Task Details sidebar", async () => {
    const { plugin } = await loaded();
    const inSidebar = vi.spyOn(plugin, "showInTaskSidebar").mockResolvedValue();
    const editor = vi.spyOn(plugin, "openEditor").mockImplementation(() => {});
    const task = { id: "A.md:0", path: "A.md", title: "One", line: 0 } as never;
    plugin.openTask(task, "deadline");
    expect(editor).toHaveBeenCalledExactlyOnceWith({ mode: "all", task, focusProperty: "deadline" });
    expect(inSidebar).not.toHaveBeenCalled();
    plugin.settings.taskDetails = "sidebar";
    plugin.openTask(task);
    expect(inSidebar).toHaveBeenCalledExactlyOnceWith("A.md:0", { focus: true });
    expect(editor).toHaveBeenCalledOnce();
    plugin.unload();
  });

  it("does nothing on layout ready after an early unload", async () => {
    const env = environment();
    const plugin = new TaskManagerPlugin(env.app, {} as never);
    await plugin.onload();
    const initialize = vi.spyOn(plugin.index, "initialize");
    plugin.unload();
    env.layoutReady();
    await flush();
    expect(initialize).not.toHaveBeenCalled();
    expect(env.vault.listenerCount() + env.metadataCache.listenerCount() + env.workspace.listenerCount()).toBe(0);
  });

  it("does not start task mode when unloaded while the vault is still being indexed", async () => {
    const env = environment();
    const plugin = new TaskManagerPlugin(env.app, {} as never);
    await plugin.onload();
    env.holdReads();
    env.layoutReady();
    await flush();
    plugin.unload();
    env.release();
    await flush();
    expect(controller(plugin)).toBeUndefined();
    expect(env.vault.listenerCount() + env.metadataCache.listenerCount() + env.workspace.listenerCount()).toBe(0);
  });
});

describe("task views follow their notes", () => {
  it("retargets open task views when a note is renamed, keeping their layout and Markdown state", async () => {
    const { env, plugin } = await loaded(["Old.md", "Other.md"]);
    const page = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Old.md", layout: "kanban", markdownState: { file: "Old.md", mode: "source" } });
    const legacy = env.addLeaf(TASK_MAIN_VIEW, { mode: "projects", projectPath: "Old.md" });
    const other = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Other.md" });
    const file = env.files[0];
    file.path = "Folder/New.md";
    env.vault.trigger("rename", file, "Old.md");
    await retargeting(plugin);
    expect(page.setViewState).toHaveBeenCalledExactlyOnceWith({ type: TASK_MAIN_VIEW, state: {
      mode: "all", pagePath: "Folder/New.md", layout: "kanban", markdownState: { file: "Folder/New.md", mode: "source" }
    } });
    expect(legacy.state).toEqual({ mode: "projects", projectPath: "Folder/New.md" });
    expect(other.setViewState).not.toHaveBeenCalled();
    // Renaming the folder moves views of notes inside it as well.
    const folder = Object.assign(new TFolder(), { path: "Moved" });
    env.vault.trigger("rename", folder, "Folder");
    await retargeting(plugin);
    expect(page.state.pagePath).toBe("Moved/New.md");
    expect(legacy.state.projectPath).toBe("Moved/New.md");
    expect(other.setViewState).not.toHaveBeenCalled();
  });

  it("closes task views of deleted notes and folders", async () => {
    const { env } = await loaded(["Gone.md", "Kept.md"]);
    const gone = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Gone.md" });
    const legacy = env.addLeaf(TASK_MAIN_VIEW, { mode: "projects", projectPath: "Gone.md" });
    const nested = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Folder/Inner.md" });
    const kept = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Kept.md" });
    const today = env.addLeaf(TASK_MAIN_VIEW, { mode: "today" });
    env.vault.trigger("delete", env.files[0]);
    expect(gone.detach).toHaveBeenCalledOnce();
    expect(legacy.detach).toHaveBeenCalledOnce();
    env.vault.trigger("delete", Object.assign(new TFolder(), { path: "Folder" }));
    expect(nested.detach).toHaveBeenCalledOnce();
    expect(kept.detach).not.toHaveBeenCalled();
    expect(today.detach).not.toHaveBeenCalled();
    expect(env.leaves).toEqual([kept, today]);
  });

  it("points the project's tab at its new name after renaming it instead of opening a duplicate", async () => {
    const { env, plugin } = await loaded(["Projects/Launch.md"]);
    env.frontmatter.set("Projects/Launch.md", { tags: ["project"] });
    env.metadataCache.trigger("changed", env.files[0]);
    const leaf = env.addLeaf(TASK_MAIN_VIEW, { mode: "all", pagePath: "Projects/Launch.md", layout: "calendar" });
    await plugin.updateProject("Projects/Launch.md", draft => ({ ...draft, name: "Renamed" }));
    expect(env.fileManager.renameFile).toHaveBeenCalledOnce();
    expect(leaf.state).toMatchObject({ pagePath: "Projects/Renamed.md", layout: "calendar" });
    expect(env.workspace.getLeaf).not.toHaveBeenCalled();
    expect(plugin.index.isProject("Projects/Renamed.md")).toBe(true);
  });

  it("moves a renamed note's kept view options and layout, and the smart lists made from it, to its new name", async () => {
    const { env, plugin } = await loaded(["Projects/Launch.md", "Errands.md"]);
    const options = { filters: [], sort: "title" as const, descending: false, grouping: "default" as const };
    plugin.settings.viewOptions = { "project:Projects/Launch.md": options, "tag:Errands.md": options, today: options };
    plugin.settings.viewLayouts = { "project:Projects/Launch.md": "kanban" };
    plugin.settings.smartLists = [{ id: "a", name: "Launch P1", filters: [], sort: "date", descending: false, grouping: "default", scope: { mode: "project", path: "Projects/Launch.md" } }];
    const save = vi.spyOn(plugin, "saveSettings");
    env.vault.trigger("rename", Object.assign(new TFile(), { path: "Projects/Liftoff.md", extension: "md" }), "Projects/Launch.md");
    await retargeting(plugin);
    expect(Object.keys(plugin.settings.viewOptions).sort()).toEqual(["project:Projects/Liftoff.md", "tag:Errands.md", "today"]);
    expect(plugin.settings.viewLayouts).toEqual({ "project:Projects/Liftoff.md": "kanban" });
    expect(plugin.settings.smartLists[0].scope).toEqual({ mode: "project", path: "Projects/Liftoff.md" });
    expect(save).toHaveBeenCalled();
  });
});

it("rescans the vault once, in one index update, after typing a new date format", async () => {
  const { env, plugin } = await loaded(Array.from({ length: 60 }, (_, i) => `N${i}.md`));
  const listener = vi.fn();
  plugin.index.subscribe(listener);
  const rescanAll = vi.spyOn(plugin.index, "rescanAll");
  const scan = vi.spyOn(parser, "scanTasks");
  try {
    const tab = (plugin as unknown as { settingTabs: TaskManagerSettingTab[] }).settingTabs[0];
    const definition = tab.getSettingDefinitions().flatMap(group => group.items).find(item => item.name === "Date format")!;
    const setting = new Setting({} as HTMLElement) as unknown as { change: (value: string) => unknown };
    definition.render(setting as never);
    vi.useFakeTimers();
    for (const typed of ["D", "DD", "DD.", "DD.MM", "DD.MM.YYYY"]) {
      setting.change(typed);
      await vi.advanceTimersByTimeAsync(120);
    }
    expect(rescanAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    await vi.waitFor(() => expect(rescanAll).toHaveBeenCalledOnce());
    await rescanAll.mock.results[0].value;
    expect(plugin.settings.dateFormat).toBe("DD.MM.YYYY");
    expect(scan).toHaveBeenCalledTimes(env.files.length);
    expect(listener).toHaveBeenCalledOnce();
  } finally { scan.mockRestore(); }
});
