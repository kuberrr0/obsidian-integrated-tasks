import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { TaskViewMode } from "./types";

export const TASK_NAV_VIEW = "task-manager-navigation";
const NAV_ITEMS: Array<{ mode: TaskViewMode; label: string }> = [
  { mode: "dashboard", label: "Dashboard" },
  { mode: "inbox", label: "Inbox" }, { mode: "today", label: "Today" },
  { mode: "upcoming", label: "Upcoming" }, { mode: "all", label: "All Tasks" },
  { mode: "projects", label: "Projects" }, { mode: "tags", label: "Tags" }
];

export class TaskNavigationView extends ItemView {
  private activeMode: TaskViewMode = "today";
  private activeTag?: string;
  private activeSmartList?: string;
  private activeProject?: string;
  private expanded = new Set<TaskViewMode>();
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
      const mode = NAV_ITEMS.find(item => item.mode === state.mode)?.mode;
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
    if (tag || project || smartListId) this.expanded.add(mode === "smartLists" ? "all" : mode);
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
    action("Create task", "square-pen", () => this.plugin.openEditor({ mode: this.activeMode, tag: this.activeTag }));
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
    const item = (parent: HTMLElement, key: string, label: string, active: boolean, open: () => Promise<void>): HTMLElement => {
      const row = parent.createDiv({ cls: `tree-item-self nav-file-title tm-nav-item${active ? " is-active" : ""}` });
      const button = row.createEl("button", { cls: "tm-nav-label", text: label, attr: { "aria-current": active ? "page" : "false", title: label, "data-tm-nav-key": key } });
      button.addEventListener("click", () => { void open().catch(error => new Notice(String(error))); });
      return row;
    };
    for (const entry of NAV_ITEMS) {
      const branch = entry.mode === "projects" || entry.mode === "tags" || entry.mode === "all";
      const group = nav.createDiv({ cls: branch ? "tree-item nav-folder" : "tree-item nav-file" });
      const row = item(group, `mode:${entry.mode}`, entry.label, entry.mode === this.activeMode && !this.activeTag && !this.activeProject && !this.activeSmartList,
        () => this.plugin.openTaskView({ mode: entry.mode }));
      if (!branch) continue;
      const expanded = this.expanded.has(entry.mode);
      const collapse = row.createEl("button", { cls: "clickable-icon tm-nav-collapse", attr: {
        "aria-label": `${expanded ? "Collapse" : "Expand"} ${entry.label}`, "aria-expanded": String(expanded), "data-tm-nav-key": `collapse:${entry.mode}`
      } });
      setIcon(collapse, expanded ? "chevron-down" : "chevron-right");
      row.prepend(collapse);
      collapse.addEventListener("click", () => {
        if (expanded) this.expanded.delete(entry.mode); else this.expanded.add(entry.mode);
        this.render();
      });
      if (!expanded) continue;
      const children = group.createDiv({ cls: "tree-item-children nav-folder-children tm-nav-children" });
      if (entry.mode === "projects") {
        const projects = this.plugin.index.projects().filter(project => !project.archived);
        for (const project of projects) item(children, `project:${project.path}`, project.name, this.activeProject === project.path, () => this.plugin.openProject(project.path));
        if (!projects.length) children.createDiv({ cls: "tm-nav-empty", text: "No projects yet" });
      } else if (entry.mode === "all") {
        const lists = this.plugin.settings.smartLists;
        for (const list of lists) item(children, `list:${list.id}`, list.name, this.activeSmartList === list.id, () => this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }));
        if (!lists.length) children.createDiv({ cls: "tm-nav-empty", text: "No smart lists yet" });
      } else {
        const tags = this.plugin.index.tagSummaries();
        for (const tag of tags) item(children, `tag:${tag.name}`, tag.name, this.activeTag === tag.name, () => this.plugin.openTag(tag.name));
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
