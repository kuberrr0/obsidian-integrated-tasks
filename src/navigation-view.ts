import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { TaskViewMode } from "./types";
import { taskTagSummaries } from "./task-tags";

export const TASK_NAV_VIEW = "task-manager-navigation";
const NAV_ITEMS: Array<{ mode: TaskViewMode; label: string }> = [
  { mode: "inbox", label: "Inbox" }, { mode: "today", label: "Today" },
  { mode: "upcoming", label: "Upcoming" }, { mode: "all", label: "All Tasks" },
  { mode: "projects", label: "Projects" }, { mode: "tags", label: "Tags" },
  { mode: "smartLists", label: "Smart Lists" }
];

export class TaskNavigationView extends ItemView {
  private activeMode: TaskViewMode = "today";
  private activeTag?: string;
  private activeSmartList?: string;
  private activeProject?: string;
  private expanded = new Set<TaskViewMode>();
  private unsubscribe?: () => void;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) { super(leaf); }
  getViewType(): string { return TASK_NAV_VIEW; }
  getDisplayText(): string { return "Tasks"; }
  getIcon(): string { return "circle-check-big"; }
  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.index.subscribe(() => this.render());
    const syncActive = (): void => {
      const view = this.app.workspace.getActiveViewOfType(ItemView);
      if (view?.getViewType() !== "task-manager-main") return;
      const state = view.getState();
      const mode = NAV_ITEMS.find(item => item.mode === state.mode)?.mode;
      if (mode === "smartLists") { this.setActive(mode, undefined, undefined, typeof state.smartListId === "string" ? state.smartListId : undefined); return; }
      if (mode) this.setActive(mode, typeof state.tag === "string" ? state.tag : undefined,
        mode === "tags" ? undefined : typeof state.pagePath === "string" ? state.pagePath : typeof state.projectPath === "string" ? state.projectPath : undefined);
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncActive));
    syncActive();
    this.render();
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); }
  setActive(mode: TaskViewMode, tag?: string, project?: string, smartListId?: string): void {
    this.activeSmartList = smartListId;
    this.activeMode = mode; this.activeTag = tag; this.activeProject = project;
    if (tag || project || smartListId) this.expanded.add(mode);
    this.render();
  }
  refresh(): void { this.render(); }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tm-navigation");
    const header = container.createDiv({ cls: "nav-header tm-nav-header" });
    const toolbar = header.createDiv({ cls: "nav-buttons-container", attr: { role: "toolbar", "aria-label": "Task actions" } });
    const action = (label: string, icon: string, run: () => void | Promise<void>): HTMLButtonElement => {
      const button = toolbar.createEl("button", { cls: "clickable-icon nav-action-button", attr: { "aria-label": label, title: label } });
      setIcon(button, icon);
      button.addEventListener("click", () => { void Promise.resolve().then(run).catch(error => new Notice(String(error))); });
      return button;
    };
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

    const nav = container.createDiv({ cls: "nav-files-container tm-nav-list", attr: { "aria-label": "Task navigation" } });
    const item = (parent: HTMLElement, label: string, active: boolean, open: () => Promise<void>): HTMLElement => {
      const row = parent.createDiv({ cls: `tree-item-self nav-file-title tm-nav-item${active ? " is-active" : ""}` });
      const button = row.createEl("button", { cls: "tm-nav-label", text: label, attr: { "aria-current": active ? "page" : "false", title: label } });
      button.addEventListener("click", () => { void open().catch(error => new Notice(String(error))); });
      return row;
    };
    for (const entry of NAV_ITEMS) {
      const branch = entry.mode === "projects" || entry.mode === "tags" || entry.mode === "smartLists";
      const group = nav.createDiv({ cls: branch ? "tree-item nav-folder" : "tree-item nav-file" });
      const row = item(group, entry.label, entry.mode === this.activeMode && !this.activeTag && !this.activeProject && !this.activeSmartList,
        () => this.plugin.openTaskView({ mode: entry.mode }));
      if (!branch) continue;
      const expanded = this.expanded.has(entry.mode);
      const collapse = row.createEl("button", { cls: "clickable-icon tm-nav-collapse", attr: {
        "aria-label": `${expanded ? "Collapse" : "Expand"} ${entry.label}`, "aria-expanded": String(expanded)
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
        for (const project of projects) item(children, project.name, this.activeProject === project.path, () => this.plugin.openProject(project.path));
        if (!projects.length) children.createDiv({ cls: "tm-nav-empty", text: "No projects yet" });
      } else if (entry.mode === "smartLists") {
        const lists = this.plugin.settings.smartLists;
        for (const list of lists) item(children, list.name, this.activeSmartList === list.id, () => this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }));
        if (!lists.length) children.createDiv({ cls: "tm-nav-empty", text: "No smart lists yet" });
      } else {
        const tags = taskTagSummaries(this.plugin.index.allTasks());
        for (const tag of tags) item(children, tag.name, this.activeTag === tag.name, () => this.plugin.openTag(tag.name));
        if (!tags.length) children.createDiv({ cls: "tm-nav-empty", text: "No tags yet" });
      }
    }
  }
}
