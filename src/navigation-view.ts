import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { TaskViewMode } from "./types";
import { renderProjectProgress } from "./project-progress";
import { projectHierarchy } from "./project-hierarchy";

export const TASK_NAV_VIEW = "task-manager-navigation";

/** A list in the sidebar, as Things shows its lists: a coloured icon, the name, and (for some) how many tasks are open. */
interface NavEntry { mode: TaskViewMode; label: string; icon: string; color: string; count?: boolean }

/** The lists, in groups set apart as Things sets its lists apart. */
const NAV_GROUPS: NavEntry[][] = [
  [{ mode: "inbox", label: "Inbox", icon: "inbox", color: "blue", count: true }],
  [
    { mode: "today", label: "Today", icon: "star", color: "yellow", count: true },
    { mode: "upcoming", label: "Upcoming", icon: "calendar-days", color: "red" },
    { mode: "all", label: "All Tasks", icon: "layers", color: "cyan" }
  ],
  [
    { mode: "review", label: "Weekly Review", icon: "notebook-pen", color: "green" },
    { mode: "dashboard", label: "Dashboard", icon: "layout-dashboard", color: "purple" }
  ]
];

/** What folds away from a chevron: smart lists under All Tasks, and the sections below the lists (each a heading over
 * its items). */
type NavSection = "smartLists" | "projects" | "tags";
const NAV_SECTIONS: Array<{ section: NavSection; label: string; icon: string; open: TaskViewMode }> = [
  { section: "projects", label: "Projects", icon: "square-chart-gantt", open: "projects" },
  { section: "tags", label: "Tags", icon: "tag", open: "tags" }
];
const NAV_MODES = new Set<TaskViewMode>([...NAV_GROUPS.flat().map(entry => entry.mode), "projects", "tags"]);

export class TaskNavigationView extends ItemView {
  private activeMode: TaskViewMode = "today";
  private activeTag?: string;
  private activeSmartList?: string;
  private activeProject?: string;
  /** Sections shown open; Things lists its projects, so smart lists and projects start open. */
  private expanded = new Set<NavSection>(["smartLists", "projects"]);
  /** Parent projects whose subprojects are folded away. */
  private foldedProjects = new Set<string>();
  private unsubscribe?: () => void;
  private frame?: number;
  // The toolbar is one tab stop; arrow keys move between its buttons.
  private toolbarFocus = 0;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) { super(leaf); }
  getViewType(): string { return TASK_NAV_VIEW; }
  getDisplayText(): string { return "Tasks"; }
  getIcon(): string { return "circle-check-big"; }
  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.index.subscribe(() => this.scheduleRender());
    const syncActive = (): void => {
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
      this.render();
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
    action("Create task", "square-pen", () => this.plugin.newTask());
    action("Create project", "target", () => this.plugin.openProjectCreator());
    const toggle = action("Task mode", "list-checks", async () => {
      toggle.disabled = true;
      try { await this.plugin.setTaskMode(!this.plugin.settings.taskMode); }
      finally { this.render(); }
    });
    toggle.setAttribute("aria-pressed", String(this.plugin.settings.taskMode));
    toggle.setAttribute("title", `Task mode: ${this.plugin.settings.taskMode ? "On" : "Off"}`);
    toggle.classList.toggle("is-active", this.plugin.settings.taskMode);
    rove(Math.min(this.toolbarFocus, buttons.length - 1));

    const nav = container.createDiv({ cls: "nav-files-container tm-nav-list", attr: { "aria-label": "Task navigation" } });
    /** A row: an icon (its colour set by `color`), the name, and on the right an optional count. */
    const item = (parent: HTMLElement, key: string, label: string, active: boolean, open: () => Promise<void>, icon?: string, color?: string, count?: number): HTMLElement => {
      const row = parent.createDiv({ cls: `tree-item-self nav-file-title tm-nav-item${active ? " is-active" : ""}${color ? ` is-${color}` : ""}` });
      if (icon) {
        const glyph = row.createDiv({ cls: "tm-nav-icon", attr: { "aria-hidden": "true" } });
        setIcon(glyph, icon);
      }
      const button = row.createEl("button", { cls: "tm-nav-label", text: label, attr: { "aria-current": active ? "page" : "false", title: label, "data-tm-nav-key": key } });
      button.addEventListener("click", () => { void open().catch(error => new Notice(String(error))); });
      if (count) row.createDiv({ cls: "tm-nav-count", text: String(count), attr: { "aria-label": `${count} open` } });
      return row;
    };
    const listActive = (mode: TaskViewMode): boolean => mode === this.activeMode && !this.activeTag && !this.activeProject && !this.activeSmartList;
    /** A chevron on `row` that folds `section` away; true while it is open. */
    const folder = (row: HTMLElement, section: NavSection, label: string): boolean => {
      const expanded = this.expanded.has(section);
      const collapse = row.createEl("button", { cls: "clickable-icon tm-nav-collapse", attr: {
        "aria-label": `${expanded ? "Collapse" : "Expand"} ${label}`, "aria-expanded": String(expanded), "data-tm-nav-key": `collapse:${section}`
      } });
      setIcon(collapse, expanded ? "chevron-down" : "chevron-right");
      collapse.addEventListener("click", () => {
        if (expanded) this.expanded.delete(section); else this.expanded.add(section);
        this.render();
      });
      return expanded;
    };
    for (const group of NAV_GROUPS) {
      const lists = nav.createDiv({ cls: "tm-nav-group" });
      for (const entry of group) {
        const count = entry.count ? this.plugin.index.query({ mode: entry.mode, showCompleted: false }).length : undefined;
        const row = item(lists, `mode:${entry.mode}`, entry.label, listActive(entry.mode), () => this.plugin.openTaskView({ mode: entry.mode }), entry.icon, entry.color, count);
        // Smart lists, being saved views of all tasks, sit under All Tasks.
        if (entry.mode !== "all" || !folder(row, "smartLists", "smart lists")) continue;
        const children = lists.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
        const smartLists = this.plugin.settings.smartLists;
        for (const list of smartLists) item(children, `list:${list.id}`, list.name, this.activeSmartList === list.id, () => this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }), "list-filter", "orange");
        if (!smartLists.length) children.createDiv({ cls: "tm-nav-empty", text: "No smart lists yet" });
      }
    }

    for (const { section, label, icon, open } of NAV_SECTIONS) {
      const group = nav.createDiv({ cls: "tree-item nav-folder tm-nav-group tm-nav-section" });
      const heading = item(group, `mode:${open}`, label, listActive(open), () => this.plugin.openTaskView({ mode: open }), icon, "section");
      if (!folder(heading, section, label)) continue;
      const children = group.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
      if (section === "projects") {
        const projects = this.plugin.index.projects().filter(project => !project.archived);
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
          row.style.setProperty("--tm-nav-depth", String(depth));
          // Its progress, as a pie in its colour, stands where a list's icon does.
          const icon = row.createDiv({ cls: "tm-nav-icon tm-nav-progress", attr: { "aria-hidden": "true" } });
          renderProjectProgress(icon, project, false);
          row.prepend(icon);
          if ((tree[index + 1]?.depth ?? 0) <= depth) return;
          const folded = this.foldedProjects.has(project.path);
          const collapse = row.createEl("button", { cls: "clickable-icon tm-nav-collapse", attr: {
            "aria-label": `${folded ? "Expand" : "Collapse"} ${project.name}`, "aria-expanded": String(!folded), "data-tm-nav-key": `collapse:project:${project.path}`
          } });
          setIcon(collapse, folded ? "chevron-right" : "chevron-down");
          collapse.addEventListener("click", () => {
            if (folded) this.foldedProjects.delete(project.path); else this.foldedProjects.add(project.path);
            this.render();
          });
          if (folded) hiddenBelow = depth;
        });
        if (!projects.length) children.createDiv({ cls: "tm-nav-empty", text: "No projects yet" });
      } else {
        const tags = this.plugin.index.tagSummaries();
        for (const tag of tags) item(children, `tag:${tag.name}`, tag.name, this.activeTag === tag.name, () => this.plugin.openTag(tag.name), "hash", "muted", tag.openTasks);
        if (!tags.length) children.createDiv({ cls: "tm-nav-empty", text: "No tags yet" });
      }
    }
    container.scrollTop = scrollTop;
    if (focusKey) {
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-tm-nav-key]")).find(element => element.getAttribute("data-tm-nav-key") === focusKey);
      target?.focus({ preventScroll: true });
    }
  }
}
