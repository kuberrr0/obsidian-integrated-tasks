import { ItemView, Keymap, Menu, Notice, setIcon, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { FileSortOrder, TaskViewMode } from "./types";
import { activeProjects, renderProjectProgress } from "./project-progress";
import { projectHierarchy } from "./project-hierarchy";
import { activeTaskDrag, highlightDropTarget, markDropTarget, TASK_DRAG_TYPE, type SidebarDrop } from "./sidebar-drop";

export const TASK_NAV_VIEW = "task-manager-navigation";

/** A list in the sidebar, as Things shows its lists: a coloured icon, the name, and (for some) how many tasks are open. */
interface NavEntry { mode: TaskViewMode; label: string; icon: string; color: string; count?: boolean; griplyIcon?: string }

/** The lists, in groups set apart as Things sets its lists apart. */
const NAV_GROUPS: NavEntry[][] = [
  [{ mode: "inbox", label: "Inbox", icon: "inbox", color: "blue", count: true }],
  [
    { mode: "today", label: "Today", icon: "star", griplyIcon: "calendar-x", color: "yellow", count: true },
    { mode: "upcoming", label: "Upcoming", icon: "calendar-days", color: "red" },
    { mode: "all", label: "All Tasks", icon: "layers", color: "cyan" }
  ]
];

/** What folds away from a chevron: smart lists under All Tasks, and the sections below the lists (each a heading over
 * its items). */
type NavSection = "smartLists" | "projects" | "tags" | "files";
const NAV_SECTIONS: Array<{ section: NavSection; label: string; icon: string; open: TaskViewMode }> = [
  { section: "projects", label: "Projects", icon: "square-chart-gantt", open: "projects" },
  { section: "tags", label: "Tags", icon: "tag", open: "tags" }
];
/** The icon a file shows by its kind, as the file explorer would name them. */
const FILE_ICONS: Record<string, string> = {
  md: "file-text", canvas: "layout-dashboard", base: "table", pdf: "file-text",
  png: "file-image", jpg: "file-image", jpeg: "file-image", gif: "file-image", svg: "file-image", webp: "file-image", bmp: "file-image", avif: "file-image",
  mp3: "file-audio", wav: "file-audio", m4a: "file-audio", ogg: "file-audio", flac: "file-audio", webm: "file-video", mp4: "file-video", mov: "file-video", mkv: "file-video"
};
/** Whether `file` can move into `folder`: not where it already is, and a folder not into itself or a folder inside it. */
export function canMoveInto(file: TAbstractFile, folder: TFolder): boolean {
  if (file.parent === folder) return false;
  return !(file instanceof TFolder && (file === folder || folder.path.startsWith(`${file.path}/`)));
}

/** The file tree's orders, with the names and groups the file explorer gives them. */
const FILE_SORT_ORDERS: Array<[FileSortOrder, string, string]> = [
  ["alphabetical", "File name (A to Z)", "name"], ["alphabeticalReverse", "File name (Z to A)", "name"],
  ["byModifiedTime", "Modified time (new to old)", "modified"], ["byModifiedTimeReverse", "Modified time (old to new)", "modified"],
  ["byCreatedTime", "Created time (new to old)", "created"], ["byCreatedTimeReverse", "Created time (old to new)", "created"]
];

/** `files` in `order`, folders first. Folders have no times, so they go by name, backwards only in Z to A. */
export function sortFiles(files: TAbstractFile[], order: FileSortOrder): TAbstractFile[] {
  const byName = (a: TAbstractFile, b: TAbstractFile): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const time = (file: TAbstractFile): number => file instanceof TFile ? order.startsWith("byCreated") ? file.stat.ctime : file.stat.mtime : 0;
  return [...files].sort((a, b) => {
    const folders = Number(b instanceof TFolder) - Number(a instanceof TFolder);
    if (folders) return folders;
    if (order === "alphabetical") return byName(a, b);
    if (order === "alphabeticalReverse") return byName(b, a);
    if (a instanceof TFolder) return byName(a, b);
    return (order.endsWith("Reverse") ? time(a) - time(b) : time(b) - time(a)) || byName(a, b);
  });
}
/** What Obsidian's drag manager carries: a file or folder, or several from the file explorer. */
interface Draggable { type: string; file?: TAbstractFile; files?: TAbstractFile[] }
interface DropResult { action: string; dropEffect: "move" | "none"; hoverEl?: HTMLElement; hoverClass?: string }
/** Obsidian's drag manager, which its file explorer drags files with, so a file dragged from here links in a note, opens
 * in a tab, or moves in the file explorer. It is not in the plugin API, so files drag only while it is there. */
interface DragManager {
  handleDrag(element: HTMLElement, start: (event: DragEvent) => Draggable | null): void;
  handleDrop(element: HTMLElement, drop: (event: DragEvent, draggable: Draggable | null, hovering: boolean) => DropResult | undefined): void;
  dragFile(event: DragEvent, file: TFile, source?: string): Draggable;
  dragFolder(event: DragEvent, folder: TFolder, source?: string): Draggable;
}
const NAV_MODES = new Set<TaskViewMode>([...NAV_GROUPS.flat().map(entry => entry.mode), "projects", "tags"]);

export class TaskNavigationView extends ItemView {
  private activeMode: TaskViewMode = "today";
  private activeTag?: string;
  private activeSmartList?: string;
  private activeProject?: string;
  /** Sections shown open; Things lists its projects, so smart lists and projects start open. */
  private expanded = new Set<NavSection>(["smartLists", "projects", "files"]);
  /** Parent projects whose subprojects are folded away. */
  private foldedProjects = new Set<string>();
  /** Folders shown open in the file tree; kept with the sidebar's layout. */
  private openFolders = new Set<string>();
  /** The file or folder being renamed in place, and the name typed so far. */
  private renaming?: { path: string; value: string; selected: boolean };
  /** True while the list is rebuilt, when a rename field losing focus is not the user leaving it. */
  private rebuilding = false;
  private fileEvents = false;
  private unsubscribe?: () => void;
  private frame?: number;
  // The toolbar is one tab stop; arrow keys move between its buttons.
  private toolbarFocus = 0;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) { super(leaf); }
  getViewType(): string { return TASK_NAV_VIEW; }
  getDisplayText(): string { return "Tasks"; }
  getIcon(): string { return "circle-check-big"; }
  getState(): Record<string, unknown> { return { ...super.getState(), openFolders: [...this.openFolders] }; }
  async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const folders = (state as { openFolders?: unknown } | null)?.openFolders;
    if (Array.isArray(folders)) this.openFolders = new Set(folders.filter((path): path is string => typeof path === "string"));
    await super.setState(state, result);
    this.render();
  }
  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.index.subscribe(() => this.scheduleRender());
    const syncActive = (): void => {
      if (this.plugin.settings.showFiles) this.scheduleRender();
      const view = this.app.workspace.getActiveViewOfType(ItemView);
      if (view?.getViewType() !== "task-manager-main") return;
      const state = view.getState();
      const mode = NAV_MODES.has(state.mode as TaskViewMode) ? state.mode as TaskViewMode : undefined;
      if (state.mode === "smartLists") { this.setActive("smartLists", undefined, undefined, typeof state.smartListId === "string" ? state.smartListId : undefined); return; }
      if (mode) this.setActive(mode, typeof state.tag === "string" ? state.tag : undefined,
        mode === "tags" ? undefined : typeof state.pagePath === "string" ? state.pagePath : typeof state.projectPath === "string" ? state.projectPath : undefined);
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncActive));
    syncActive();
    this.render();
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); this.cancelRender(); }
  setActive(mode: TaskViewMode, tag?: string, project?: string, smartListId?: string): void {
    this.activeSmartList = smartListId;
    this.activeMode = mode; this.activeTag = tag; this.activeProject = project;
    // The section holding the open item unfolds, so it shows.
    if (smartListId) this.expanded.add("smartLists");
    else if (tag) this.expanded.add("tags");
    else if (project) this.expanded.add("projects");
    this.render();
  }
  refresh(): void { this.render(); }

  /** Index events arrive in bursts, so render at most once per frame. */
  private scheduleRender(): void {
    if (this.frame !== undefined) return;
    this.frame = this.containerEl.win.requestAnimationFrame(() => {
      this.frame = undefined;
      // A name being typed keeps its field; the list catches up when the rename ends.
      if (!this.renaming) this.render();
    });
  }

  private cancelRender(): void {
    if (this.frame === undefined) return;
    this.containerEl.win.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private render(): void {
    this.cancelRender();
    const container = this.containerEl.children[1] as HTMLElement;
    // Rebuilding the list would drop keyboard focus and scroll position; restore both afterwards.
    const focused = container.ownerDocument.activeElement as HTMLElement | null;
    const focusKey = focused && container.contains(focused) ? focused.getAttribute("data-tm-nav-key") : null;
    const scrollTop = container.scrollTop;
    this.rebuilding = true;
    container.empty();
    container.addClass("tm-navigation");
    container.classList.toggle("tm-density-compact", this.plugin.settings.density === "compact");
    const header = container.createDiv({ cls: "nav-header tm-nav-header" });
    const toolbar = header.createDiv({ cls: "nav-buttons-container", attr: { role: "toolbar", "aria-label": "Task actions" } });
    const buttons: HTMLButtonElement[] = [];
    const rove = (index: number): void => {
      this.toolbarFocus = index;
      buttons.forEach((button, position) => button.setAttribute("tabindex", position === index ? "0" : "-1"));
    };
    const action = (label: string, icon: string, run: () => void | Promise<void>): HTMLButtonElement => {
      const button = toolbar.createEl("button", { cls: "clickable-icon nav-action-button", attr: { "aria-label": label, title: label, "data-tm-nav-key": `action:${label}` } });
      setIcon(button, icon);
      const index = buttons.push(button) - 1;
      button.addEventListener("focus", () => rove(index));
      button.addEventListener("click", () => { void Promise.resolve().then(run).catch(error => new Notice(String(error))); });
      return button;
    };
    toolbar.addEventListener("keydown", event => {
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const last = buttons.length - 1;
      const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
      if (next === undefined) return;
      event.preventDefault();
      rove(next);
      buttons[next].focus();
    });
    action("New task", "circle-plus", () => this.plugin.newTask());
    action("New note", "square-pen", () => this.newNote());
    const toggle = action("Task mode", "list-checks", async () => {
      toggle.disabled = true;
      try { await this.plugin.setTaskMode(!this.plugin.settings.taskMode); }
      finally { this.render(); }
    });
    toggle.setAttribute("aria-pressed", String(this.plugin.settings.taskMode));
    toggle.setAttribute("title", `Task mode: ${this.plugin.settings.taskMode ? "On" : "Off"}`);
    toggle.classList.toggle("is-active", this.plugin.settings.taskMode);
    // Folders and their order belong to the file tree, so they show with it.
    if (this.plugin.settings.showFiles) {
      action("New folder", "folder-plus", () => this.newFolder(this.app.vault.getRoot()));
      const sort = action("Change sort order", "arrow-up-narrow-wide", () => this.openSortMenu(sort));
    }
    rove(Math.min(this.toolbarFocus, buttons.length - 1));

    const nav = container.createDiv({ cls: "nav-files-container tm-nav-list", attr: { "aria-label": "Task navigation" } });
    /** A row: an icon (its colour set by `color`), the name, and on the right an optional count. */
    const item = (parent: HTMLElement, key: string, label: string, active: boolean, open: (event: MouseEvent) => Promise<void>, icon?: string, color?: string, count?: number): HTMLElement => {
      const row = parent.createDiv({ cls: `tree-item-self nav-file-title tm-nav-item${active ? " is-active" : ""}${color ? ` is-${color}` : ""}` });
      if (icon) {
        const glyph = row.createDiv({ cls: "tm-nav-icon", attr: { "aria-hidden": "true" } });
        setIcon(glyph, icon);
      }
      const button = row.createEl("button", { cls: "tm-nav-label", text: label, attr: { "aria-current": active ? "page" : "false", title: label, "data-tm-nav-key": key } });
      button.addEventListener("click", event => { void open(event).catch(error => new Notice(String(error))); });
      if (count) row.createDiv({ cls: "tm-nav-count", text: String(count), attr: { "aria-label": `${count} open` } });
      return row;
    };
    const listActive = (mode: TaskViewMode): boolean => mode === this.activeMode && !this.activeTag && !this.activeProject && !this.activeSmartList;
    /** A chevron on `row` that folds `section` away; true while it is open. */
    const folder = (row: HTMLElement, section: NavSection, label: string): boolean => {
      const expanded = this.expanded.has(section);
      this.chevron(row, expanded, label, `collapse:${section}`, () => {
        if (expanded) this.expanded.delete(section); else this.expanded.add(section);
      });
      return expanded;
    };
    for (const group of NAV_GROUPS) {
      const lists = nav.createDiv({ cls: "tm-nav-group" });
      for (const entry of group) {
        const count = entry.count ? this.plugin.index.query({ mode: entry.mode, showCompleted: false }).length : undefined;
        const row = item(lists, `mode:${entry.mode}`, entry.label, listActive(entry.mode), () => this.plugin.openTaskView({ mode: entry.mode }),
          (this.plugin.settings.style === "griply" && entry.griplyIcon) || entry.icon, entry.color, count);
        if (entry.mode === "inbox" || entry.mode === "today") this.dropTarget(row, { kind: entry.mode });
        // Smart lists, being saved views of all tasks, sit under All Tasks.
        if (entry.mode !== "all" || !folder(row, "smartLists", "smart lists")) continue;
        const children = lists.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
        const smartLists = this.plugin.settings.smartLists;
        // Indented a step under All Tasks, as a subproject is under its parent.
        for (const list of smartLists) item(children, `list:${list.id}`, list.name, this.activeSmartList === list.id, () => this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }), "list-filter", "orange")
          .setCssProps({ "--tm-nav-depth": "1" });
        if (!smartLists.length) children.createDiv({ cls: "tm-nav-empty", text: "No smart lists yet" });
      }
    }

    for (const { section, label, icon, open } of NAV_SECTIONS) {
      const group = nav.createDiv({ cls: "tree-item nav-folder tm-nav-group tm-nav-section" });
      const heading = item(group, `mode:${open}`, label, listActive(open), () => this.plugin.openTaskView({ mode: open }), icon, "section");
      if (!folder(heading, section, label)) { group.addClass("is-folded"); continue; }
      const children = group.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
      if (section === "projects") {
        const projects = activeProjects(this.plugin.index.projects());
        // The open project's parents stay unfolded, so it shows.
        const byPath = new Map(projects.map(project => [project.path, project]));
        for (let path = byPath.get(this.activeProject ?? "")?.parentPath; path; path = byPath.get(path)?.parentPath) this.foldedProjects.delete(path);
        const tree = projectHierarchy(projects);
        // Subprojects sit under their parent, indented a step per level; a parent folds them away from its chevron.
        let hiddenBelow: number | undefined;
        tree.forEach(({ project, depth }, index) => {
          if (hiddenBelow !== undefined && depth > hiddenBelow) return;
          hiddenBelow = undefined;
          const row = item(children, `project:${project.path}`, project.name, this.activeProject === project.path, () => this.plugin.openProject(project.path));
          this.dropTarget(row, { kind: "project", path: project.path });
          row.style.setProperty("--tm-nav-depth", String(depth));
          // Its progress, as a pie in its colour, stands where a list's icon does.
          const icon = row.createDiv({ cls: "tm-nav-icon tm-nav-progress", attr: { "aria-hidden": "true" } });
          renderProjectProgress(icon, project, false);
          row.prepend(icon);
          if ((tree[index + 1]?.depth ?? 0) <= depth) return;
          const folded = this.foldedProjects.has(project.path);
          this.chevron(row, !folded, project.name, `collapse:project:${project.path}`, () => {
            if (folded) this.foldedProjects.delete(project.path); else this.foldedProjects.add(project.path);
          });
          if (folded) hiddenBelow = depth;
        });
        if (!projects.length) children.createDiv({ cls: "tm-nav-empty", text: "No projects yet" });
      } else {
        const tags = this.plugin.index.tagSummaries();
        for (const tag of tags) {
          const row = item(children, `tag:${tag.name}`, tag.name, this.activeTag === tag.name, () => this.plugin.openTag(tag.name), "hash", "muted", tag.openTasks);
          this.dropTarget(row, { kind: "tag", tag: tag.name });
        }
        if (!tags.length) children.createDiv({ cls: "tm-nav-empty", text: "No tags yet" });
      }
    }
    // The vault's files and folders, below everything else, as the file explorer lists them.
    if (this.plugin.settings.showFiles) {
      this.watchFiles();
      const group = nav.createDiv({ cls: "tree-item nav-folder tm-nav-group tm-nav-section tm-nav-files" });
      const root = this.app.vault.getRoot();
      const heading = item(group, "files", "Files", false, async () => {
        if (this.expanded.has("files")) this.expanded.delete("files"); else this.expanded.add("files");
        this.render();
      }, "folder-tree", "section");
      heading.querySelector(".tm-nav-label")?.setAttribute("aria-expanded", String(this.expanded.has("files")));
      heading.addEventListener("contextmenu", event => this.openFileMenu(event, root));
      this.fileDrop(heading, root);
      if (folder(heading, "files", "files")) {
        const children = group.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
        this.renderFolder(children, root, 0, item);
        if (!root.children.length) children.createDiv({ cls: "tm-nav-empty", text: "No files yet" });
      } else group.addClass("is-folded");
    }
    container.scrollTop = scrollTop;
    this.rebuilding = false;
    const rename = this.renaming ? container.querySelector<HTMLInputElement>("input.tm-nav-rename") : null;
    if (rename) {
      rename.focus({ preventScroll: true });
      if (!this.renaming?.selected) { rename.select(); if (this.renaming) this.renaming.selected = true; }
    } else if (focusKey) {
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-tm-nav-key]")).find(element => element.getAttribute("data-tm-nav-key") === focusKey);
      target?.focus({ preventScroll: true });
    }
  }

  /**
   * Lets tasks dragged in a task view drop on `row`. A list's drag follows the pointer and finds the row by its mark;
   * a calendar card drags natively, and the row takes that drop here.
   */
  private dropTarget(row: HTMLElement, drop: SidebarDrop): void {
    markDropTarget(row, drop);
    const dragging = (event: DragEvent): boolean => Boolean(activeTaskDrag() && event.dataTransfer?.types.includes(TASK_DRAG_TYPE));
    row.addEventListener("dragover", event => {
      if (!dragging(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      highlightDropTarget(row, true);
    });
    row.addEventListener("dragleave", event => { if (!row.contains(event.relatedTarget as Node | null)) highlightDropTarget(row, false); });
    row.addEventListener("drop", event => {
      highlightDropTarget(row, false);
      const drag = activeTaskDrag();
      if (!drag || !dragging(event)) return;
      event.preventDefault();
      void drag.drop(drop);
    });
  }

  /** A chevron at the end of `row` that folds what is under it; `toggle` flips it, and the list is redrawn. */
  private chevron(row: HTMLElement, open: boolean, label: string, key: string, toggle: () => void): void {
    const collapse = row.createEl("button", { cls: "clickable-icon tm-nav-collapse", attr: {
      "aria-label": `${open ? "Collapse" : "Expand"} ${label}`, "aria-expanded": String(open), "data-tm-nav-key": key
    } });
    setIcon(collapse, open ? "chevron-down" : "chevron-right");
    collapse.addEventListener("click", () => { toggle(); this.render(); });
  }

  /** Redraws the file tree as files come and go, and as another file opens. */
  private watchFiles(): void {
    if (this.fileEvents) return;
    this.fileEvents = true;
    const changed = (): void => { if (this.plugin.settings.showFiles) this.scheduleRender(); };
    this.registerEvent(this.app.vault.on("create", changed));
    this.registerEvent(this.app.vault.on("delete", changed));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      // An open folder stays open under its new name, as do the folders inside it.
      if (file instanceof TFolder) {
        for (const path of [...this.openFolders]) {
          if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
          this.openFolders.delete(path);
          this.openFolders.add(file.path + path.slice(oldPath.length));
        }
        this.app.workspace.requestSaveLayout();
      }
      changed();
    }));
    this.registerEvent(this.app.workspace.on("file-open", changed));
  }

  /** Lists `folder`'s children, folders first and each by name, and the children of those left open, a step further in. */
  private renderFolder(parent: HTMLElement, folder: TFolder, depth: number,
    item: (parent: HTMLElement, key: string, label: string, active: boolean, open: (event: MouseEvent) => Promise<void>, icon?: string, color?: string) => HTMLElement): void {
    const active = this.app.workspace.getActiveFile()?.path;
    const children = sortFiles(folder.children, this.plugin.settings.fileSortOrder);
    for (const child of children) {
      const isFolder = child instanceof TFolder;
      if (!isFolder && !(child instanceof TFile)) continue;
      const open = isFolder && this.openFolders.has(child.path);
      const toggle = (): void => {
        if (open) this.openFolders.delete(child.path); else this.openFolders.add(child.path);
        this.app.workspace.requestSaveLayout();
      };
      const row = isFolder
        ? item(parent, `folder:${child.path}`, child.name, false, async () => { toggle(); this.render(); }, open ? "folder-open" : "folder", "muted")
        : item(parent, `file:${child.path}`, child.basename, child.path === active, async event => {
          await this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(child);
        }, FILE_ICONS[child.extension.toLowerCase()] ?? "file", "muted");
      row.addClass(isFolder ? "tm-nav-folder" : "tm-nav-file");
      row.style.setProperty("--tm-nav-depth", String(depth));
      row.addEventListener("contextmenu", event => this.openFileMenu(event, child));
      this.fileDrag(row, child);
      if (child instanceof TFolder) this.fileDrop(row, child);
      else if (child.extension === "md") this.dropTarget(row, { kind: "note", path: child.path });
      if (isFolder) row.querySelector(".tm-nav-label")?.setAttribute("aria-expanded", String(open));
      // Notes show their name alone; other files add their kind, as the file explorer does.
      if (child instanceof TFile && child.extension !== "md") row.createDiv({ cls: "nav-file-tag tm-nav-file-tag", text: child.extension });
      if (this.renaming?.path === child.path) this.renameField(row, child);
      if (isFolder && child.children.length) this.chevron(row, open, child.name, `collapse:folder:${child.path}`, toggle);
      if (open) this.renderFolder(parent, child, depth + 1, item);
    }
  }

  /** The file explorer's menu for `file`: opening it, making notes and folders in a folder, renaming and deleting, and what
   * Obsidian and other plugins add to a file's menu. */
  private openFileMenu(event: MouseEvent, file: TAbstractFile): void {
    event.preventDefault();
    const menu = new Menu();
    const run = (action: () => unknown): void => { void Promise.resolve().then(action).catch(error => new Notice(String(error))); };
    if (file instanceof TFile) {
      menu.addItem(entry => entry.setSection("open").setTitle("Open in new tab").setIcon("file-plus").onClick(() => run(() => this.app.workspace.getLeaf("tab").openFile(file))));
      menu.addItem(entry => entry.setSection("open").setTitle("Open to the right").setIcon("separator-vertical").onClick(() => run(() => this.app.workspace.getLeaf("split").openFile(file))));
    } else if (file instanceof TFolder) {
      menu.addItem(entry => entry.setSection("action-primary").setTitle("New note").setIcon("square-pen").onClick(() => run(() => this.newNote(file))));
      menu.addItem(entry => entry.setSection("action-primary").setTitle("New folder").setIcon("folder-plus").onClick(() => run(() => this.newFolder(file))));
    }
    if (!(file instanceof TFolder && file.isRoot())) {
      menu.addItem(entry => entry.setSection("action").setTitle("Rename…").setIcon("pencil").onClick(() => {
        this.renaming = { path: file.path, value: file instanceof TFile ? file.basename : file.name, selected: false };
        this.render();
      }));
      menu.addItem(entry => entry.setSection("danger").setTitle("Delete").setIcon("trash-2").setWarning(true)
        .onClick(() => run(() => this.app.fileManager.promptForDeletion(file))));
    }
    this.app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu", this.leaf);
    menu.showAtMouseEvent(event);
  }

  /** Makes an untitled note, in `folder` or where Obsidian puts new notes, and opens it with its title ready to type. */
  private async newNote(folder?: TFolder): Promise<void> {
    const parent = folder ?? this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
    const note = await this.app.vault.create(this.availablePath(parent, "Untitled", ".md"), "");
    if (this.plugin.settings.showFiles) this.showFolder(parent);
    await this.app.workspace.getLeaf(false).openFile(note, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  }

  /** Makes an untitled folder in `folder` and names it in place. */
  private async newFolder(folder: TFolder): Promise<void> {
    const created = await this.app.vault.createFolder(this.availablePath(folder, "Untitled", ""));
    this.showFolder(folder);
    this.renaming = { path: created.path, value: created.name, selected: false };
    this.render();
  }

  /** The file tree's orders, as the file explorer offers them, the one in use checked. */
  private openSortMenu(button: HTMLElement): void {
    const menu = new Menu();
    for (const [order, title, section] of FILE_SORT_ORDERS) {
      menu.addItem(entry => entry.setSection(section).setTitle(title).setChecked(this.plugin.settings.fileSortOrder === order).onClick(async () => {
        this.plugin.settings.fileSortOrder = order;
        await this.plugin.saveSettings();
        this.render();
      }));
    }
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  private get dragManager(): DragManager | undefined {
    const manager = (this.app as unknown as { dragManager?: Partial<DragManager> }).dragManager;
    return manager && typeof manager.handleDrag === "function" && typeof manager.handleDrop === "function" ? manager as DragManager : undefined;
  }

  /** Lets `file` be dragged as the file explorer's files are: into a note as a link, onto a tab to open it, or into a folder. */
  private fileDrag(row: HTMLElement, file: TAbstractFile): void {
    const manager = this.dragManager;
    if (!manager || this.renaming?.path === file.path) return;
    manager.handleDrag(row, event => file instanceof TFile ? manager.dragFile(event, file, "tm-files")
      : file instanceof TFolder ? manager.dragFolder(event, file, "tm-files") : null);
  }

  /** Lets files and folders, from here or the file explorer, be dropped into `folder` to move them there. */
  private fileDrop(row: HTMLElement, folder: TFolder): void {
    this.dragManager?.handleDrop(row, (_event, draggable, hovering) => {
      const files = (draggable?.type === "files" ? draggable.files ?? [] : draggable?.type === "file" || draggable?.type === "folder" ? [draggable.file] : [])
        .filter((file): file is TAbstractFile => file instanceof TFile || file instanceof TFolder);
      const moving = files.filter(file => canMoveInto(file, folder));
      if (!moving.length) return files.length ? { action: "", dropEffect: "none" } : undefined;
      if (!hovering) void this.moveInto(moving, folder);
      return { action: `Move into ${folder.isRoot() ? "the vault" : folder.name}`, dropEffect: "move", hoverEl: row, hoverClass: "is-drop-target" };
    });
  }

  /** Moves files and folders into `folder`, keeping their names; a name already taken there stays put. */
  private async moveInto(files: TAbstractFile[], folder: TFolder): Promise<void> {
    for (const file of files) {
      const path = `${folder.isRoot() ? "" : `${folder.path}/`}${file.name}`;
      if (this.app.vault.getAbstractFileByPath(path)) { new Notice(`“${file.name}” already exists in ${folder.isRoot() ? "the vault" : folder.name}`); continue; }
      try { await this.app.fileManager.renameFile(file, path); }
      catch (error) { new Notice(String(error)); }
    }
    this.showFolder(folder);
    this.render();
  }

  /** Opens `folder` and the folders around it, so what was just made in it shows. */
  private showFolder(folder: TFolder | null): void {
    for (; folder && !folder.isRoot(); folder = folder.parent) this.openFolders.add(folder.path);
    this.expanded.add("files");
    this.app.workspace.requestSaveLayout();
  }

  /** `name` in `folder`, numbered as the file explorer numbers new files when the name is taken. */
  private availablePath(folder: TFolder, name: string, extension: string): string {
    const base = folder.isRoot() ? "" : `${folder.path}/`;
    for (let n = 0; ; n++) {
      const path = `${base}${name}${n ? ` ${n}` : ""}${extension}`;
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }

  /** Puts a field for the new name in place of `file`'s name: Enter or leaving it renames, Escape keeps the name. */
  private renameField(row: HTMLElement, file: TAbstractFile): void {
    const state = this.renaming;
    const label = row.querySelector(".tm-nav-label");
    if (!state || !label) return;
    const input = createEl("input", { cls: "tm-nav-rename", attr: { type: "text", "aria-label": `Rename ${file.name}`, spellcheck: "false" } });
    input.value = state.value;
    label.replaceWith(input);
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = undefined;
      const name = input.value.trim();
      const current = file instanceof TFile ? file.basename : file.name;
      if (save && name && name !== current) {
        const parent = file.parent;
        const path = `${parent && !parent.isRoot() ? `${parent.path}/` : ""}${name}${file instanceof TFile ? `.${file.extension}` : ""}`;
        if (/[\\/:]/.test(name)) new Notice("File names can't contain \\, / or :");
        else if (this.app.vault.getAbstractFileByPath(path)) new Notice(`“${name}” already exists`);
        else void this.app.fileManager.renameFile(file, path).catch(error => new Notice(String(error)));
      }
      this.render();
    };
    input.addEventListener("input", () => { state.value = input.value; });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => { if (!this.rebuilding) finish(true); });
  }
}
