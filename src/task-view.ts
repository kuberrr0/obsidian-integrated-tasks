import { renderPropertyFilter } from "./filter-editor";
import { taskTagSummaries } from "./task-tags";
import type { TaskEditorProperty } from "./task-editor";
import { TASK_PROPERTY_ICONS } from "./task-property-icons";
import { TaskSelection } from "./task-selection";
import { updateProjectDates } from "./project-properties";
import { renderGantt } from "./gantt-view";
import type { GanttZoom } from "./gantt";
import { projectHierarchy } from "./project-hierarchy";
import { kanbanColumns } from "./kanban";
import { ListDragController } from "./list-drag-view";
import { draftForGroup, taskGroupTarget, type ListDropGroup, type ListPlacement } from "./list-drag";
import { renderCalendar } from "./calendar-view";
import { addDays, rescheduledDraft, type CalendarScope } from "./calendar";
import { TASK_PROPERTIES } from "./task-properties";
import { ItemView, Menu, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { actionDate, formatDate, parseDateExpression, todayIso } from "./date";
import { formatDuration } from "./parser";
import { groupTasks, orderTaskTree, sortTasks } from "./query";
import type TaskManagerPlugin from "./main";
import type { TaskFilter, Project, ProjectProperties, Task, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

const TITLES: Record<TaskViewMode, string> = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  all: "All Tasks",
  projects: "Projects",
  tags: "Tags",
  smartLists: "Smart Lists"
};

export class TaskMainView extends ItemView {
  private state: TaskViewState = { mode: "today" };
  private layout: "list" | "calendar" | "kanban" = "list";
  private projectLayout: "list" | "gantt" = "list";
  private ganttAnchor = addDays(todayIso(), -2);
  private ganttZoom: GanttZoom = "month";
  private calendarScope: CalendarScope = "month";
  private calendarAnchor = todayIso();
  private showCompleted = false;
  private showArchivedProjects = false;
  private search = "";
  private smartListVersion?: string;
  private propertyFilters: TaskFilter[] = [];
  private sort: TaskSort = "date";
  private descending = false;
  private grouping: TaskGrouping = "default";
  private filtersExpanded = false;
  private unsubscribe?: () => void;
  private taskResults?: HTMLElement;
  private listDrag?: ListDragController;
  private selection = new TaskSelection();
  private contextSelectionOnPress = false;
  private visibleTasks: Task[] = [];
  private selectionRows = new Map<string, HTMLElement[]>();
  private selectionBar?: HTMLElement;
  private selectionCount?: HTMLElement;
  private draggedTasks: Task[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
    this.navigation = false;
  }

  get pagePath(): string | undefined { return this.state.pagePath ?? this.state.projectPath; }

  getViewType(): string { return TASK_MAIN_VIEW; }
  getDisplayText(): string {
    if (this.state.mode === "smartLists" && this.state.smartListId) return this.plugin.settings.smartLists.find(list => list.id === this.state.smartListId)?.name ?? "Smart list not found";
    if (this.state.mode === "tags" && this.state.tag) return this.state.tag;
    if (this.pagePath) return this.pagePath.replace(/\.md$/i, "").split("/").pop() ?? "Project";
    return TITLES[this.state.mode];
  }
  getIcon(): string { return this.state.mode === "projects" ? "folder-kanban" : "circle-check-big"; }
  getState(): Record<string, unknown> { return { ...this.state, layout: this.layout, projectLayout: this.projectLayout, ganttAnchor: this.ganttAnchor, ganttZoom: this.ganttZoom, calendar: this.layout === "calendar", calendarScope: this.calendarScope, calendarAnchor: this.calendarAnchor }; }

  async setState(state: Record<string, unknown>): Promise<void> {
    const mode = state.mode;
    if (state.projectLayout === "list" || state.projectLayout === "gantt") this.projectLayout = state.projectLayout;
    if (state.ganttZoom === "week" || state.ganttZoom === "month" || state.ganttZoom === "quarter") this.ganttZoom = state.ganttZoom;
    if (typeof state.ganttAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.ganttAnchor) && parseDateExpression(state.ganttAnchor)) this.ganttAnchor = state.ganttAnchor;
    if (state.layout === "list" || state.layout === "calendar" || state.layout === "kanban") this.layout = state.layout;
    else if (typeof state.calendar === "boolean") this.layout = state.calendar ? "calendar" : "list";
    if (["day", "week", "month", "year"].includes(String(state.calendarScope))) this.calendarScope = state.calendarScope as CalendarScope;
    if (typeof state.calendarAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.calendarAnchor) && parseDateExpression(state.calendarAnchor)) this.calendarAnchor = state.calendarAnchor;
    if (this.state.mode !== mode || this.state.projectPath !== state.projectPath || this.state.pagePath !== state.pagePath || this.state.tag !== state.tag || this.state.smartListId !== state.smartListId) {
      this.smartListVersion = undefined;
      this.selection.clear();
      this.search = "";
      this.propertyFilters = [];
      this.sort = "date";
      this.descending = false;
      this.grouping = "default";
      this.filtersExpanded = false;
    }
    if (typeof mode === "string" && mode in TITLES) this.state.mode = mode as TaskViewMode;
    this.state.smartListId = typeof state.smartListId === "string" ? state.smartListId : undefined;
    this.state.tag = typeof state.tag === "string" && state.tag ? state.tag : undefined;
    this.state.pagePath = typeof state.pagePath === "string" ? state.pagePath : undefined;
    this.state.markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState as Record<string, unknown> : undefined;
    this.state.projectPath = typeof state.projectPath === "string" ? state.projectPath : undefined;
    // File-backed task views must participate in normal same-tab navigation.
    this.navigation = Boolean(this.pagePath);
    this.render();
  }

  async onOpen(): Promise<void> {
    this.registerDomEvent(this.containerEl.ownerDocument, "click", event => this.clearSelectionOutside(event), true);
    this.unsubscribe = this.plugin.index.subscribe(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    if (this.state.mode === "smartLists" && this.state.smartListId) {
      const list = this.plugin.settings.smartLists.find(item => item.id === this.state.smartListId);
      const version = JSON.stringify(list);
      if (list && version !== this.smartListVersion) {
        this.smartListVersion = version;
        this.propertyFilters = JSON.parse(JSON.stringify(list.filters));
        this.sort = list.sort; this.descending = list.descending; this.grouping = list.grouping;
        this.selection.clear();
      }
    }
    container.empty();
    this.taskResults = undefined;
    this.selectionBar = undefined;
    this.selectionCount = undefined;
    this.visibleTasks = [];
    this.selectionRows.clear();
    container.addClass("tm-main-view");
    const wrapTitles = this.layout === "calendar" ? this.plugin.settings.wrapCalendarTaskTitles
      : this.layout === "kanban" ? this.plugin.settings.wrapKanbanTaskTitles : this.plugin.settings.wrapTaskTitles;
    container.classList.toggle("tm-wrap-task-titles", wrapTitles);
    container.classList.toggle("is-calendar-view", this.layout === "calendar" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    container.classList.toggle("is-kanban-view", this.layout === "kanban" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    if (this.state.mode === "smartLists" && !this.state.smartListId) {
      container.classList.remove("is-calendar-view", "is-kanban-view");
      this.renderSmartLists(container);
      return;
    }
    if (this.state.mode === "smartLists" && !this.plugin.settings.smartLists.some(list => list.id === this.state.smartListId)) {
      container.createDiv({ cls: "tm-empty", text: "This smart list no longer exists." });
      return;
    }
    if (this.state.mode === "tags" && !this.state.tag) {
      container.classList.remove("is-calendar-view", "is-kanban-view");
      this.renderTagList(container);
      return;
    }
    if (this.state.mode === "projects" && !this.pagePath) {
      this.renderProjectList(container);
      return;
    }

    this.renderHeader(container);
    this.renderFilters(container);
    this.renderSelectionBar(container);
    this.taskResults = container.createDiv({ cls: "tm-task-results" });
    this.renderTaskResults();
  }

  private renderTaskResults(): void {
    const container = this.taskResults;
    if (!container) return;
    container.empty();
    this.visibleTasks = [];
    this.selectionRows.clear();
    this.updateSelection();
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), this.layout !== "kanban", task => this.prepareDrag(task));
    const query: TaskQuery = {
      mode: this.pagePath ? "project" : this.layout === "calendar" && (this.state.mode === "today" || this.state.mode === "upcoming") ? "all" : this.state.mode,
      showCompleted: this.showCompleted || this.layout === "kanban",
      projectPath: this.pagePath,
      tag: this.state.mode === "tags" ? this.state.tag : undefined,
      filters: this.propertyFilters,
      search: this.search || undefined
    };
    const tasks = sortTasks(this.plugin.index.query(query), this.sort, this.descending);
    this.selection.retain(tasks);
    this.renderTaskLayouts(container, tasks);
    this.selection.retain(this.visibleTasks);
    this.updateSelection();
  }

  private renderTaskLayouts(container: HTMLElement, tasks: Task[]): void {
    if (this.layout === "calendar") {
      renderCalendar(container, {
        anchor: this.calendarAnchor, scope: this.calendarScope, tasks, dateFormat: this.plugin.dateFormat(),
        navigate: (anchor, scope) => { this.calendarAnchor = anchor; this.calendarScope = scope; this.renderTaskResults(); },
        create: preset => this.plugin.openEditor({ ...this.state, preset }),
        edit: task => this.editTask(task),
        bind: (card, task) => this.bindSelection(card, task),
        dragStart: task => this.prepareDrag(task),
        resize: async (task, date, time, duration) => {
          const latest = this.plugin.index.taskById(task.id);
          if (!latest) throw new Error("Task no longer exists. Refresh the view and try again.");
          await this.plugin.store.update(latest, { ...rescheduledDraft(latest, date, time), durationMinutes: duration });
          await this.plugin.index.refreshPath(latest.path);
        },
        move: async (task, date, time) => {
          const selected = this.draggedTasks.length ? this.draggedTasks : [task];
          const paths = await this.plugin.store.bulkChange(selected, original => rescheduledDraft(original, date, time));
          this.clearSelection();
          for (const path of paths) await this.plugin.index.refreshPath(path);
        }
      });
      return;
    }
    if (this.layout === "kanban") {
      this.renderKanban(container, tasks);
      return;
    }
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
        this.renderSection(container, title, group, undefined, taskGroupTarget(this.grouping, group[0]));
      }
      return;
    }
    if (this.pagePath) {
      this.renderProjectSections(container, this.pagePath, tasks);
      return;
    }
    if (this.state.mode === "today") {
      const today = todayIso();
      this.renderSection(container, "Overdue", tasks.filter((task) => (actionDate(task) ?? today) < today), "alert", { property: "date", value: addDays(today, -1) });
      this.renderSection(container, "Today", tasks.filter((task) => actionDate(task) === today), undefined, { property: "date", value: today });
    } else if (this.state.mode === "upcoming") {
      for (const [date, group] of groupTasks(tasks, "date")) this.renderSection(container, formatDate(date, this.plugin.dateFormat()), group, undefined, taskGroupTarget("date", group[0]));
    } else if (this.state.mode === "all") {
      const groups = new Map<string, Task[]>();
      for (const task of tasks) groups.set(task.path, [...(groups.get(task.path) ?? []), task]);
      for (const [path, group] of groups) {
        if (this.plugin.index.isProject(path)) {
          const project = container.createEl("section", { cls: "tm-section" });
          const heading = project.createEl("h2", { text: path.replace(/\.md$/i, "") });
          this.renderGroupAddButton(heading, path.replace(/\.md$/i, ""), { destination: path });
          this.listDrag?.group(project, { destination: path });
          this.renderProjectSections(project, path, group);
        } else this.renderSection(container, path.replace(/\.md$/i, ""), group, undefined, { destination: path });
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }

  private renderKanban(container: HTMLElement, tasks: Task[]): void {
    const columns = kanbanColumns(tasks, this.grouping);
    if (!columns.length) { this.renderEmpty(container); return; }
    const board = container.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column" });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      const title = column.target?.property && ["date", "scheduledDate", "deadline"].includes(column.target.property) && typeof column.target.value === "string"
        ? formatDate(column.target.value, this.plugin.dateFormat()) : column.title;
      header.createEl("h2", { text: title });
      header.createSpan({ cls: "tm-section-count", text: String(column.tasks.length) });
      this.renderGroupAddButton(header, title, column.target);
      if (column.target) this.listDrag?.group(section, column.target);
      this.renderTaskList(section, column.tasks, column.target);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
  }

  private renderProjectSections(container: HTMLElement, path: string, tasks: Task[]): void {
    this.renderTaskList(container, tasks.filter((task) => task.sectionLine === undefined), { destination: path });
    for (const heading of this.plugin.index.headingsForPath(path)) {
      const group = tasks.filter((task) => task.sectionLine === heading.line);
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      title.createSpan({ cls: "tm-section-count", text: String(group.length) });
      const target = { destination: `${path}#${heading.name}` };
      this.renderGroupAddButton(title, heading.name, target);
      this.listDrag?.group(section, target);
      this.renderTaskList(section, group, target);
    }
    if (!tasks.length && !this.plugin.index.headingsForPath(path).length) this.renderEmpty(container);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-view-header" });
    const titleGroup = header.createDiv({ cls: "tm-title-group" });
    if (this.state.mode === "tags" && this.state.tag) {
      const back = titleGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Back to tags" } });
      setIcon(back, "arrow-left");
      back.addEventListener("click", () => void this.plugin.openTaskView({ mode: "tags" }));
    }
    if (this.state.projectPath && !this.state.pagePath) {
      const back = titleGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Back to projects" } });
      setIcon(back, "arrow-left");
      back.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects" }));
    }
    const heading = titleGroup.createDiv();
    heading.createEl("h1", { text: this.getDisplayText() });
    const project = this.pagePath ? this.plugin.index.projects().find(project => project.path === this.pagePath) : undefined;
    if (project) {
      const metadata = heading.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
      this.renderProperties(metadata, project);
      if (project.parent) this.badge(metadata, "folder", `Parent: ${project.parent.replace(/\.md$/i, "")}`);
      if (!metadata.childElementCount) metadata.remove();
    }

    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Task view layout" } });
    for (const [layout, icon, label] of [["list", "list", "List"], ["calendar", "calendar-days", "Calendar"], ["kanban", "columns-3", "Kanban"]] as const) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${label} view`, title: `${label} view`, "aria-pressed": String(this.layout === layout) } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.layout = layout; this.render(); });
    }
    const add = actions.createEl("button", { cls: "mod-cta tm-add-task" });
    const icon = add.createSpan();
    setIcon(icon, "plus");
    add.createSpan({ text: "Add task" });
    add.addEventListener("click", () => this.plugin.openEditor(this.state));
  }

  focusSearch(): void {
    const input = this.containerEl.querySelector<HTMLInputElement>('.tm-filters input[type="search"]');
    input?.focus();
    input?.select();
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
    menu.createDiv({ text: "Match all properties. Within a property, AND is evaluated before OR.", cls: "tm-filter-hint" });
    const clear = menu.createEl("button", { text: "Clear all filters" });
    clear.addEventListener("click", () => { this.propertyFilters = []; this.render(); });
    for (const property of TASK_PROPERTIES) {
      const active = this.propertyFilters.find(filter => filter.property === property.key);
      const submenu = menu.createDiv({ cls: "tm-property-submenu" });
      const summary = submenu.createSpan({ cls: "tm-property-name", text: `${property.label}${active ? " •" : ""}` });
      const panel = submenu.createDiv({ cls: "tm-property-conditions" });
      renderPropertyFilter(panel, property, active, this.plugin.index.allTasks(), filter => {
        this.propertyFilters = this.propertyFilters.filter(item => item.property !== property.key);
        if (filter) this.propertyFilters.push(filter);
        summary.setText(`${property.label}${filter ? " •" : ""}`);
        sync();
        this.renderTaskResults();
      });
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
      for (const property of [{ key: "date", label: "Action date and time" }, ...TASK_PROPERTIES
        .filter(property => property.key !== "scheduledTime" && property.key !== "deadlineTime")
        .map(property => ({ ...property, label: property.key === "scheduledDate" ? "Scheduled date and time" : property.key === "deadline" ? "Deadline date and time" : property.label }))]) {
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

  private renderSmartLists(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-view-header" });
    header.createEl("h1", { text: "Smart Lists" });
    header.createEl("button", { text: "Create new smart list", cls: "mod-cta" })
      .addEventListener("click", () => this.plugin.openSmartListEditor());
    const lists = this.plugin.settings.smartLists;
    if (!lists.length) container.createDiv({ cls: "tm-empty", text: "No smart lists yet. Save filters, sorting, and grouping to create one." });
    const entries = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    for (const list of lists) {
      const row = entries.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
      const icon = row.createSpan({ cls: "tm-project-icon" });
      setIcon(icon, "list-filter");
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      primary.createEl("button", { cls: "tm-task-title", text: list.name, attr: { title: list.name } })
        .addEventListener("click", () => void this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }));
    }
  }

  private renderTagList(container: HTMLElement): void {
    container.createEl("h1", { text: "Tags" });
    const search = container.createEl("input", { type: "search", cls: "tm-tag-search", attr: { placeholder: "Search tags…", "aria-label": "Search tags" } });
    search.value = this.search;
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    const render = (): void => {
      list.empty();
      const tags = taskTagSummaries(this.plugin.index.allTasks()).filter(tag => tag.name.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()));
      if (!tags.length) list.createDiv({ cls: "tm-empty", text: this.search ? "No matching tags" : "No tags yet. Add a tag to a task to see it here." });
      for (const tag of tags) {
        const row = list.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
        const icon = row.createSpan({ cls: "tm-project-icon" });
        setIcon(icon, "tag");
        const content = row.createDiv({ cls: "tm-task-content" });
        const title = content.createEl("button", { cls: "tm-task-title", text: tag.name });
        title.addEventListener("click", () => void this.plugin.openTaskView({ mode: "tags", tag: tag.name }));
        content.createDiv({ cls: "tm-task-metadata", text: `${tag.openTasks} open · ${tag.completedTasks} completed` });
      }
    };
    search.addEventListener("input", () => { this.search = search.value; render(); });
    render();
  }

  private renderProjectList(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tm-view-header" });
    const title = header.createDiv({ cls: "tm-title-group" }).createDiv();
    title.createEl("h1", { text: "Projects" });
    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Projects layout" } });
    for (const [layout, icon] of [["list", "list"], ["gantt", "chart-gantt"]] as const) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${layout === "gantt" ? "Gantt" : "List"} projects view`, "aria-pressed": String(this.projectLayout === layout), title: `${layout === "gantt" ? "Gantt" : "List"} view` } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.projectLayout = layout; this.render(); });
    }
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
    if (this.projectLayout === "gantt") {
      renderGantt(container, {
        projects: this.showArchivedProjects ? projects : active,
        anchor: this.ganttAnchor, zoom: this.ganttZoom, dateFormat: this.plugin.dateFormat(),
        navigate: (anchor, zoom) => { this.ganttAnchor = anchor; this.ganttZoom = zoom; this.render(); },
        open: project => { void this.plugin.openProject(project.path).catch(error => new Notice(String(error))); },
        update: async (project, changes) => {
          const file = this.app.vault.getAbstractFileByPath(project.path);
          if (!(file instanceof TFile)) throw new Error("Project note no longer exists.");
          await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => updateProjectDates(frontmatter, changes, project, this.plugin.dateFormat()));
          await this.plugin.index.refreshPath(project.path);
        }
      });
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
    for (const { project, depth } of projectHierarchy(projects)) {
      const row = list.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
      row.style.setProperty("--tm-depth", String(depth));
      const icon = row.createSpan({ cls: "tm-project-icon" });
      setIcon(icon, project.archived ? "archive" : "folder");
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      const button = primary.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path } });
      button.addEventListener("click", () => void this.plugin.openProject(project.path).catch(error => new Notice(String(error))));
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
      open.addEventListener("click", () => void this.plugin.openProject(project.path).catch(error => new Notice(String(error))));
    }
  }

  private renderGroupAddButton(parent: HTMLElement, title: string, target?: ListDropGroup): void {
    const add = parent.createEl("button", { cls: "clickable-icon tm-group-add-task", attr: {
      type: "button", "aria-label": `Add task to ${title}`, title: `Add task to ${title}`
    } });
    setIcon(add, "plus");
    add.addEventListener("click", event => {
      event.stopPropagation();
      const blank: Task = { id: "", path: this.pagePath ?? this.plugin.settings.inboxPath, title: "", completed: false, line: 0, endLine: 0, raw: "", indent: 0, childIds: [] };
      this.plugin.openEditor({ ...this.state, preset: draftForGroup(blank, target) });
    });
  }

  private renderSection(container: HTMLElement, title: string, tasks: Task[], variant?: "alert", target?: ListDropGroup): void {
    if (!tasks.length && !target) return;
    const section = container.createEl("section", { cls: `tm-section${variant ? ` is-${variant}` : ""}` });
    const heading = section.createEl("h2");
    heading.createSpan({ text: title });
    heading.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
    this.renderGroupAddButton(heading, title, target);
    if (target) this.listDrag?.group(section, target);
    this.renderTaskList(section, tasks, target);
  }

  private renderTaskList(container: HTMLElement, tasks: Task[], target?: ListDropGroup): void {
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    if (target) this.listDrag?.group(list, target);
    const visibleIds = new Set(tasks.map((task) => task.id));
    for (const task of orderTaskTree(tasks)) {
      const relativeDepth = this.depthWithin(task, visibleIds);
      this.renderTaskRow(list, task, relativeDepth, target);
    }
  }

  private async dropListTask(original: Task, group?: ListDropGroup, originalAnchor?: Task, placement?: ListPlacement): Promise<void> {
    try {
      const selected = this.draggedTasks.length ? this.draggedTasks : [original];
      for (const task of selected) {
        const current = this.plugin.index.taskById(task.id);
        if (!current || current.raw !== task.raw) throw new Error("Task changed while dragging. Refresh and try again.");
      }
      if (this.layout === "kanban" && group && selected.some(task => {
        const previous = group.property ? taskGroupTarget(group.property, task) : undefined;
        return group.value !== previous?.value || (group.destination && group.destination !== draftForGroup(task).destination);
      })) {
        originalAnchor = undefined;
        placement = undefined;
      }
      const anchor = originalAnchor ? this.plugin.index.taskById(originalAnchor.id) : undefined;
      if (originalAnchor && (!anchor || anchor.raw !== originalAnchor.raw)) throw new Error("Drop target changed while dragging. Refresh and try again.");
      const paths = await this.plugin.store.bulkDrop(selected, group, anchor, placement);
      if (anchor && placement) { this.sort = "source"; this.descending = false; }
      this.clearSelection();
      for (const path of paths) await this.plugin.index.refreshPath(path);
      this.render();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not move selected tasks.");
    } finally { this.draggedTasks = []; }
  }

  getSelectedTasks(): Task[] { return this.selection.tasks(this.visibleTasks); }

  clearSelection(): void { this.selection.clear(); this.updateSelection(); }

  private clearSelectionOutside(event: MouseEvent): void {
    if (event.button !== 0 || (Platform.isMacOS && event.ctrlKey) || !this.getSelectedTasks().length) return;
    const target = event.target as HTMLElement | null;
    // Let the toolbar act on the selection before clearing it.
    if (target && this.selectionBar?.contains(target) && target.closest("button")) return;
    const selected = this.getSelectedTasks().some(task =>
      this.selectionRows.get(task.id)?.some(row => target && row.contains(target)));
    if (!selected) this.clearSelection();
  }

  private editTask(task: Task, focusProperty?: TaskEditorProperty): void {
    if (!this.selection.has(task)) this.clearSelection();
    if (this.selection.has(task)) {
      if (focusProperty) this.plugin.openBulkEditor(this, focusProperty);
      else this.plugin.openBulkEditor(this);
    }
    else if (focusProperty) this.plugin.openEditor({ ...this.state, task, focusProperty });
    else this.plugin.openEditor({ ...this.state, task });
  }

  private prepareDrag(task: Task): void {
    this.draggedTasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
  }

  private bindSelection(row: HTMLElement, task: Task): void {
    if (!this.selectionRows.has(task.id)) this.visibleTasks.push(task);
    const rows = this.selectionRows.get(task.id) ?? [];
    rows.push(row);
    this.selectionRows.set(task.id, rows);
    row.setAttribute("tabindex", "0");
    row.setAttribute("data-task-id", task.id);
    const interactive = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      const control = element?.closest?.("button, input, label, a, select, textarea, .tm-calendar-task-title, .tm-calendar-resize-handle");
      return Boolean(control && control !== row);
    };
    const selectForContextMenu = (event: MouseEvent): void => {
      const additive = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (!this.selection.has(task) || event.shiftKey || additive) {
        this.selection.click(task, this.visibleTasks, event.shiftKey, additive);
      }
      row.focus({ preventScroll: true });
      this.updateSelection();
    };
    // Select on press: contextmenu may wait for release or the native menu gesture.
    row.addEventListener("pointerdown", event => {
      this.contextSelectionOnPress = event.button === 2 || (Platform.isMacOS && event.button === 0 && event.ctrlKey);
      if (this.contextSelectionOnPress) {
        selectForContextMenu(event);
      }
    });
    // Also support keyboard context-menu requests and other non-pointer input.
    row.addEventListener("contextmenu", event => {
      // The selection toolbar can move rows beneath the pointer after press.
      // Consume the gesture across the view, even if its menu targets another row.
      if (!this.contextSelectionOnPress) selectForContextMenu(event);
      this.contextSelectionOnPress = false;
    });
    row.addEventListener("pointercancel", () => { this.contextSelectionOnPress = false; });
    row.addEventListener("click", event => {
      if (interactive(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      this.editTask(task);
    });
    row.addEventListener("keydown", event => {
      this.contextSelectionOnPress = false;
      if (interactive(event.target)) return;
      if (event.key === "Escape") { event.preventDefault(); this.clearSelection(); }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        this.editTask(task);
      }
    });
  }

  private updateSelection(): void {
    for (const task of this.visibleTasks) for (const row of this.selectionRows.get(task.id) ?? []) {
      const selected = this.selection.has(task);
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-label", `${task.title}${selected ? ", selected" : ""}`);
    }
    const count = this.getSelectedTasks().length;
    if (this.selectionBar) this.selectionBar.hidden = count === 0;
    this.selectionCount?.setText(`${count} selected`);
  }

  private renderSelectionBar(container: HTMLElement): void {
    this.selectionBar = container.createDiv({ cls: "tm-selection-bar" });
    this.selectionBar.hidden = true;
    this.selectionCount = this.selectionBar.createSpan({ attr: { role: "status", "aria-live": "polite" } });
    const edit = this.selectionBar.createEl("button", { text: "Edit task properties" });
    edit.addEventListener("click", () => { this.plugin.openBulkEditor(this); this.clearSelection(); });
    const clear = this.selectionBar.createEl("button", { text: "Clear selection" });
    clear.addEventListener("click", () => this.clearSelection());
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

  private renderTaskRow(list: HTMLElement, task: Task, depth: number, target?: ListDropGroup): void {
    const row = list.createDiv({ cls: `tm-task-row${task.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    this.bindSelection(row, task);
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
    this.listDrag?.row(row, primary, task, target);
    const title = primary.createEl("button", { cls: "tm-task-title", text: task.title, attr: { title: task.title } });
    title.addEventListener("click", () => this.editTask(task));
    if (task.childIds.length) {
      const children = task.childIds.map((id) => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child));
      primary.createSpan({ cls: "tm-progress", text: `${children.filter((child) => child.completed).length}/${children.length}` });
    }
    const metadata = content.createDiv({ cls: "tm-task-metadata" });
    const implicitSource = this.pagePath ?? (this.state.mode === "inbox" ? this.plugin.settings.inboxPath : undefined);
    if (task.path !== implicitSource) {
      const source = metadata.createEl("button", { cls: "tm-source", text: task.path.replace(/\.md$/i, "") });
      source.addEventListener("click", () => void this.openSource(task));
    }
    this.renderProperties(metadata, task);
    if (!metadata.childElementCount) metadata.remove();
    const menuButton = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": "Task actions" } });
    setIcon(menuButton, "more-horizontal");
    menuButton.addEventListener("click", (event) => this.openMenu(event, task));
  }

  private renderProperties(parent: HTMLElement, properties: ProjectProperties | Task): void {
    const propertyBadge = (property: TaskEditorProperty, icon: string, text: string, variant?: string): void => {
      const badge = this.badge(parent, icon, text, variant);
      if (!("completed" in properties)) return;
      badge.setAttribute("role", "button");
      badge.setAttribute("tabindex", "0");
      const label = { scheduledDate: "scheduled date and time", deadline: "deadline", durationMinutes: "duration", priority: "priority", tags: "tags" }[property];
      badge.setAttribute("aria-label", `Edit ${label}: ${text}`);
      badge.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        this.editTask(properties, property);
      });
      badge.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); event.stopPropagation();
        this.editTask(properties, property);
      });
    };
    const incompleteTask = "completed" in properties && !properties.completed;
    if (properties.scheduledDate) propertyBadge("scheduledDate", TASK_PROPERTY_ICONS.scheduledDate, `${formatDate(properties.scheduledDate, this.plugin.dateFormat())}${properties.scheduledTime ? ` ${properties.scheduledTime}` : ""}`, incompleteTask && properties.scheduledDate < todayIso() ? "danger" : undefined);
    if ("endDate" in properties && properties.endDate) this.badge(parent, "calendar-check", `End: ${formatDate(properties.endDate, this.plugin.dateFormat())}`);
    if ("durationMinutes" in properties && properties.durationMinutes) propertyBadge("durationMinutes", TASK_PROPERTY_ICONS.durationMinutes, formatDuration(properties.durationMinutes));
    if (properties.deadline) propertyBadge("deadline", TASK_PROPERTY_ICONS.deadline, `${formatDate(properties.deadline, this.plugin.dateFormat())}${properties.deadlineTime ? ` ${properties.deadlineTime}` : ""}`, (!("completed" in properties) || incompleteTask) && properties.deadline < todayIso() ? "danger" : undefined);
    if (properties.priority) propertyBadge("priority", TASK_PROPERTY_ICONS.priority, `P${properties.priority}`, `p${properties.priority}`);
    if ("tags" in properties) for (const tag of properties.tags ?? []) propertyBadge("tags", TASK_PROPERTY_ICONS.tags, tag);
  }

  private badge(parent: HTMLElement, iconName: string, text: string, variant?: string): HTMLElement {
    const badge = parent.createSpan({ cls: `tm-meta${variant ? ` is-${variant}` : ""}` });
    const icon = badge.createSpan({ cls: "tm-meta-icon" });
    setIcon(icon, iconName);
    badge.createSpan({ text });
    return badge;
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
