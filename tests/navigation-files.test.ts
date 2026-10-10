// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

const menus: Array<{ titles: string[]; click(title: string): void }> = [];
vi.mock("obsidian", async importOriginal => {
  class Menu {
    items: Array<{ title: string; click?: () => void }> = [];
    constructor() { menus.push({ titles: [], click: title => this.items.find(item => item.title === title)?.click?.() }); }
    addItem(build: (item: Record<string, (value: unknown) => unknown>) => void): this {
      const entry: { title: string; click?: () => void } = { title: "" };
      const item: Record<string, (value: unknown) => unknown> = {};
      for (const name of ["setSection", "setIcon", "setWarning"]) item[name] = () => item;
      item.setTitle = title => { entry.title = String(title); menus[menus.length - 1].titles.push(entry.title); return item; };
      item.onClick = click => { entry.click = click as () => void; return item; };
      build(item);
      this.items.push(entry);
      return this;
    }
    showAtMouseEvent(): void {}
  }
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Menu, Keymap: { isModEvent: (event: MouseEvent) => event.metaKey }, Notice: class {}, setIcon: vi.fn() };
});

import { TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { sortFiles, TaskNavigationView } from "../src/navigation-view";
import { dropTargetOf } from "../src/sidebar-drop";
import { DEFAULT_SETTINGS } from "../src/types";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => installObsidianDom());

function setup() {
  const byPath = new Map<string, TFile | TFolder>();
  const folder = (path: string, parent: TFolder | null): TFolder => {
    const made = Object.assign(new TFolder(), { path, name: path.split("/").pop() ?? "", parent, children: [] as Array<TFile | TFolder>, isRoot: () => path === "/" });
    parent?.children.push(made);
    byPath.set(path, made);
    return made;
  };
  const file = (path: string, parent: TFolder): TFile => {
    const name = path.split("/").pop()!;
    const made = Object.assign(new TFile(), { path, name, basename: name.replace(/\.[^.]+$/, ""), extension: name.split(".").pop()!, parent });
    parent.children.push(made);
    byPath.set(path, made);
    return made;
  };
  const root = folder("/", null);
  const work = folder("Work", root);
  file("Work/Plan.md", work);
  file("Work/diagram.png", work);
  const note = file("Notes 10.md", root);
  file("Notes 2.md", root);
  const openFile = vi.fn(async () => {});
  const getLeaf = vi.fn(() => ({ openFile }));
  const renameFile = vi.fn(async () => {});
  const create = vi.fn(async (path: string) => file(path, root));
  const app = {
    vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => byPath.get(path) ?? null, on: () => ({}), create, createFolder: vi.fn() },
    workspace: { getActiveFile: () => note, getLeaf, on: () => ({}), trigger: vi.fn(), requestSaveLayout: vi.fn() },
    fileManager: { renameFile, promptForDeletion: vi.fn() },
    // Records what the tree hands Obsidian's drag manager: what each row drags, and what each drops.
    dragManager: {
      drags: new Map<HTMLElement, (event: DragEvent) => unknown>(),
      drops: new Map<HTMLElement, (event: DragEvent, draggable: unknown, hovering: boolean) => unknown>(),
      handleDrag(element: HTMLElement, start: (event: DragEvent) => unknown) { this.drags.set(element, start); },
      handleDrop(element: HTMLElement, drop: (event: DragEvent, draggable: unknown, hovering: boolean) => unknown) { this.drops.set(element, drop); },
      dragFile: (_event: DragEvent, file: TFile) => ({ type: "file", file }),
      dragFolder: (_event: DragEvent, folder: TFolder) => ({ type: "folder", file: folder })
    }
  };
  const settings = { ...DEFAULT_SETTINGS, showFiles: false };
  const plugin = { settings, index: { projects: () => [], tagSummaries: () => [], query: () => [] } } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({ app } as unknown as WorkspaceLeaf, plugin);
  const container = view.containerEl.children[1] as HTMLElement;
  const labels = () => Array.from(container.querySelectorAll(".tm-nav-files .tm-nav-children .tm-nav-label, .tm-nav-files input")).map(label => label.textContent || (label as HTMLInputElement).value);
  const row = (key: string) => container.querySelector(`[data-tm-nav-key="${key}"]`)!.closest(".tm-nav-item") as HTMLElement;
  return { view, settings, container, labels, row, app, getLeaf, openFile, renameFile, create, root, work };
}

it("indents smart lists a step under All Tasks, as subprojects are under their parent", () => {
  const { view, settings, row } = setup();
  settings.smartLists = [{ id: "work", name: "Work", filters: [], sort: "date", descending: false, grouping: "default" }];
  view.setActive("smartLists", undefined, undefined, "work");
  view.refresh();
  expect(row("mode:all").style.getPropertyValue("--tm-nav-depth")).toBe("");
  expect(row("list:work").style.getPropertyValue("--tm-nav-depth")).toBe("1");
});

it("lists the vault's files below everything else only when the setting is on", () => {
  const { view, settings, container, labels } = setup();
  view.refresh();
  expect(container.querySelector(".tm-nav-files")).toBeNull();
  settings.showFiles = true;
  view.refresh();
  const sections = Array.from(container.querySelectorAll(".tm-nav-section"));
  expect(sections[sections.length - 1].classList.contains("tm-nav-files")).toBe(true);
  // A folded section says so, for the spacing after it.
  for (const section of sections) expect(section.classList.contains("is-folded")).toBe(!Array.from(section.children).some(child => child.classList.contains("tm-nav-children")));
  expect(sections.some(section => section.classList.contains("is-folded"))).toBe(true);
  // Folders first, then files by name, numbers in number order; notes without “.md”.
  expect(labels()).toEqual(["Work", "Notes 2", "Notes 10"]);
});

it("opens folders in place, remembers them, and opens files (in a new tab with the modifier)", async () => {
  const { view, settings, labels, row, getLeaf, openFile } = setup();
  settings.showFiles = true;
  view.refresh();
  expect(row("file:Notes 10.md").classList.contains("is-active")).toBe(true);
  (row("folder:Work").querySelector(".tm-nav-label") as HTMLElement).click();
  expect(labels()).toEqual(["Work", "diagram", "Plan", "Notes 2", "Notes 10"]);
  expect(row("file:Work/diagram.png").querySelector(".tm-nav-file-tag")?.textContent).toBe("png");
  expect(row("file:Work/Plan.md").style.getPropertyValue("--tm-nav-depth")).toBe("1");
  expect(view.getState()).toMatchObject({ openFolders: ["Work"] });
  (row("file:Work/Plan.md").querySelector(".tm-nav-label") as HTMLElement).dispatchEvent(new MouseEvent("click", { metaKey: true }));
  await Promise.resolve();
  expect(getLeaf).toHaveBeenLastCalledWith(true);
  expect(openFile).toHaveBeenCalledOnce();
  // The open folders come back with the sidebar.
  const next = setup();
  next.settings.showFiles = true;
  await next.view.setState({ openFolders: ["Work"] }, { history: false });
  expect(next.labels()).toContain("Plan");
});

it("renames in place from the menu, and makes new notes in a folder", async () => {
  const { view, settings, container, row, renameFile, create } = setup();
  settings.showFiles = true;
  view.refresh();
  row("file:Notes 2.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  const menu = menus[menus.length - 1];
  expect(menu.titles).toEqual(["Open in new tab", "Open to the right", "Rename…", "Delete"]);
  menu.click("Rename…");
  const input = container.querySelector("input.tm-nav-rename") as HTMLInputElement;
  expect(input.value).toBe("Notes 2");
  input.value = "Ideas";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(renameFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Notes 2.md" }), "Ideas.md");
  expect(container.querySelector("input.tm-nav-rename")).toBeNull();
  // A taken name is refused.
  row("file:Notes 10.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  menus[menus.length - 1].click("Rename…");
  const again = container.querySelector("input.tm-nav-rename") as HTMLInputElement;
  again.value = "Notes 2";
  again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(renameFile).toHaveBeenCalledOnce();
  row("folder:Work").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  expect(menus[menus.length - 1].titles.slice(0, 2)).toEqual(["New note", "New folder"]);
  menus[menus.length - 1].click("New note");
  await vi.waitFor(() => expect(create).toHaveBeenCalledWith("Work/Untitled.md", ""));
});

it("adds folder and sort buttons to the toolbar with the files, and sorts files as the file explorer does", () => {
  const { view, settings, container, root } = setup();
  const actions = () => Array.from(container.querySelectorAll(".nav-action-button")).map(button => button.getAttribute("aria-label"));
  view.refresh();
  expect(actions()).toEqual(["New task", "New note", "Task mode"]);
  settings.showFiles = true;
  view.refresh();
  expect(actions()).toEqual(["New task", "New note", "Task mode", "New folder", "Change sort order"]);
  const [work, notes10, notes2] = [root.children[0], root.children[1], root.children[2]] as [TFolder, TFile, TFile];
  Object.assign(notes10, { stat: { mtime: 1, ctime: 3 } });
  Object.assign(notes2, { stat: { mtime: 2, ctime: 1 } });
  const names = (order: Parameters<typeof sortFiles>[1]) => sortFiles(root.children, order).map(file => file.name);
  expect(work).toBeInstanceOf(TFolder);
  expect(names("alphabetical")).toEqual(["Work", "Notes 2.md", "Notes 10.md"]);
  expect(names("alphabeticalReverse")).toEqual(["Work", "Notes 10.md", "Notes 2.md"]);
  expect(names("byModifiedTime")).toEqual(["Work", "Notes 2.md", "Notes 10.md"]);
  expect(names("byModifiedTimeReverse")).toEqual(["Work", "Notes 10.md", "Notes 2.md"]);
  expect(names("byCreatedTime")).toEqual(["Work", "Notes 10.md", "Notes 2.md"]);
  expect(names("byCreatedTimeReverse")).toEqual(["Work", "Notes 2.md", "Notes 10.md"]);
});

it("drags files as the file explorer does, and moves files and folders dropped on a folder", async () => {
  const { view, settings, row, app, renameFile, root, work } = setup();
  settings.showFiles = true;
  view.refresh();
  const { drags, drops } = app.dragManager;
  const notes = row("file:Notes 2.md");
  const folder = row("folder:Work");
  const heading = row("files");
  expect(drags.get(notes)!({} as DragEvent)).toEqual({ type: "file", file: root.children[2] });
  expect(drags.get(folder)!({} as DragEvent)).toEqual({ type: "folder", file: work });
  // Folders and the Files heading (the vault's top) take files; a note takes tasks instead.
  expect(drops.has(folder) && drops.has(heading) && !drops.has(notes)).toBe(true);
  expect(dropTargetOf(notes)?.drop).toEqual({ kind: "note", path: "Notes 2.md" });
  expect(dropTargetOf(folder)).toBeUndefined();
  const note = root.children[2];
  // Hovering says where the file goes and lights the folder up, without moving it.
  expect(drops.get(folder)!({} as DragEvent, { type: "file", file: note }, true)).toMatchObject({ action: "Move into Work", dropEffect: "move", hoverEl: folder });
  expect(renameFile).not.toHaveBeenCalled();
  drops.get(folder)!({} as DragEvent, { type: "file", file: note }, false);
  await vi.waitFor(() => expect(renameFile).toHaveBeenCalledWith(note, "Work/Notes 2.md"));
  // A file already in the folder, or a folder dropped into itself, goes nowhere.
  expect(drops.get(heading)!({} as DragEvent, { type: "file", file: note }, true)).toMatchObject({ dropEffect: "none" });
  expect(drops.get(folder)!({} as DragEvent, { type: "folder", file: work }, true)).toMatchObject({ dropEffect: "none" });
  // Something that is not a file, such as a task, is left to other targets.
  expect(drops.get(folder)!({} as DragEvent, null, true)).toBeUndefined();
});
