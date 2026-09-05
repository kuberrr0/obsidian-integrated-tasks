import { TASK_PROPERTIES, filterOperators, propertyValue, propertyLabel } from "./task-properties";
import { ItemView, Menu, Notice, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { actionDate, formatDate, todayIso } from "./date";
import { formatDuration } from "./parser";
import { groupTasks, orderTaskTree, sortTasks } from "./query";
import type TaskManagerPlugin from "./main";
import type { TaskFilter, FilterOperator, Project, ProjectProperties, Task, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

const TITLES: Record<TaskViewMode, string> = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  all: "All Tasks",
  projects: "Projects"
};

export class TaskMainView extends ItemView {
  private state: TaskViewState = { mode: "today" };
  private showCompleted = false;
  private showArchivedProjects = false;
  private search = "";
  private propertyFilters: TaskFilter[] = [];
  private sort: TaskSort = "date";
  private descending = false;
  private grouping: TaskGrouping = "default";
  private filtersExpanded = false;
  private unsubscribe?: () => void;
  private taskResults?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
  }

  get pagePath(): string | undefined { return this.state.pagePath ?? this.state.projectPath; }

  getViewType(): string { return TASK_MAIN_VIEW; }
  getDisplayText(): string {
    if (this.pagePath) return this.pagePath.replace(/\.md$/i, "").split("/").pop() ?? "Project";
    return TITLES[this.state.mode];
  }
  getIcon(): string { return this.state.mode === "projects" ? "folder-kanban" : "circle-check-big"; }
  getState(): Record<string, unknown> { return { ...this.state }; }

  async setState(state: Record<string, unknown>): Promise<void> {
    const mode = state.mode;
    if (this.state.mode !== mode || this.state.projectPath !== state.projectPath || this.state.pagePath !== state.pagePath) {
      this.search = "";
      this.propertyFilters = [];
      this.sort = "date";
      this.descending = false;
      this.grouping = "default";
      this.filtersExpanded = false;
    }
    if (typeof mode === "string" && mode in TITLES) this.state.mode = mode as TaskViewMode;
    this.state.pagePath = typeof state.pagePath === "string" ? state.pagePath : undefined;
    this.state.markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState as Record<string, unknown> : undefined;
    this.state.projectPath = typeof state.projectPath === "string" ? state.projectPath : undefined;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.index.subscribe(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.taskResults = undefined;
    container.addClass("tm-main-view");
    if (this.state.mode === "projects" && !this.pagePath) {
      this.renderProjectList(container);
      return;
    }

    this.renderHeader(container);
    this.renderFilters(container);
    this.taskResults = container.createDiv({ cls: "tm-task-results" });
    this.renderTaskResults();
  }

  private renderTaskResults(): void {
    const container = this.taskResults;
    if (!container) return;
    container.empty();
    const query: TaskQuery = {
      mode: this.pagePath ? "project" : this.state.mode,
      showCompleted: this.showCompleted,
      projectPath: this.pagePath,
      filters: this.propertyFilters,
      search: this.search || undefined
    };
    const tasks = sortTasks(this.plugin.index.query(query), this.sort, this.descending);
    if (!tasks.length) {
      if (this.pagePath && this.grouping === "default" && !this.search && !this.propertyFilters.length) {
        this.renderProjectSections(container, this.pagePath, tasks);
      } else this.renderEmpty(container);
      return;
    }
    if (this.grouping === "none") {
      this.renderTaskList(container, tasks);
      return;
    }
    if (this.grouping !== "default") {
      for (const [key, group] of groupTasks(tasks, this.grouping)) {
        const title = this.grouping === "date" && key !== "No date" ? formatDate(key, this.plugin.dateFormat())
          : this.grouping === "source" ? key.replace(/\.md$/i, "") : key;
        this.renderSection(container, title, group);
      }
      return;
    }
    if (this.pagePath) {
      this.renderProjectSections(container, this.pagePath, tasks);
      return;
    }
    if (this.state.mode === "today") {
      const today = todayIso();
      this.renderSection(container, "Overdue", tasks.filter((task) => (actionDate(task) ?? today) < today), "alert");
      this.renderSection(container, "Today", tasks.filter((task) => actionDate(task) === today));
    } else if (this.state.mode === "upcoming") {
      for (const [date, group] of groupTasks(tasks, "date")) this.renderSection(container, formatDate(date, this.plugin.dateFormat()), group);
    } else if (this.state.mode === "all") {
      const groups = new Map<string, Task[]>();
      for (const task of tasks) groups.set(task.path, [...(groups.get(task.path) ?? []), task]);
      for (const [path, group] of groups) {
        if (this.plugin.index.isProject(path)) {
          const project = container.createEl("section", { cls: "tm-section" });
          project.createEl("h2", { text: path.replace(/\.md$/i, "") });
          this.renderProjectSections(project, path, group);
        } else this.renderSection(container, path.replace(/\.md$/i, ""), group);
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }

  private renderProjectSections(container: HTMLElement, path: string, tasks: Task[]): void {
    this.renderTaskList(container, tasks.filter((task) => task.sectionLine === undefined));
    for (const heading of this.plugin.index.headingsForPath(path)) {
      const group = tasks.filter((task) => task.sectionLine === heading.line);
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      title.createSpan({ cls: "tm-section-count", text: String(group.length) });
      this.renderTaskList(section, group);
    }
    if (!tasks.length && !this.plugin.index.headingsForPath(path).length) this.renderEmpty(container);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-view-header" });
    const titleGroup = header.createDiv({ cls: "tm-title-group" });
    if (this.state.projectPath && !this.state.pagePath) {
      const back = titleGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Back to projects" } });
      setIcon(back, "arrow-left");
      back.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects" }));
    }
    const heading = titleGroup.createDiv();
    heading.createEl("h1", { text: this.getDisplayText() });

    const actions = header.createDiv({ cls: "tm-header-actions" });
    const add = actions.createEl("button", { cls: "mod-cta tm-add-task" });
    const icon = add.createSpan();
    setIcon(icon, "plus");
    add.createSpan({ text: "Add task" });
    add.addEventListener("click", () => this.plugin.openEditor(this.state));
  }

  private renderFilters(container: HTMLElement): void {
    const filters = container.createDiv({ cls: "tm-filters" });
    const search = filters.createEl("input", { type: "search", attr: { placeholder: "Search tasks…", "aria-label": "Search tasks" } });
    search.value = this.search;
    search.addEventListener("input", () => {
      this.search = search.value;
      this.renderTaskResults();
    });
    const toggle = filters.createEl("button", { cls: "tm-filter-toggle" });
    const menu = filters.createDiv({ cls: "tm-property-menu" });
    const sync = (): void => {
      toggle.setText(`Filter${this.propertyFilters.length ? ` (${this.propertyFilters.length})` : ""}`);
      toggle.setAttribute("aria-expanded", String(this.filtersExpanded));
      menu.hidden = !this.filtersExpanded;
    };
    toggle.addEventListener("click", () => { this.filtersExpanded = !this.filtersExpanded; sync(); });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { this.filtersExpanded = false; sync(); toggle.focus(); }
    });
    sync();
    menu.createDiv({ text: "Match all property filters", cls: "tm-filter-hint" });
    const clear = menu.createEl("button", { text: "Clear all filters" });
    clear.addEventListener("click", () => { this.propertyFilters = []; this.render(); });
    for (const property of TASK_PROPERTIES) {
      const active = this.propertyFilters.find(filter => filter.property === property.key);
      const submenu = menu.createDiv({ cls: "tm-property-submenu" });
      const summary = submenu.createSpan({ cls: "tm-property-name", text: `${property.label}${active ? " •" : ""}` });
      const panel = submenu.createDiv({ cls: "tm-property-conditions" });
      const operator = panel.createEl("select", { attr: { "aria-label": `${property.label} condition` } });
      operator.createEl("option", { value: "", text: "Any value" });
      for (const [value, label] of filterOperators(property.kind)) operator.createEl("option", { value, text: label });
      operator.value = active?.operator ?? "";
      const inputs = panel.createDiv({ cls: "tm-filter-values" });
      let values = [...(active?.values ?? [])];
      const apply = (): void => {
        const op = operator.value as FilterOperator;
        const needsValue = op && op !== "has" && op !== "missing";
        const valid = !needsValue || (values.length > 0 && values[0] !== "" && (op !== "between" || Boolean(values[1])));
        this.propertyFilters = this.propertyFilters.filter(filter => filter.property !== property.key);
        if (op && valid) this.propertyFilters.push({ property: property.key, operator: op, values: [...values] });
        summary.setText(`${property.label}${op && valid ? " •" : ""}`);
        sync();
        this.renderTaskResults();
      };
      const renderValues = (): void => {
        inputs.empty();
        if (!operator.value || ["has", "missing"].includes(operator.value)) return;
        if (property.kind === "choice") {
          const choices = property.key === "priority" ? ["1", "2", "3"] : property.key === "status" ? ["Open", "Completed"]
            : [...new Set(this.plugin.index.allTasks().map(task => propertyValue(task, property.key)).filter(value => value !== undefined && value !== "").map(String))].sort();
          for (const value of choices) {
            const label = inputs.createEl("label");
            const check = label.createEl("input", { type: "checkbox" });
            check.checked = values.includes(value);
            label.createSpan({ text: propertyLabel(property.key, value) });
            check.addEventListener("change", () => { values = check.checked ? [...values, value] : values.filter(item => item !== value); apply(); });
          }
        } else {
          for (let i = 0; i < (operator.value === "between" ? 2 : 1); i++) {
            const input = inputs.createEl("input", { type: property.kind === "number" ? "number" : property.kind, attr: {
              "aria-label": `${property.label} ${i ? "upper bound" : "value"}`,
              ...(property.kind === "number" ? { min: "0", step: "1", placeholder: "Minutes" } : {})
            } });
            input.value = values[i] ?? "";
            input.addEventListener("input", () => { if (!input.validity.valid) return; values[i] = input.value; apply(); });
          }
          if (property.kind === "number") inputs.createSpan({ text: "Duration in minutes", cls: "tm-filter-hint" });
        }
      };
      operator.addEventListener("change", () => { values = []; renderValues(); apply(); });
      renderValues();
    }
    const ordering = filters.createDiv({ cls: "tm-order-controls" });
    const iconButton = (icon: string, label: string): HTMLButtonElement => {
      const button = ordering.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
      setIcon(button, icon);
      return button;
    };
    const sort = iconButton("list-filter", `Sort: ${this.sort}`);
    sort.addEventListener("click", event => {
      const options = new Menu();
      for (const property of [{ key: "date", label: "Action date" }, ...TASK_PROPERTIES]) {
        options.addItem(item => item.setTitle(property.label).setChecked(this.sort === property.key).onClick(() => {
          this.sort = property.key as TaskSort;
          sort.setAttribute("aria-label", `Sort: ${property.label}`);
          sort.setAttribute("title", `Sort: ${property.label}`);
          this.renderTaskResults();
        }));
      }
      options.showAtMouseEvent(event);
    });
    const direction = iconButton(this.descending ? "arrow-down" : "arrow-up", this.descending ? "Descending" : "Ascending");
    direction.addEventListener("click", () => {
      this.descending = !this.descending;
      setIcon(direction, this.descending ? "arrow-down" : "arrow-up");
      direction.setAttribute("aria-label", this.descending ? "Descending" : "Ascending");
      direction.setAttribute("title", this.descending ? "Descending" : "Ascending");
      this.renderTaskResults();
    });
    const grouping = iconButton("group", `Group: ${this.grouping}`);
    grouping.addEventListener("click", event => {
      const options = new Menu();
      for (const property of [{ key: "default", label: "View default" }, { key: "none", label: "None" }, { key: "date", label: "Action date" }, ...TASK_PROPERTIES]) {
        options.addItem(item => item.setTitle(property.label).setChecked(this.grouping === property.key).onClick(() => {
          this.grouping = property.key as TaskGrouping;
          grouping.setAttribute("aria-label", `Group: ${property.label}`);
          grouping.setAttribute("title", `Group: ${property.label}`);
          this.renderTaskResults();
        }));
      }
      options.showAtMouseEvent(event);
    });
  }

  private renderProjectList(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-view-header" });
    const title = header.createDiv({ cls: "tm-title-group" }).createDiv();
    title.createEl("h1", { text: "Projects" });
    const actions = header.createDiv({ cls: "tm-header-actions" });
    const toggle = actions.createEl("label", { cls: "tm-completed-toggle" });
    const checkbox = toggle.createEl("input", { type: "checkbox" });
    checkbox.checked = this.showArchivedProjects;
    toggle.createSpan({ text: "Show archived projects" });
    checkbox.addEventListener("change", () => {
      this.showArchivedProjects = checkbox.checked;
      this.render();
    });
    const projects = this.plugin.index.projects();
    const active = projects.filter((project) => !project.archived);
    const archived = projects.filter((project) => project.archived);
    if (!active.length && (!this.showArchivedProjects || !archived.length)) {
      const empty = container.createDiv({ cls: "tm-empty" });
      const icon = empty.createDiv({ cls: "tm-empty-icon" });
      setIcon(icon, "folder-kanban");
      empty.createEl("h3", { text: archived.length ? "No active projects" : "No projects yet" });
      empty.createEl("p", { text: archived.length
        ? "Enable Show archived projects to see your archived projects."
        : "Add #project to a note or include project in its frontmatter tags." });
      return;
    }
    this.renderProjectGroup(container, "Active", active);
    if (this.showArchivedProjects) this.renderProjectGroup(container, "Archived", archived);
  }

  private renderProjectGroup(container: HTMLElement, title: string, projects: Project[]): void {
    if (!projects.length) return;
    const section = container.createEl("section", { cls: "tm-section" });
    const heading = section.createEl("h2", { text: title });
    heading.createSpan({ cls: "tm-section-count", text: String(projects.length) });
    const list = section.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    for (const project of projects) {
      const row = list.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
      const icon = row.createSpan({ cls: "tm-project-icon" });
      setIcon(icon, project.archived ? "archive" : "folder");
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      const button = primary.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path } });
      button.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects", projectPath: project.path }));
      const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata" });
      this.renderProperties(metadata, project);
      if (!metadata.childElementCount) metadata.remove();
      const total = project.openTasks + project.completedTasks;
      const percentage = total ? Math.round(project.completedTasks / total * 100) : 0;
      const progress = content.createDiv({ cls: "tm-project-progress", attr: {
        role: "progressbar",
        "aria-label": `${project.name}: ${project.completedTasks} of ${total} tasks completed`,
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percentage),
        title: `${project.completedTasks} of ${total} tasks completed`
      } });
      const track = progress.createSpan({ cls: "tm-project-progress-track" });
      track.createSpan({ cls: "tm-project-progress-fill" }).style.width = `${percentage}%`;
      progress.createSpan({ cls: "tm-project-percentage", text: `${percentage}%` });
      const open = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": `Open ${project.name}` } });
      setIcon(open, "chevron-right");
      open.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects", projectPath: project.path }));
    }
  }

  private renderSection(container: HTMLElement, title: string, tasks: Task[], variant?: "alert"): void {
    if (!tasks.length) return;
    const section = container.createEl("section", { cls: `tm-section${variant ? ` is-${variant}` : ""}` });
    const heading = section.createEl("h2");
    heading.createSpan({ text: title });
    heading.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
    this.renderTaskList(section, tasks);
  }

  private renderTaskList(container: HTMLElement, tasks: Task[]): void {
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    const visibleIds = new Set(tasks.map((task) => task.id));
    for (const task of orderTaskTree(tasks)) {
      const relativeDepth = this.depthWithin(task, visibleIds);
      this.renderTaskRow(list, task, relativeDepth);
    }
  }

  private depthWithin(task: Task, visibleIds: Set<string>): number {
    let depth = 0;
    let parentId = task.parentId;
    while (parentId && visibleIds.has(parentId)) {
      depth += 1;
      parentId = this.plugin.index.taskById(parentId)?.parentId;
    }
    return depth;
  }

  private renderTaskRow(list: HTMLElement, task: Task, depth: number): void {
    const row = list.createDiv({ cls: `tm-task-row${task.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    const checkboxTarget = row.createEl("label", { cls: "tm-checkbox-target" });
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: "tm-task-checkbox", attr: { "aria-label": `Complete ${task.title}` } });
    checkbox.checked = task.completed;
    const toggleTask = async (): Promise<void> => {
      checkbox.disabled = true;
      try {
        await this.plugin.store.toggle(task, checkbox.checked);
      } catch (cause) {
        checkbox.checked = !checkbox.checked;
        checkbox.disabled = false;
        new Notice(cause instanceof Error ? cause.message : "Could not update the task.");
      }
    };
    checkbox.addEventListener("change", () => { void toggleTask(); });
    const content = row.createDiv({ cls: "tm-task-content" });
    const primary = content.createDiv({ cls: "tm-task-primary" });
    const title = primary.createEl("button", { cls: "tm-task-title", text: task.title });
    title.addEventListener("click", () => this.plugin.openEditor({ ...this.state, task }));
    if (task.childIds.length) {
      const children = task.childIds.map((id) => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child));
      primary.createSpan({ cls: "tm-progress", text: `${children.filter((child) => child.completed).length}/${children.length}` });
    }
    const metadata = content.createDiv({ cls: "tm-task-metadata" });
    const source = metadata.createEl("button", { cls: "tm-source", text: task.path.replace(/\.md$/i, "") });
    source.addEventListener("click", () => void this.openSource(task));
    this.renderProperties(metadata, task);
    const menuButton = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": "Task actions" } });
    setIcon(menuButton, "more-horizontal");
    menuButton.addEventListener("click", (event) => this.openMenu(event, task));
  }

  private renderProperties(parent: HTMLElement, properties: ProjectProperties): void {
    if (properties.scheduledDate) this.badge(parent, "calendar-days", `${formatDate(properties.scheduledDate, this.plugin.dateFormat())}${properties.scheduledTime ? ` ${properties.scheduledTime}` : ""}`);
    if (properties.deadline) this.badge(parent, "flag", `${formatDate(properties.deadline, this.plugin.dateFormat())}${properties.deadlineTime ? ` ${properties.deadlineTime}` : ""}`, properties.deadline < todayIso() ? "danger" : undefined);
    if (properties.durationMinutes) this.badge(parent, "clock-3", formatDuration(properties.durationMinutes));
    if (properties.priority) this.badge(parent, "signal", `P${properties.priority}`, `p${properties.priority}`);
  }

  private badge(parent: HTMLElement, iconName: string, text: string, variant?: string): void {
    const badge = parent.createSpan({ cls: `tm-meta${variant ? ` is-${variant}` : ""}` });
    const icon = badge.createSpan();
    setIcon(icon, iconName);
    badge.createSpan({ text });
  }

  private openMenu(event: MouseEvent, task: Task): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Edit task").setIcon("pencil").onClick(() => this.plugin.openEditor({ ...this.state, task })));
    menu.addItem((item) => item.setTitle("Open source note").setIcon("file-text").onClick(() => void this.openSource(task)));
    menu.showAtMouseEvent(event);
  }

  private async openSource(task: Task): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file, { eState: { line: task.line } });
    }
  }

  private renderEmpty(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "tm-empty" });
    const icon = empty.createDiv({ cls: "tm-empty-icon" });
    setIcon(icon, "circle-check-big");
    empty.createEl("h3", { text: "Nothing here" });
    empty.createEl("p", { text: this.search || this.propertyFilters.length ? "No tasks match the current filters." : this.showCompleted ? "No tasks match this view." : "You're caught up. Completed tasks are hidden." });
  }
}
