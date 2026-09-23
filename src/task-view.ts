import { taskTitleLabel } from "./task-title";
import { renderProjectProgress } from "./project-progress";
import { renderProjectHeaderDetails } from "./project-header-details";
import { renderTaskDetails } from "./task-row-details";
import { recurringFile } from "./recurring-task";
import { renderDashboard } from "./dashboard-view";
import { renderDescriptionIndicator } from "./task-description-indicator";
import { cloneTaskFilters } from "./task-filters";
import { renderPropertyFilter } from "./filter-editor";
import { taskTagSummaries } from "./task-tags";
import type { TaskEditorProperty } from "./task-editor";
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
import { groupTasks, orderTaskTree, sortTasks } from "./query";
import type TaskManagerPlugin from "./main";
import type { TaskProperty, TaskFilter, Project, Task, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

const TITLES: Record<TaskViewMode, string> = {
  dashboard: "Task Dashboard",
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
  private calendarPlanningOpen = false;
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
  private draggedTasks: Task[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
    this.navigation = false;
  }

  get pagePath(): string | undefined { return this.state.pagePath ?? this.state.projectPath; }

  get hasCalendar(): boolean {
    if (this.state.mode === "dashboard") return true;
    if (this.layout !== "calendar") return false;
    if (this.state.mode === "projects" && !this.pagePath) return false;
    if (this.state.mode === "tags" && !this.state.tag) return false;
    if (this.state.mode === "smartLists" && !this.plugin.settings.smartLists.some(list => list.id === this.state.smartListId)) return false;
    return true;
  }

  private get taskSourcePath(): string | undefined { return this.state.mode === "tags" ? undefined : this.pagePath; }

  getViewType(): string { return TASK_MAIN_VIEW; }
  getDisplayText(): string {
    if (this.state.mode === "smartLists" && this.state.smartListId) return this.plugin.settings.smartLists.find(list => list.id === this.state.smartListId)?.name ?? "Smart list not found";
    if (this.state.mode === "tags" && this.state.tag) return this.state.tag;
    if (this.pagePath) return this.pagePath.replace(/\.md$/i, "").split("/").pop() ?? "Project";
    return TITLES[this.state.mode];
  }
  getIcon(): string { return this.state.mode === "projects" ? "target" : "circle-check-big"; }
  getState(): Record<string, unknown> { return { ...this.state, layout: this.layout, projectLayout: this.projectLayout, ganttAnchor: this.ganttAnchor, ganttZoom: this.ganttZoom, calendar: this.layout === "calendar", calendarScope: this.calendarScope, calendarAnchor: this.calendarAnchor }; }

  async setState(state: Record<string, unknown>): Promise<void> {
    const mode = state.mode;
    if (state.projectLayout === "list" || state.projectLayout === "gantt") this.projectLayout = state.projectLayout;
    if (state.ganttZoom === "month" || state.ganttZoom === "quarter" || state.ganttZoom === "year" || state.ganttZoom === "five-year") this.ganttZoom = state.ganttZoom;
    else if (state.ganttZoom === "week") this.ganttZoom = "month";
    if (typeof state.ganttAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.ganttAnchor) && parseDateExpression(state.ganttAnchor)) this.ganttAnchor = state.ganttAnchor;
    if (state.layout === "list" || state.layout === "calendar" || state.layout === "kanban") this.layout = state.layout;
    else if (typeof state.calendar === "boolean") this.layout = state.calendar ? "calendar" : "list";
    if (["day", "four-day", "week", "month", "year"].includes(String(state.calendarScope))) this.calendarScope = state.calendarScope as CalendarScope;
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
        this.propertyFilters = cloneTaskFilters(list.filters);
        this.sort = list.sort; this.descending = list.descending; this.grouping = list.grouping;
        this.selection.clear();
      }
    }
    container.empty();
    this.taskResults = undefined;
    this.visibleTasks = [];
    this.selectionRows.clear();
    container.addClass("tm-main-view");
    container.classList.toggle("is-dashboard-view", this.state.mode === "dashboard");
    const hover = this.plugin.settings.taskHoverHighlight ?? "none";
    container.classList.toggle("tm-hover-title", hover === "title" || hover === "all");
    container.classList.toggle("tm-hover-background", hover === "background" || hover === "all");
    container.style.setProperty("--tm-task-row-height-multiplier", String(this.plugin.settings.taskListRowHeightMultiplier ?? 1.0));
    const wrapTitles = this.state.mode === "dashboard" ? this.plugin.settings.wrapTaskTitles : this.layout === "calendar" ? this.plugin.settings.wrapCalendarTaskTitles
      : this.layout === "kanban" ? this.plugin.settings.wrapKanbanTaskTitles : this.plugin.settings.wrapTaskTitles;
    container.classList.toggle("tm-wrap-task-titles", wrapTitles);
    container.classList.toggle("is-calendar-view", this.layout === "calendar" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    container.classList.toggle("is-kanban-view", this.layout === "kanban" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    if (this.state.mode === "dashboard") {
      container.classList.remove("is-calendar-view", "is-kanban-view");
      this.renderTaskDashboard(container);
      return;
    }
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

    const viewOptions = this.renderHeader(container);
    this.renderFilters(container, viewOptions);
    this.taskResults = container.createDiv({ cls: "tm-task-results" });
    this.renderTaskResults();
  }

  private renderTaskDashboard(container: HTMLElement): void {
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), true, task => this.prepareDrag(task));
    const tasks = (mode: "today" | "upcoming" | "all"): Task[] => this.plugin.index.query({ mode, showCompleted: false });
    const today = tasks("today");
    const upcoming = tasks("upcoming");
    this.selection.retain([...today, ...upcoming]);
    renderDashboard(container, {
      today: card => {
        if (today.length) this.renderTaskList(card, today);
        else card.createDiv({ cls: "tm-empty", text: "No tasks for today" });
      },
      upcoming: card => {
        if (upcoming.length) this.renderTaskList(card, upcoming);
        else card.createDiv({ cls: "tm-empty", text: "No upcoming tasks" });
      },
      projects: card => {
        const projects = this.plugin.index.projects().filter(project => !project.archived);
        if (projects.length) this.renderProjectGroup(card, "Active", projects);
        else card.createDiv({ cls: "tm-empty", text: "No projects yet" });
      },
      calendar: card => {
        card.classList.toggle("tm-dashboard-calendar-wrap", this.plugin.settings.wrapCalendarTaskTitles);
        renderCalendar(card, {
          anchor: this.calendarAnchor, scope: this.calendarScope, tasks: tasks("all"), dateFormat: this.plugin.dateFormat(),
          navigate: (anchor, scope) => { this.calendarAnchor = anchor; this.calendarScope = scope; this.render(); },
          create: preset => this.plugin.openEditor({ mode: "all", preset }),
          edit: task => this.plugin.openEditor({ mode: "all", task }),
          toggle: (task, completed) => this.plugin.store.toggle(task, completed),
          move: async (task, date, time) => {
            await this.plugin.store.update(task, rescheduledDraft(task, date, time));
            await this.plugin.index.refreshPath(task.path);
          },
          resize: async (task, date, time, duration) => {
            await this.plugin.store.update(task, { ...rescheduledDraft(task, date, time), durationMinutes: duration });
            await this.plugin.index.refreshPath(task.path);
          }
        });
      },
      createTask: mode => this.plugin.openEditor({ mode }),
      createProject: () => this.plugin.openProjectCreator()
    });
    this.updateSelection();
  }

  private renderTaskResults(): void {
    if (this.state.mode === "dashboard") { this.render(); return; }
    const container = this.taskResults;
    if (!container) return;
    container.empty();
    this.visibleTasks = [];
    this.selectionRows.clear();
    this.updateSelection();
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), this.layout !== "kanban", task => this.prepareDrag(task));
    const query: TaskQuery = {
      mode: this.taskSourcePath ? "project" : this.layout === "calendar" && (this.state.mode === "today" || this.state.mode === "upcoming") ? "all" : this.state.mode,
      showCompleted: this.showCompleted || this.layout === "kanban",
      projectPath: this.taskSourcePath,
      tag: this.state.mode === "tags" && !this.pagePath ? this.state.tag : undefined,
      tagPath: this.state.mode === "tags" ? this.pagePath : undefined,
      filters: this.propertyFilters,
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
        planning: true, planningOpen: this.calendarPlanningOpen,
        planningChanged: open => { this.calendarPlanningOpen = open; },
        anchor: this.calendarAnchor, scope: this.calendarScope, tasks, dateFormat: this.plugin.dateFormat(),
        navigate: (anchor, scope) => { this.calendarAnchor = anchor; this.calendarScope = scope; this.renderTaskResults(); },
        create: preset => this.plugin.openEditor({ ...this.state, preset }),
        edit: task => this.editTask(task),
        toggle: (task, completed) => this.plugin.store.toggle(task, completed),
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
      if (this.taskSourcePath && this.grouping === "default" && !this.propertyFilters.length) {
        this.renderProjectSections(container, this.taskSourcePath, tasks);
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
    if (this.taskSourcePath) {
      this.renderProjectSections(container, this.taskSourcePath, tasks);
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
        this.renderSection(container, path.replace(/\.md$/i, ""), group, undefined, { destination: path });
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }

  private renderKanban(container: HTMLElement, tasks: Task[]): void {
    const columns = kanbanColumns(tasks, this.grouping === "default" && this.state.mode === "all" && !this.taskSourcePath ? "source" : this.grouping);
    if (!columns.length) { this.renderEmpty(container); return; }
    const board = container.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column" });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      const title = column.target?.property && ["date", "scheduledDate", "deadline"].includes(column.target.property) && typeof column.target.value === "string"
        ? formatDate(column.target.value, this.plugin.dateFormat()) : column.target?.property === "source" ? column.title.replace(/\.md$/i, "") : column.title;
      header.createEl("h2", { text: title });
      if (this.plugin.settings.showGroupTaskCounts) header.createSpan({ cls: "tm-section-count", text: String(column.tasks.length) });
      this.renderGroupAddButton(header, title, column.target);
      if (column.target) this.listDrag?.group(section, column.target);
      this.renderTaskList(section, column.tasks, column.target);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
  }

  private renderProjectSections(container: HTMLElement, path: string, tasks: Task[]): void {
    const headings = this.plugin.index.headingsForPath(path);
    const unsectioned = tasks.filter(task => task.sectionLine === undefined);
    if (unsectioned.length || !headings.length) this.renderTaskList(container, unsectioned, { destination: path });
    for (const heading of headings) {
      const group = tasks.filter((task) => task.sectionLine === heading.line);
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      if (this.plugin.settings.showGroupTaskCounts) title.createSpan({ cls: "tm-section-count", text: String(group.length) });
      const target = { destination: `${path}#${heading.name}` };
      this.renderGroupAddButton(title, heading.name, target);
      this.listDrag?.group(section, target);
      this.renderTaskList(section, group, target);
    }
    if (!tasks.length && !headings.length) this.renderEmpty(container);
  }

  private renderHeader(container: HTMLElement): HTMLButtonElement {
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
    const project = this.taskSourcePath ? this.plugin.index.projects().find(project => project.path === this.taskSourcePath) : undefined;
    if (project) {
      const metadata = heading.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
      renderProjectHeaderDetails(metadata, project, property => this.plugin.openProjectEditor(project.path, property), this.plugin.dateFormat());
      renderProjectProgress(metadata, project);
    }

    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Task view layout" } });
    for (const [layout, icon, label] of [["list", "list", "List"], ["calendar", "calendar-days", "Calendar"], ["kanban", "columns-3", "Kanban"]] as const) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${label} view`, title: `${label} view`, "aria-pressed": String(this.layout === layout) } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.layout = layout; this.render(); });
    }
    const toggle = actions.createEl("button", { cls: "tm-filter-toggle clickable-icon", attr: { "aria-label": "View options: filter, sort, and group" } });
    const add = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Add task", title: "Add task" } });
    const icon = add.createSpan();
    setIcon(icon, "plus");
    add.addEventListener("click", () => this.plugin.openEditor(this.state));
    return toggle;
  }

  private renderFilters(container: HTMLElement, toggle: HTMLButtonElement): void {
    const filters = container.createDiv({ cls: "tm-filters" });
    const menu = filters.createDiv({ cls: "tm-property-menu" });
    const sync = (): void => {
      setIcon(toggle, "sliders-vertical");
      const label = `View options: filter, sort, and group${this.propertyFilters.length ? ` (${this.propertyFilters.length} active filters)` : ""}`;
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
      toggle.setAttribute("aria-expanded", String(this.filtersExpanded));
      filters.hidden = !this.filtersExpanded;
      menu.hidden = !this.filtersExpanded;
    };
    toggle.addEventListener("click", () => { this.filtersExpanded = !this.filtersExpanded; sync(); });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { this.filtersExpanded = false; sync(); toggle.focus(); }
    });
    sync();
    const ordering = menu.createDiv({ cls: "tm-view-option-controls" });
    const selectOption = (label: string, value: string, choices: { key: string; label: string }[], change: (value: string) => void): void => {
      const field = ordering.createEl("label", { cls: "tm-view-option" });
      field.createSpan({ text: label });
      const select = field.createEl("select", { attr: { "aria-label": label } });
      for (const choice of choices) select.createEl("option", { value: choice.key, text: choice.label });
      select.value = value;
      select.addEventListener("change", () => { change(select.value); this.renderTaskResults(); });
    };
    selectOption("Sort by", this.sort, [{ key: "date", label: "Action date and time" }, ...TASK_PROPERTIES
      .filter(property => property.key !== "scheduledTime" && property.key !== "deadlineTime")
      .map(property => ({ ...property, label: property.key === "scheduledDate" ? "Scheduled date and time" : property.key === "deadline" ? "Deadline date and time" : property.label }))], value => { this.sort = value as TaskSort; });
    selectOption("Sort direction", this.descending ? "descending" : "ascending", [
      { key: "ascending", label: "Ascending" }, { key: "descending", label: "Descending" }
    ], value => { this.descending = value === "descending"; });
    selectOption("Group by", this.grouping, [
      { key: "default", label: "View default" }, { key: "none", label: "None" }, { key: "date", label: "Action date" }, ...TASK_PROPERTIES
    ], value => { this.grouping = value as TaskGrouping; });
    menu.createEl("h3", { text: "Filters", cls: "tm-view-option-heading" });
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
        title.addEventListener("click", () => void this.plugin.openTag(tag.name).catch(error => new Notice(String(error))));
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
    if (this.projectLayout === "gantt") {
      const toggle = actions.createEl("label", { cls: "tm-completed-toggle" });
      const checkbox = toggle.createEl("input", { type: "checkbox" });
      checkbox.checked = this.showArchivedProjects;
      toggle.createSpan({ text: "Show archived projects" });
      checkbox.addEventListener("change", () => {
        this.showArchivedProjects = checkbox.checked;
        this.render();
      });
    }
    const create = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Create new project", title: "Create new project" } });
    setIcon(create, "plus");
    create.addEventListener("click", () => this.plugin.openProjectCreator());
    const projects = this.plugin.index.projects();
    const active = projects.filter((project) => !project.archived);
    const archived = projects.filter((project) => project.archived);
    if (!projects.length || (this.projectLayout === "gantt" && !active.length && !this.showArchivedProjects)) {
      const empty = container.createDiv({ cls: "tm-empty" });
      const icon = empty.createDiv({ cls: "tm-empty-icon" });
      setIcon(icon, "target");
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
        viewportChanged: anchor => { this.ganttAnchor = anchor; },
        open: project => { void this.plugin.openProject(project.path).catch(error => new Notice(String(error))); },
        edit: (project, field) => this.plugin.openProjectEditor(project.path, field),
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
    this.renderProjectGroup(container, "Archived", archived);
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
      renderProjectProgress(icon, project, false);
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      const button = primary.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path } });
      button.addEventListener("click", () => void this.plugin.openProject(project.path).catch(error => new Notice(String(error))));
      const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
      renderProjectHeaderDetails(metadata, project, property => this.plugin.openProjectEditor(project.path, property), this.plugin.dateFormat(), undefined, primary);
      if (!metadata.childElementCount) metadata.remove();
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
      const blank: Task = { id: "", path: this.taskSourcePath ?? this.plugin.settings.inboxPath, title: "", completed: false, line: 0, endLine: 0, raw: "", indent: 0, childIds: [] };
      this.plugin.openEditor({ ...this.state, preset: draftForGroup(blank, target) });
    });
  }

  private renderSection(container: HTMLElement, title: string, tasks: Task[], variant?: "alert", target?: ListDropGroup): void {
    if (!tasks.length && !target) return;
    const section = container.createEl("section", { cls: `tm-section${variant ? ` is-${variant}` : ""}` });
    const heading = section.createEl("h2");
    heading.createSpan({ text: title });
    if (this.plugin.settings.showGroupTaskCounts) heading.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
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
      const control = element?.closest?.("button, [role=button], input, label, a, select, textarea, .tm-calendar-task-title, .tm-calendar-resize-handle");
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
      // Consume the context gesture even if the row moved after press.
      // Consume the gesture across the view, even if its menu targets another row.
      if (!this.contextSelectionOnPress) selectForContextMenu(event);
      this.contextSelectionOnPress = false;
    });
    row.addEventListener("pointercancel", () => { this.contextSelectionOnPress = false; });
    row.addEventListener("click", event => {
      if ((Platform.isMacOS ? event.metaKey : event.ctrlKey) && this.selection.has(task)) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.selection.click(task, this.visibleTasks, false, true);
        this.updateSelection();
        return;
      }
      if (interactive(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      this.editTask(task);
    }, true);
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

  private showTaskProperty(property: TaskProperty): boolean {
    const kanban = this.state.mode !== "dashboard" && this.layout === "kanban";
    const hidden = kanban ? this.plugin.settings.hiddenKanbanTaskProperties : this.plugin.settings.hiddenListTaskProperties;
    return !(hidden ?? []).includes(property);
  }

  private get metadataGrouping(): TaskGrouping {
    if (this.layout === "calendar") return "none";
    if (this.grouping !== "default") return this.grouping;
    if (this.layout === "kanban" && !(this.state.mode === "all" && !this.taskSourcePath)) return "section";
    if (this.taskSourcePath) return "section";
    if (this.state.mode === "all") return "source";
    if (this.state.mode === "upcoming") return "date";
    return "none";
  }

  private renderTaskRow(list: HTMLElement, task: Task, depth: number, target?: ListDropGroup): void {
    const row = list.createDiv({ cls: `tm-task-row tm-task-item${task.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    this.bindSelection(row, task);
    const checkboxTarget = row.createEl("label", { cls: "tm-checkbox-target" });
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}`, attr: { "aria-label": `Complete ${task.title}${task.priority ? ` (priority ${task.priority})` : ""}` } });
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
    const title = primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title) } });
    title.addEventListener("click", () => this.editTask(task));
    renderDescriptionIndicator(primary, task.description);
    try {
      if (recurringFile(this.app, task)) {
        const icon = primary.createSpan({ cls: "tm-task-recurring", attr: { role: "img", "aria-label": "Recurring task", title: "Recurring task" } });
        setIcon(icon, "repeat-2");
      }
    } catch { /* Ambiguous recurring links remain editable through the task editor. */ }

    if (this.plugin.settings.showSubtaskCounts && task.childIds.length) {
      const children = task.childIds.map((id) => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child));
      primary.createSpan({ cls: "tm-progress", text: `${children.filter((child) => child.completed).length}/${children.length}` });
    }
    const metadata = content.createDiv({ cls: "tm-task-metadata" });
    const implicitSource = this.taskSourcePath ?? (this.state.mode === "inbox" ? this.plugin.settings.inboxPath : undefined);
    const tags = (task.tags ?? []).filter(tag => {
      if (this.state.mode !== "tags") return true;
      return this.pagePath ? this.app.metadataCache.getFirstLinkpathDest(tag, task.path)?.path !== this.pagePath : tag !== this.state.tag;
    });
    renderTaskDetails(primary, metadata, task, {
      grouping: this.metadataGrouping, show: property => this.showTaskProperty(property), dateFormat: this.plugin.dateFormat(),
      source: task.path !== implicitSource ? task.path : undefined, tags,
      edit: property => this.editTask(task, property), openSource: () => { void this.openSource(task); }
    });
    if (!metadata.childElementCount) metadata.remove();
    const menuButton = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": "Task actions" } });
    setIcon(menuButton, "more-horizontal");
    menuButton.addEventListener("click", (event) => this.openMenu(event, task));
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
    empty.createEl("p", { text: this.propertyFilters.length ? "No tasks match the current filters." : this.showCompleted ? "No tasks match this view." : "You're caught up. Completed tasks are hidden." });
  }
}
