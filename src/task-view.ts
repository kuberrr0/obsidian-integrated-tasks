import { taskTitleLabel } from "./task-title";
import { renderProjectProgress } from "./project-progress";
import { renderProjectHeaderDetails } from "./project-header-details";
import { renderTaskDetails } from "./task-row-details";
import { recurringFile } from "./recurring-task";
import { renderDashboard } from "./dashboard-view";
import { renderDescriptionIndicator } from "./task-description-indicator";
import { cloneTaskFilters } from "./task-filters";
import { renderPropertyFilter } from "./filter-editor";
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
import type { TaskFilter, Project, Task, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

// Large lists render in pages; more rows load as the "Show more" button scrolls into view.
const ROW_PAGE = 200;
// The first few lists (sections, board columns, dashboard cards) always show some rows,
// even after the shared page budget is spent, so no visible group looks empty.
const MIN_LIST_ROWS = 20;
const MIN_ROW_LISTS = 10;

/** What had focus before a re-render, so the same control can be focused afterwards. */
interface FocusKey { taskId?: string; index?: number; part?: string; key?: string }

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
  private rowsLeft = 0;
  private listsRendered = 0;
  /** Rows the user loaded per list, kept across re-renders so a list never shrinks under them. */
  private listRows = new Map<string, number>();
  private rowObservers: IntersectionObserver[] = [];
  private renderFrame?: number;
  private renderGeneration = 0;
  private closed = false;
  private preserving = false;
  private headerMetadata?: HTMLElement;
  private liveRegion?: HTMLElement;
  /** A moved task gets a new id (its line changes); focus it again by note and title. */
  private pendingFocus?: { path: string; title: string };
  private rovingRow?: HTMLElement;
  private moveTargets = new Map<string, { title: string; target: ListDropGroup }>();

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
      this.listRows.clear();
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
    this.unsubscribe = this.plugin.index.subscribe(() => this.scheduleRender());
    this.render();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    if (this.renderFrame !== undefined) this.containerEl.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = undefined;
    this.disconnectRowObservers();
  }

  private get content(): HTMLElement { return this.containerEl?.children[1] as HTMLElement; }

  /** Coalesce bursts of index updates into one refresh per frame. */
  private scheduleRender(): void {
    if (this.renderFrame !== undefined || this.closed) return;
    this.renderFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.renderFrame = undefined;
      if (!this.closed) this.refresh();
    });
  }

  /** Task changes redraw the results and project header only, keeping the filter panel and any half-built filter. */
  private refresh(): void {
    if (!this.taskResults?.isConnected || !this.headerMetadata) { this.render(); return; }
    this.preserveView(() => {
      this.renderHeaderMetadata();
      this.renderTaskResults();
    });
  }

  /** Re-rendering replaces every element; put focus and scroll positions back where they were. */
  private preserveView(update: () => void): void {
    const container = this.content;
    if (this.preserving || !container?.ownerDocument) { update(); return; }
    const active = container.ownerDocument.activeElement as HTMLElement | null;
    const focus = active && container.contains(active) ? this.focusKey(active) : undefined;
    const scrolled = [container, ...Array.from(container.querySelectorAll<HTMLElement>("[data-tm-scroll-key]"))]
      .map(element => ({ key: element === container ? "" : element.getAttribute("data-tm-scroll-key") ?? "", top: element.scrollTop, left: element.scrollLeft }));
    this.preserving = true;
    try { update(); } finally { this.preserving = false; }
    for (const { key, top, left } of scrolled) {
      const element = key ? container.querySelector<HTMLElement>(`[data-tm-scroll-key="${key}"]`) : container;
      if (element) { element.scrollTop = top; element.scrollLeft = left; }
    }
    const pending = this.pendingFocus;
    this.pendingFocus = undefined;
    let target: HTMLElement | null | undefined;
    if (pending) {
      const task = this.visibleTasks.find(item => item.path === pending.path && item.title === pending.title);
      target = task ? this.selectionRows.get(task.id)?.[0] : undefined;
    } else if (focus?.taskId !== undefined) {
      const rows = this.rowElements();
      const row = rows.find(item => item.getAttribute("data-task-id") === focus.taskId) ?? rows[Math.min(focus.index ?? 0, rows.length - 1)];
      target = focus.part ? row?.querySelector<HTMLElement>(`[data-tm-focus-key="${focus.part}"]`) ?? row : row;
    } else if (focus?.key) target = container.querySelector<HTMLElement>(`[data-tm-focus-key="${focus.key}"]`);
    target?.focus({ preventScroll: true });
  }

  private focusKey(element: HTMLElement): FocusKey | undefined {
    const part = element.closest("[data-tm-focus-key]")?.getAttribute("data-tm-focus-key") ?? undefined;
    const row = element.closest<HTMLElement>(".tm-task-item[data-task-id]");
    if (!row) return part ? { key: part } : undefined;
    return { taskId: row.getAttribute("data-task-id") ?? "", index: this.rowElements().indexOf(row), part: element === row ? undefined : part };
  }

  /** List and board rows in on-screen order. */
  private rowElements(): HTMLElement[] {
    return Array.from(this.content?.querySelectorAll?.<HTMLElement>(".tm-task-item[data-task-id]") ?? []);
  }

  private announce(message: string): void {
    if (this.liveRegion) this.liveRegion.setText(message);
  }

  private disconnectRowObservers(): void {
    for (const observer of this.rowObservers) observer.disconnect();
    this.rowObservers = [];
  }

  render(): void {
    this.preserveView(() => this.renderView());
  }

  private renderView(): void {
    const container = this.content;
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
    this.resetRows();
    this.taskResults = undefined;
    this.headerMetadata = undefined;
    this.liveRegion = container.createDiv({ cls: "tm-sr-only", attr: { "aria-live": "polite" } });
    container.addClass("tm-main-view");
    container.classList.toggle("is-dashboard-view", this.state.mode === "dashboard");
    const hover = this.plugin.settings.taskHoverHighlight ?? "none";
    container.classList.toggle("tm-hover-title", hover === "title" || hover === "all");
    container.classList.toggle("tm-hover-background", hover === "background" || hover === "all");
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
    this.updateRoving();
  }

  private resetRows(): void {
    this.disconnectRowObservers();
    this.renderGeneration++;
    this.rowsLeft = ROW_PAGE;
    this.listsRendered = 0;
    this.moveTargets.clear();
    this.rovingRow = undefined;
    this.visibleTasks = [];
    this.selectionRows.clear();
  }

  private renderTaskResults(): void {
    if (this.state.mode === "dashboard") { this.render(); return; }
    const container = this.taskResults;
    if (!container) return;
    this.preserveView(() => this.renderTaskResultsNow(container));
  }

  private renderTaskResultsNow(container: HTMLElement): void {
    container.empty();
    this.resetRows();
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
    this.updateRoving();
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
      for (const [path, group] of groupTasks(tasks, "source")) {
        this.renderSection(container, path.replace(/\.md$/i, ""), group, undefined, { destination: path });
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }

  private renderKanban(container: HTMLElement, tasks: Task[]): void {
    const columns = kanbanColumns(tasks, this.grouping === "default" && this.state.mode === "all" && !this.taskSourcePath ? "source" : this.grouping);
    if (!columns.length) { this.renderEmpty(container); return; }
    const board = container.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board", "data-tm-scroll-key": "kanban" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column", attr: { "data-tm-scroll-key": `kanban:${column.title}` } });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      const title = column.target?.property && ["date", "scheduledDate", "deadline"].includes(column.target.property) && typeof column.target.value === "string"
        ? formatDate(column.target.value, this.plugin.dateFormat()) : column.target?.property === "source" ? column.title.replace(/\.md$/i, "") : column.title;
      header.createEl("h2", { text: title });
      if (this.plugin.settings.showGroupTaskCounts) header.createSpan({ cls: "tm-section-count", text: String(column.tasks.length) });
      this.renderGroupAddButton(header, title, column.target);
      if (column.target) { this.listDrag?.group(section, column.target); this.addMoveTarget(title, column.target); }
      this.renderTaskList(section, column.tasks, column.target);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
  }

  private renderProjectSections(container: HTMLElement, path: string, tasks: Task[]): void {
    const headings = this.plugin.index.headingsForPath(path);
    // One pass: filtering per heading is quadratic in notes with hundreds of sections.
    const bySection = new Map<number | undefined, Task[]>();
    for (const task of tasks) {
      const group = bySection.get(task.sectionLine);
      if (group) group.push(task); else bySection.set(task.sectionLine, [task]);
    }
    const unsectioned = bySection.get(undefined) ?? [];
    this.addMoveTarget(path.replace(/\.md$/i, "").split("/").pop() ?? path, { destination: path });
    if (unsectioned.length || !headings.length) this.renderTaskList(container, unsectioned, { destination: path });
    for (const heading of headings) {
      const group = bySection.get(heading.line) ?? [];
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      if (this.plugin.settings.showGroupTaskCounts) title.createSpan({ cls: "tm-section-count", text: String(group.length) });
      const target = { destination: `${path}#${heading.name}` };
      this.renderGroupAddButton(title, heading.name, target);
      this.listDrag?.group(section, target);
      this.addMoveTarget(heading.name, target);
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
    this.headerMetadata = heading.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
    this.renderHeaderMetadata();

    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Task view layout" } });
    for (const [layout, icon, label] of [["list", "list", "List"], ["calendar", "calendar-days", "Calendar"], ["kanban", "columns-3", "Kanban"]] as const) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${label} view`, title: `${label} view`, "aria-pressed": String(this.layout === layout), "data-tm-focus-key": `layout-${layout}` } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.layout = layout; this.render(); });
    }
    const toggle = actions.createEl("button", { cls: "tm-filter-toggle clickable-icon", attr: { "aria-label": "View options: filter, sort, and group", "data-tm-focus-key": "view-options" } });
    const add = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Add task", title: "Add task", "data-tm-focus-key": "add-task" } });
    const icon = add.createSpan();
    setIcon(icon, "plus");
    add.addEventListener("click", () => this.plugin.openEditor(this.state));
    return toggle;
  }

  private renderHeaderMetadata(): void {
    const metadata = this.headerMetadata;
    if (!metadata) return;
    metadata.empty();
    const project = this.taskSourcePath ? this.plugin.index.projects().find(project => project.path === this.taskSourcePath) : undefined;
    metadata.hidden = !project;
    if (!project) return;
    renderProjectHeaderDetails(metadata, project, property => this.plugin.openProjectEditor(project.path, property), this.plugin.dateFormat());
    renderProjectProgress(metadata, project);
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
      const select = field.createEl("select", { attr: { "aria-label": label, "data-tm-focus-key": `option-${label}` } });
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
    const clear = menu.createEl("button", { text: "Clear all filters", attr: { "data-tm-focus-key": "clear-filters" } });
    clear.addEventListener("click", () => { this.propertyFilters = []; this.render(); });
    // Read lazily: the panel outlives task changes, so choices must reflect the current tasks.
    const allTasks = (): Task[] => this.plugin.index.allTasks();
    for (const property of TASK_PROPERTIES) {
      const active = this.propertyFilters.find(filter => filter.property === property.key);
      const submenu = menu.createDiv({ cls: "tm-property-submenu" });
      const summary = submenu.createSpan({ cls: "tm-property-name", text: `${property.label}${active ? " •" : ""}` });
      const panel = submenu.createDiv({ cls: "tm-property-conditions" });
      renderPropertyFilter(panel, property, active, allTasks, filter => {
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
    const search = container.createEl("input", { type: "search", cls: "tm-tag-search", attr: { placeholder: "Search tags…", "aria-label": "Search tags", "data-tm-focus-key": "tag-search" } });
    search.value = this.search;
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    // Outside the list: a list may only contain list items.
    const empty = container.createDiv({ cls: "tm-empty" });
    const render = (): void => {
      list.empty();
      const tags = this.plugin.index.tagSummaries().filter(tag => tag.name.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()));
      empty.hidden = tags.length > 0;
      empty.setText(this.search ? "No matching tags" : "No tags yet. Add a tag to a task to see it here.");
      for (const tag of tags) {
        const row = list.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
        const icon = row.createSpan({ cls: "tm-project-icon" });
        setIcon(icon, "tag");
        const content = row.createDiv({ cls: "tm-task-content" });
        const title = content.createEl("button", { cls: "tm-task-title", text: tag.name, attr: { "data-tm-focus-key": `tag:${tag.name}` } });
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
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${layout === "gantt" ? "Gantt" : "List"} projects view`, "aria-pressed": String(this.projectLayout === layout), title: `${layout === "gantt" ? "Gantt" : "List"} view`, "data-tm-focus-key": `project-layout-${layout}` } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.projectLayout = layout; this.render(); });
    }
    const create = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Create new project", title: "Create new project" } });
    setIcon(create, "plus");
    create.addEventListener("click", () => this.plugin.openProjectCreator());
    const projects = this.plugin.index.projects();
    const active = projects.filter((project) => !project.archived);
    const archived = projects.filter((project) => project.archived);
    if (!projects.length) {
      const empty = container.createDiv({ cls: "tm-empty" });
      const icon = empty.createDiv({ cls: "tm-empty-icon" });
      setIcon(icon, "target");
      empty.createEl("h3", { text: "No projects yet" });
      empty.createEl("p", { text: "Add #project to a note or include project in its frontmatter tags." });
      return;
    }
    if (this.projectLayout === "gantt") {
      renderGantt(container, {
        projects,
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
    if (target) { this.listDrag?.group(section, target); this.addMoveTarget(title, target); }
    this.renderTaskList(section, tasks, target);
  }

  private addMoveTarget(title: string, target: ListDropGroup): void {
    this.moveTargets.set(this.listKey(target), { title, target });
  }

  private listKey(target?: ListDropGroup): string {
    return target ? `${target.property ?? ""}|${target.value ?? ""}|${target.destination ?? ""}` : `list-${this.listsRendered}`;
  }

  private renderTaskList(container: HTMLElement, tasks: Task[], target?: ListDropGroup): void {
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    if (target) this.listDrag?.group(list, target);
    const key = this.listKey(target);
    const floor = this.listsRendered++ < MIN_ROW_LISTS ? MIN_LIST_ROWS : 0;
    const visibleIds = new Set(tasks.map((task) => task.id));
    const ordered = orderTaskTree(tasks);
    let rendered = 0;
    const renderRows = (count: number): HTMLElement | undefined => {
      const first = list.childElementCount;
      for (const task of ordered.slice(rendered, rendered + count)) this.renderTaskRow(list, task, this.depthWithin(task, visibleIds), target);
      rendered = Math.min(ordered.length, rendered + count);
      return list.children[first] as HTMLElement | undefined;
    };
    const initial = Math.min(ordered.length, Math.max(this.listRows.get(key) ?? 0, this.rowsLeft, floor));
    this.rowsLeft = Math.max(0, this.rowsLeft - initial);
    renderRows(initial);
    if (rendered < ordered.length) this.renderShowMore(container, key, () => ordered.length - rendered, count => {
      const before = rendered;
      const first = renderRows(count);
      this.listRows.set(key, rendered);
      // Shift-click ranges follow visibleTasks, which must stay in on-screen order.
      const row = (task: Task): HTMLElement | undefined => this.selectionRows.get(task.id)?.[0];
      this.visibleTasks.sort((left, right) => {
        const [a, b] = [row(left), row(right)];
        if (!a || !b || a === b) return 0;
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      this.updateSelection();
      this.updateRoving();
      this.announce(`Showing ${rendered - before} more tasks`);
      return first;
    });
  }

  private renderShowMore(container: HTMLElement, key: string, remaining: () => number, load: (count: number) => HTMLElement | undefined): void {
    const generation = this.renderGeneration;
    const more = container.createEl("button", { cls: "tm-show-more-tasks", attr: { type: "button", "data-tm-focus-key": `show-more:${key}` } });
    const label = (): void => { more.setText(`Show ${Math.min(ROW_PAGE, remaining())} more (${remaining()} hidden)`); };
    let observer: IntersectionObserver | undefined;
    const next = (): void => {
      // An observer entry queued before a re-render must not append rows to the new one.
      if (generation !== this.renderGeneration) return;
      const hadFocus = more.ownerDocument.activeElement === more;
      const first = load(ROW_PAGE);
      if (hadFocus) first?.focus({ preventScroll: true });
      if (remaining() > 0) { label(); return; }
      observer?.disconnect();
      more.remove();
    };
    label();
    more.addEventListener("click", next);
    if (typeof IntersectionObserver !== "undefined") {
      // The pane scrolls, not the window; without a root the prefetch margin never applies.
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) next(); }, { root: this.content, rootMargin: "600px" });
      observer.observe(more);
      this.rowObservers.push(observer);
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
      const resort = Boolean(anchor && placement) && (this.sort !== "source" || this.descending);
      if (anchor && placement) { this.sort = "source"; this.descending = false; }
      this.clearSelection();
      for (const path of paths) await this.plugin.index.refreshPath(path);
      // Index updates refresh the results; a new sort order also changes the filter panel.
      if (resort) this.render();
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
      // A hidden marker, not an aria-label: a label would replace the row's dates and tags for screen readers.
      const marker = row.querySelector?.(".tm-selected-marker");
      if (marker) marker.textContent = selected ? "Selected" : "";
    }
  }

  /** One row per view is in the tab order; arrow keys move between rows. */
  private updateRoving(): void {
    const rows = this.rowElements();
    const current = this.rovingRow?.isConnected ? this.rovingRow : rows[0];
    for (const row of rows) row.tabIndex = row === current ? 0 : -1;
    this.rovingRow = current;
  }

  private setRovingRow(row: HTMLElement): void {
    if (this.rovingRow === row) return;
    if (this.rovingRow) this.rovingRow.tabIndex = -1;
    row.tabIndex = 0;
    this.rovingRow = row;
  }

  private taskForRow(row: HTMLElement | undefined): Task | undefined {
    const id = row?.getAttribute("data-task-id");
    return id ? this.visibleTasks.find(task => task.id === id) : undefined;
  }

  private bindRowKeyboard(row: HTMLElement, task: Task, target?: ListDropGroup): void {
    // Controls inside a row join the tab order only while focus is in that row.
    const controls = Array.from(row.querySelectorAll<HTMLElement>("input, button, a, [role=button]"));
    for (const control of controls) control.tabIndex = -1;
    row.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight M");
    row.addEventListener("focusin", () => {
      this.setRovingRow(row);
      for (const control of controls) control.tabIndex = 0;
    });
    row.addEventListener("focusout", event => {
      if (row.contains(event.relatedTarget as Node | null)) return;
      for (const control of controls) control.tabIndex = -1;
    });
    row.addEventListener("keydown", event => {
      if (event.metaKey || event.ctrlKey || event.defaultPrevented) return;
      const key = event.key;
      if ((key === "m" || key === "M") && !event.altKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        this.openMoveMenu(task, row);
        return;
      }
      if (event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        this.moveWithKeyboard(task, row, key, target);
        return;
      }
      if (event.altKey || !["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
      const rows = this.rowElements();
      const index = rows.indexOf(row);
      const next = key === "ArrowUp" ? rows[index - 1] : key === "ArrowDown" ? rows[index + 1] : key === "Home" ? rows[0] : rows[rows.length - 1];
      event.preventDefault(); event.stopPropagation();
      if (!next || next === row) return;
      const nextTask = this.taskForRow(next);
      if (event.shiftKey && nextTask) {
        // Extend from the anchor; start a new range when this row is not selected.
        if (!this.selection.has(task)) this.selection.click(task, this.visibleTasks);
        this.selection.click(nextTask, this.visibleTasks, true);
        this.updateSelection();
      }
      next.focus();
    });
  }

  /** Keyboard counterpart of drag: Alt+Up/Down reorder among siblings, Alt+Right nests, Alt+Left outdents. */
  private moveWithKeyboard(task: Task, row: HTMLElement, key: string, target?: ListDropGroup): void {
    const siblings = Array.from(row.parentElement?.children ?? [])
      .map(element => this.taskForRow(element as HTMLElement))
      .filter((item): item is Task => Boolean(item) && item!.parentId === task.parentId);
    const index = siblings.findIndex(item => item.id === task.id);
    const nesting = this.layout !== "kanban" || this.state.mode === "dashboard";
    let anchor: Task | undefined;
    let placement: ListPlacement | undefined;
    if (key === "ArrowUp") { anchor = siblings[index - 1]; placement = "before"; }
    else if (key === "ArrowDown") { anchor = siblings[index + 1]; placement = "after"; }
    else if (key === "ArrowRight" && nesting) { anchor = siblings[index - 1]; placement = "child"; }
    else if (key === "ArrowLeft" && nesting && task.parentId) { anchor = this.plugin.index.taskById(task.parentId); placement = "after"; }
    if (!anchor || !placement) return;
    this.prepareDrag(task);
    this.pendingFocus = { path: task.path, title: task.title };
    void this.dropListTask(task, target, anchor, placement);
  }

  /** Keyboard counterpart of dropping onto another group or date: press M on a row. */
  private openMoveMenu(task: Task, row: HTMLElement): void {
    const menu = new Menu();
    const move = (group: ListDropGroup): void => {
      this.prepareDrag(task);
      this.pendingFocus = { path: task.path, title: task.title };
      void this.dropListTask(task, group);
    };
    for (const { title, target } of this.moveTargets.values()) {
      menu.addItem(item => item.setTitle(`Move to ${title}`).setIcon("arrow-right").onClick(() => move(target)));
    }
    if (this.moveTargets.size) menu.addSeparator();
    const today = todayIso();
    for (const [label, date] of [["Today", today], ["Tomorrow", addDays(today, 1)], ["Next week", addDays(today, 7)]] as const) {
      menu.addItem(item => item.setTitle(`Schedule for ${label.toLowerCase()}`).setIcon("calendar").onClick(() => move({ property: "scheduledDate", value: date })));
    }
    menu.addItem(item => item.setTitle("Remove dates").setIcon("calendar-x").onClick(() => move({ property: "date", value: undefined })));
    const rect = row.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
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
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}`, attr: { "aria-label": `Complete ${task.title}${task.priority ? ` (priority ${task.priority})` : ""}`, "data-tm-focus-key": "checkbox" } });
    checkbox.checked = task.completed;
    // Not `disabled`: disabling the focused checkbox would drop keyboard focus before the re-render restores it.
    let pending = false;
    checkbox.addEventListener("change", () => {
      if (pending) { checkbox.checked = !checkbox.checked; return; }
      pending = true;
      checkbox.setAttribute("aria-busy", "true");
      // Stays pending on success: the row is re-rendered from the updated note.
      void this.plugin.store.toggle(task, checkbox.checked).catch((cause: unknown) => {
        pending = false;
        checkbox.checked = !checkbox.checked;
        checkbox.removeAttribute("aria-busy");
        new Notice(cause instanceof Error ? cause.message : "Could not update the task.");
      });
    });
    const content = row.createDiv({ cls: "tm-task-content" });
    const primary = content.createDiv({ cls: "tm-task-primary" });
    this.listDrag?.row(row, primary, task, target);
    const title = primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title), "data-tm-focus-key": "title" } });
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
      grouping: this.metadataGrouping, dateFormat: this.plugin.dateFormat(),
      source: task.path !== implicitSource ? task.path : undefined, tags,
      edit: property => this.editTask(task, property), openSource: () => { void this.openSource(task); }
    });
    if (!metadata.childElementCount) metadata.remove();
    row.createSpan({ cls: "tm-sr-only tm-selected-marker" });
    this.bindRowKeyboard(row, task, target);
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
