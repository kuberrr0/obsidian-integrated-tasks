import { taskTitleLabel } from "./task-title";
import { renderProjectProgress } from "./project-progress";
import { renderProjectHeaderDetails } from "./project-header-details";
import { renderTaskDetails } from "./task-row-details";
import { renderThingsProjectDetails, renderThingsTaskDetails } from "./things-row-details";
import { animateCardClose, animateCardOpen, cardNotes, renderThingsTaskCard, type TaskCardDraft } from "./things-task-card";
import { isRepeatingTask, recurringFile } from "./recurring-task";
import { renderDashboard } from "./dashboard-view";
import { renderTodaySummary, todaySummary } from "./today-summary";
import { renderDescriptionIndicator } from "./task-description-indicator";
import { cloneTaskFilters } from "./task-filters";
import { ViewOptionsPanel } from "./view-options";
import type { TaskEditorProperty } from "./task-editor";
import { draftFromTask } from "./task-draft";
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
import { OPEN_STATUSES, STATUS_LABELS, TASK_STATUSES, checkboxLabel, statusClass } from "./task-status";
import { ItemView, Menu, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { actionDate, formatDate, parseDateExpression, todayIso } from "./date";
import { groupTasks, isDeferred, orderTaskTree, sortTasks } from "./query";
import type TaskManagerPlugin from "./main";
import type { TaskFilter, Project, Task, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping, TaskStatus, TaskProperty } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

// Large lists render in pages; more rows load as the "Show more" button scrolls into view.
const ROW_PAGE = 200;
// The first few lists (sections, board columns, dashboard cards) always show some rows,
// even after the shared page budget is spent, so no visible group looks empty.
const MIN_LIST_ROWS = 20;
const MIN_ROW_LISTS = 10;
// The weekly review lists undated tasks in notes unedited for this long.
const STALE_DAYS = 30;
// Swipe gestures on touch screens, in pixels.
const SWIPE_START = 12;
const SWIPE_COMMIT = 80;
const SWIPE_MAX = 120;
const STATUS_ICONS: Record<TaskStatus, string> = { todo: "circle", doing: "circle-dot", waiting: "clock", done: "circle-check", cancelled: "circle-slash" };

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
  smartLists: "Smart Lists",
  review: "Weekly Review"
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
  /** The task open as a card in the Things style, with its unsaved title and notes. */
  private expanded?: { id: string } & TaskCardDraft;
  /** What the card focuses on its next draw: a subtask's id, or "new" for the subtask being typed. */
  private cardFocus?: string;
  /** Height of the rows the open card replaced, which it shrinks back to when closing. */
  private cardRowsHeight = 0;
  /** Set while the card plays its closing animation. */
  private cardClosing?: Promise<void>;
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
  private summaryTimer?: number;
  private viewOptions?: ViewOptionsPanel;

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
    this.registerDomEvent(this.containerEl.ownerDocument, "click", event => { this.clearSelectionOutside(event); this.collapseCardOutside(event); }, true);
    this.registerDomEvent(this.containerEl.ownerDocument, "pointerdown", event => this.viewOptions?.handleOutside(event));
    // Obsidian's own undo only covers the editor; in task views Cmd/Ctrl+Z undoes the last task change.
    this.registerDomEvent(this.containerEl, "keydown", event => {
      const key = event.key.toLowerCase();
      if (!(Platform.isMacOS ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey || (key !== "z" && key !== "k")) return;
      if ((event.target as HTMLElement | null)?.closest?.("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      if (key === "k") this.plugin.openQuickSwitcher();
      else void this.plugin.undoTaskChange();
    });
    this.unsubscribe = this.plugin.index.subscribe(() => this.scheduleRender());
    this.render();
  }

  async onClose(): Promise<void> {
    await this.saveCard();
    this.expanded = undefined;
    this.closed = true;
    this.unsubscribe?.();
    this.stopSummaryTimer();
    if (this.renderFrame !== undefined) this.containerEl.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = undefined;
    this.disconnectRowObservers();
  }

  private get content(): HTMLElement { return this.containerEl?.children[1] as HTMLElement; }

  /** Coalesce bursts of index updates into one refresh per frame. */
  private scheduleRender(): void {
    // A closing card refreshes the view itself once its animation ends.
    if (this.renderFrame !== undefined || this.closed || this.cardClosing) return;
    this.renderFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.renderFrame = undefined;
      if (!this.closed && !this.cardClosing) this.refresh();
    });
  }

  /** Task changes redraw the results and project header only, keeping the filter panel and any half-built filter. */
  private refresh(): void {
    if (!this.taskResults?.isConnected || !this.headerMetadata) { this.render(); return; }
    this.preserveView(() => {
      this.renderHeaderMetadata();
      this.renderTaskResults();
      // Tag, note and section choices come from the current tasks.
      this.viewOptions?.sync();
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
    this.viewOptions = undefined;
    this.liveRegion = container.createDiv({ cls: "tm-sr-only", attr: { "aria-live": "polite" } });
    container.addClass("tm-main-view");
    container.classList.toggle("is-dashboard-view", this.state.mode === "dashboard");
    const hover = this.plugin.settings.taskHoverHighlight ?? "none";
    container.classList.toggle("tm-hover-title", hover === "title" || hover === "all");
    container.classList.toggle("tm-hover-background", hover === "background" || hover === "all");
    const wrapTitles = this.state.mode === "dashboard" ? this.plugin.settings.wrapTaskTitles : this.layout === "calendar" ? this.plugin.settings.wrapCalendarTaskTitles
      : this.layout === "kanban" ? this.plugin.settings.wrapKanbanTaskTitles : this.plugin.settings.wrapTaskTitles;
    container.classList.toggle("tm-wrap-task-titles", wrapTitles);
    container.classList.toggle("tm-density-compact", this.plugin.settings.density === "compact");
    container.classList.toggle("tm-style-things", this.plugin.settings.style === "things");
    container.classList.toggle("is-calendar-view", this.layout === "calendar" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    container.classList.toggle("is-kanban-view", this.layout === "kanban" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    if (this.state.mode === "dashboard") {
      container.classList.remove("is-calendar-view", "is-kanban-view");
      this.renderTaskDashboard(container);
      return;
    }
    if (this.state.mode === "review") {
      container.classList.remove("is-calendar-view", "is-kanban-view");
      this.renderWeeklyReview(container);
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
        renderTodaySummary(card, todaySummary(this.plugin.index.query({ mode: "today", showCompleted: true })), false);
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
          color: task => this.plugin.settings.calendarProjectColors ? this.plugin.index.projectColor(task.path) : undefined,
          priorityColors: this.plugin.settings.calendarPriorityColors,
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

  /**
   * A checklist for the weekly review: each section lists tasks or projects to look at,
   * and can be marked reviewed for the current week (collapsing it).
   */
  private renderWeeklyReview(container: HTMLElement): void {
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), true, task => this.prepareDrag(task));
    const today = todayIso();
    const week = addDays(today, -((new Date().getDay() + 6) % 7));
    const saved = this.plugin.settings.weeklyReview;
    const reviewed = new Set(saved?.week === week ? saved.reviewed : []);
    const tasks = this.plugin.index.allTasks();
    const open = tasks.filter(task => !task.completed);
    const staleBefore = Date.now() - STALE_DAYS * 86_400_000;
    const modified = new Map<string, number>();
    const noteModified = (path: string): number => {
      if (!modified.has(path)) {
        const file = this.app.vault.getAbstractFileByPath(path);
        modified.set(path, file instanceof TFile ? file.stat?.mtime ?? Date.now() : Date.now());
      }
      return modified.get(path)!;
    };
    const repeating = (task: Task): boolean => isRepeatingTask(this.app, task);
    const hasNextAction = new Set(open.filter(task => !isDeferred(task, today)).map(task => task.path));
    const sections: Array<{ id: string; title: string; hint: string; empty: string; tasks?: Task[]; projects?: Project[] }> = [
      { id: "completed", title: "Completed this week", hint: "What you finished in the last 7 days.",
        empty: this.plugin.settings.completionDates ? "Nothing completed in the last 7 days." : "Turn on Record completion dates in settings to see what you finished.",
        tasks: tasks.filter(task => task.status === "done" && task.completedDate !== undefined && task.completedDate > addDays(today, -7) && task.completedDate <= today) },
      { id: "overdue", title: "Overdue", hint: "Reschedule, finish, or let go of these.", empty: "Nothing is overdue.",
        tasks: open.filter(task => !isDeferred(task, today) && (actionDate(task) ?? today) < today && !repeating(task)) },
      { id: "waiting", title: "Waiting", hint: "Follow up on these.", empty: "Nothing is waiting on someone else.",
        tasks: open.filter(task => task.status === "waiting") },
      { id: "routines", title: "Routines behind", hint: "Repeating tasks past their date.", empty: "All routines are up to date.",
        tasks: open.filter(task => repeating(task) && task.scheduledDate !== undefined && task.scheduledDate < today) },
      { id: "deadlines", title: "Deadlines in the next 7 days", hint: "Make time for these before they're due.", empty: "No deadlines this week.",
        tasks: open.filter(task => task.deadline !== undefined && task.deadline >= today && task.deadline <= addDays(today, 7)) },
      { id: "stale", title: "Untouched for a month", hint: `Undated tasks in notes nobody has edited for ${STALE_DAYS} days.`, empty: "No stale tasks.",
        tasks: open.filter(task => !actionDate(task) && !task.someday && !task.deferDate && noteModified(task.path) < staleBefore) },
      { id: "projects", title: "Projects without a next action", hint: "Add a next step, or archive the project.", empty: "Every active project has a next action.",
        projects: this.plugin.index.projects().filter(project => !project.archived && !hasNextAction.has(project.path)) },
      { id: "someday", title: "Someday", hint: "Anything here ready to schedule or delete?", empty: "No someday tasks.",
        tasks: open.filter(task => task.someday) }
    ];

    const header = container.createDiv({ cls: "tm-view-header" });
    const title = header.createDiv({ cls: "tm-title-group" }).createDiv();
    title.createEl("h1", { text: "Weekly Review" });
    const progress = title.createDiv({ cls: "tm-task-metadata tm-review-progress" });
    progress.createSpan({ text: `Week of ${formatDate(week, this.plugin.dateFormat())}` });
    progress.createSpan({ text: `${sections.filter(section => reviewed.has(section.id)).length} of ${sections.length} reviewed` });
    const actions = header.createDiv({ cls: "tm-header-actions" });
    const restart = actions.createEl("button", { text: "Start over", attr: { "data-tm-focus-key": "review-restart" } });
    restart.disabled = !reviewed.size;
    const save = async (next: Set<string>): Promise<void> => {
      this.plugin.settings.weeklyReview = { week, reviewed: [...next] };
      await this.plugin.saveSettings();
      this.render();
    };
    restart.addEventListener("click", () => void save(new Set()).catch(error => new Notice(String(error))));

    const visible: Task[] = [];
    for (const section of sections) {
      const done = reviewed.has(section.id);
      const element = container.createEl("section", { cls: `tm-section tm-review-section${done ? " is-reviewed" : ""}` });
      const heading = element.createEl("h2");
      heading.createSpan({ text: section.title });
      heading.createSpan({ cls: "tm-section-count", text: String(section.tasks?.length ?? section.projects?.length ?? 0) });
      const check = heading.createEl("label", { cls: "tm-review-check" });
      const box = check.createEl("input", { type: "checkbox", attr: { "data-tm-focus-key": `review:${section.id}` } });
      box.checked = done;
      check.createSpan({ text: "Reviewed" });
      box.addEventListener("change", () => {
        const next = new Set(reviewed);
        if (box.checked) next.add(section.id); else next.delete(section.id);
        void save(next).catch(error => new Notice(String(error)));
      });
      if (done) continue;
      element.createDiv({ cls: "tm-filter-hint", text: section.hint });
      const count = section.tasks?.length ?? section.projects?.length ?? 0;
      if (!count) { element.createDiv({ cls: "tm-empty tm-review-empty", text: section.empty }); continue; }
      if (section.projects) this.renderProjectGroup(element, "", section.projects, false);
      else { this.renderTaskList(element, section.tasks!); visible.push(...section.tasks!); }
    }
    this.selection.retain(visible);
    this.updateSelection();
    this.updateRoving();
  }

  private renderTaskResults(): void {
    if (this.state.mode === "dashboard" || this.state.mode === "review") { this.render(); return; }
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
        color: task => this.plugin.settings.calendarProjectColors ? this.plugin.index.projectColor(task.path) : undefined,
        priorityColors: this.plugin.settings.calendarPriorityColors,
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
          const paths = await this.plugin.store.bulkChange(selected, original => rescheduledDraft(original, date, time), {}, `Rescheduled ${selected.length === 1 ? `“${selected[0].title}”` : `${selected.length} tasks`}`);
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
        // Date groupings are keyed by ISO date; show them in the user's format.
        const title = ["date", "scheduledDate", "deadline", "defer"].includes(this.grouping) && /^\d{4}-\d{2}-\d{2}$/.test(key)
          ? `${this.grouping === "defer" ? "Hidden until " : ""}${formatDate(key, this.plugin.dateFormat())}`
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
      const title = column.target?.property && ["date", "scheduledDate", "deadline", "defer"].includes(column.target.property) && typeof column.target.value === "string"
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
    const today = this.state.mode === "today" && !this.taskSourcePath;
    const project = this.taskSourcePath ? this.plugin.index.projects().find(project => project.path === this.taskSourcePath) : undefined;
    metadata.hidden = !project && !today;
    if (today) {
      renderTodaySummary(metadata, todaySummary(this.plugin.index.query({ mode: "today", showCompleted: true })));
      this.startSummaryTimer();
    } else this.stopSummaryTimer();
    if (!project) return;
    // The header's source label names the parent project, so it takes the parent's colour.
    const parentColor = project.parentPath ? this.plugin.index.projectColor(project.parentPath) : undefined;
    if (parentColor) metadata.style.setProperty("--tm-project-color", parentColor);
    else metadata.style.removeProperty("--tm-project-color");
    renderProjectHeaderDetails(metadata, project, property => this.plugin.openProjectEditor(project.path, property), this.plugin.dateFormat());
    renderProjectProgress(metadata, project);
  }

  /** Keeps the Today header's "next task" countdown current between task changes. */
  private startSummaryTimer(): void {
    const win = this.containerEl?.win;
    if (this.summaryTimer !== undefined || !win) return;
    this.summaryTimer = win.setInterval(() => { if (this.headerMetadata?.isConnected) this.renderHeaderMetadata(); else this.stopSummaryTimer(); }, 30_000);
  }

  private stopSummaryTimer(): void {
    if (this.summaryTimer !== undefined) this.containerEl?.win?.clearInterval(this.summaryTimer);
    this.summaryTimer = undefined;
  }

  private renderFilters(container: HTMLElement, toggle: HTMLButtonElement): void {
    this.viewOptions = new ViewOptionsPanel(toggle.closest<HTMLElement>(".tm-view-header") ?? container, toggle, {
      state: () => ({ sort: this.sort, descending: this.descending, grouping: this.grouping, filters: this.propertyFilters }),
      update: change => {
        if (change.sort !== undefined) this.sort = change.sort;
        if (change.descending !== undefined) this.descending = change.descending;
        if (change.grouping !== undefined) this.grouping = change.grouping;
        if (change.filters !== undefined) this.propertyFilters = change.filters;
        this.renderTaskResults();
      },
      clear: () => {
        this.propertyFilters = [];
        this.sort = "date"; this.descending = false; this.grouping = "default";
        this.renderTaskResults();
      },
      // Read lazily: the panel outlives task changes, so choices must reflect the current tasks.
      tasks: () => this.plugin.index.allTasks(),
      expanded: () => this.filtersExpanded,
      setExpanded: open => { this.filtersExpanded = open; }
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
      const things = this.plugin.settings.style === "things";
      for (const tag of tags) {
        const row = list.createDiv({ cls: `tm-task-row tm-project-row${things ? " tm-things-project-row tm-things-tag-row" : ""}`, attr: { role: "listitem" } });
        const icon = row.createSpan({ cls: "tm-project-icon" });
        setIcon(icon, "tag");
        const content = row.createDiv({ cls: "tm-task-content" });
        // Things: one line, with the open count boxed after the name and the completed count at the end.
        const line = things ? content.createDiv({ cls: "tm-task-primary" }) : content;
        const title = line.createEl("button", { cls: "tm-task-title", text: tag.name, attr: { "data-tm-focus-key": `tag:${tag.name}` } });
        title.addEventListener("click", () => void this.plugin.openTag(tag.name).catch(error => new Notice(String(error))));
        if (!things) { content.createDiv({ cls: "tm-task-metadata", text: `${tag.openTasks} open · ${tag.completedTasks} completed` }); continue; }
        if (tag.openTasks) line.createSpan({ cls: "tm-things-count", text: String(tag.openTasks), attr: { title: `${tag.openTasks} open` } });
        if (tag.completedTasks) line.createSpan({ cls: "tm-things-trailing tm-things-tag-done", text: `${tag.completedTasks} completed` });
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
          await this.plugin.store.updateFrontmatter(file, (frontmatter: Record<string, unknown>) => updateProjectDates(frontmatter, changes, project, this.plugin.dateFormat()), `Changed dates of “${project.name}”`);
          await this.plugin.index.refreshPath(project.path);
        }
      });
      return;
    }
    this.renderProjectGroup(container, "Active", active);
    this.renderProjectGroup(container, "Archived", archived);
  }

  private renderProjectGroup(container: HTMLElement, title: string, projects: Project[], heading = true): void {
    if (!projects.length) return;
    const section = heading ? container.createEl("section", { cls: "tm-section" }) : container;
    if (heading) section.createEl("h2", { text: title }).createSpan({ cls: "tm-section-count", text: String(projects.length) });
    const list = section.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    for (const { project, depth } of projectHierarchy(projects)) {
      const things = this.plugin.settings.style === "things";
      const row = list.createDiv({ cls: `tm-task-row tm-project-row${things ? " tm-things-project-row" : ""}`, attr: { role: "listitem" } });
      row.style.setProperty("--tm-depth", String(depth));
      const icon = row.createSpan({ cls: "tm-project-icon" });
      renderProjectProgress(icon, project, false);
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      const lead = things ? primary.createSpan({ cls: "tm-things-lead" }) : undefined;
      const button = primary.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path } });
      button.addEventListener("click", () => void this.plugin.openProject(project.path).catch(error => new Notice(String(error))));
      if (lead) {
        const secondary = content.createDiv({ cls: "tm-things-secondary" });
        renderThingsProjectDetails({ lead, inline: primary, secondary }, project, { dateFormat: this.plugin.dateFormat(), edit: field => this.plugin.openProjectEditor(project.path, field) });
        if (!lead.childElementCount) lead.remove();
        if (!secondary.childElementCount) secondary.remove();
        continue;
      }
      const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
      const parentColor = project.parentPath ? this.plugin.index.projectColor(project.parentPath) : undefined;
      if (parentColor) metadata.style.setProperty("--tm-project-color", parentColor);
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
      const blank: Task = { id: "", path: this.taskSourcePath ?? this.plugin.settings.inboxPath, title: "", status: "todo", completed: false, line: 0, endLine: 0, raw: "", indent: 0, childIds: [] };
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
    // An open card lists its subtasks itself.
    const inCard = this.expandedDescendants();
    const ordered = orderTaskTree(tasks).filter(task => !inCard.has(task.id));
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
    // Clicking any task row changes the selection itself, so only clicks elsewhere clear it.
    const target = event.target as HTMLElement | null;
    const onRow = Array.from(this.selectionRows.values()).some(rows => rows.some(row => target && row.contains(target)));
    if (!onRow) this.clearSelection();
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

  /** A selected task drags the whole selection along; returns what moves. */
  private prepareDrag(task: Task): Task[] {
    this.draggedTasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
    return this.draggedTasks;
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
    // Titles select like the rest of the row; other controls keep their own click action.
    const title = (target: EventTarget | null): boolean => Boolean((target as HTMLElement | null)?.closest?.(".tm-task-title, .tm-calendar-task-title"));
    const control = (target: EventTarget | null): boolean => interactive(target) && !title(target);
    const selectForContextMenu = (event: MouseEvent): void => {
      const additive = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (!this.selection.has(task) || event.shiftKey || additive) {
        this.selection.click(task, this.visibleTasks, event.shiftKey, additive);
      }
      row.focus({ preventScroll: true });
      this.updateSelection();
    };
    // Right-clicking a task that was already selected edits the selection's properties.
    let selectedBeforeContext = false;
    const plainContext = (event: MouseEvent): boolean => !event.shiftKey && !event.altKey && !(Platform.isMacOS ? event.metaKey : event.ctrlKey);
    // Select on press: contextmenu may wait for release or the native menu gesture.
    row.addEventListener("pointerdown", event => {
      this.contextSelectionOnPress = event.button === 2 || (Platform.isMacOS && event.button === 0 && event.ctrlKey);
      if (this.contextSelectionOnPress) {
        selectedBeforeContext = this.selection.has(task);
        selectForContextMenu(event);
      }
    });
    // Also support keyboard context-menu requests and other non-pointer input.
    row.addEventListener("contextmenu", event => {
      // Consume the context gesture even if the row moved after press.
      // Consume the gesture across the view, even if its menu targets another row.
      if (!this.contextSelectionOnPress) {
        selectedBeforeContext = this.selection.has(task);
        selectForContextMenu(event);
      }
      this.contextSelectionOnPress = false;
      if (selectedBeforeContext && plainContext(event) && this.selection.has(task)) {
        event.preventDefault();
        this.plugin.openBulkEditor(this);
      }
      selectedBeforeContext = false;
    });
    row.addEventListener("pointercancel", () => { this.contextSelectionOnPress = false; });
    // A click selects: alone, or with Cmd/Ctrl to toggle and Shift for a range.
    row.addEventListener("click", event => {
      if (Platform.isMacOS && event.ctrlKey) return;
      const additive = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (!additive && !event.shiftKey && control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      this.selection.click(task, this.visibleTasks, event.shiftKey, additive);
      row.focus({ preventScroll: true });
      this.updateSelection();
    }, true);
    // A double-click opens the task's editor.
    row.addEventListener("dblclick", event => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      this.selection.clear();
      this.selection.click(task, this.visibleTasks);
      this.updateSelection();
      this.openTask(task);
    }, true);
    row.addEventListener("keydown", event => {
      this.contextSelectionOnPress = false;
      if (interactive(event.target)) return;
      if (event.key === "Escape") { event.preventDefault(); this.clearSelection(); }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        // Things opens a lone task as a card; a multi-selection still edits its properties together.
        if (this.plugin.settings.style === "things" && this.getSelectedTasks().length <= 1) this.openTask(task);
        else this.editTask(task);
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
    row.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight M S");
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
      if ((key === "s" || key === "S") && !event.altKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        // To do → in progress → waiting → to do; a closed task reopens as to do.
        const next = OPEN_STATUSES[(OPEN_STATUSES.indexOf(task.status) + 1) % OPEN_STATUSES.length];
        this.setStatus(task, next);
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
    menu.addSeparator();
    // Snoozing hides a task from Inbox, Today and Upcoming until the date (see isDeferred).
    for (const [label, value] of [["Snooze until tomorrow", addDays(today, 1)], ["Snooze until next week", addDays(today, 7)], ["Snooze to someday", "Someday"]] as const) {
      menu.addItem(item => item.setTitle(label).setIcon("alarm-clock-off").onClick(() => move({ property: "defer", value })));
    }
    if (task.deferDate || task.someday) menu.addItem(item => item.setTitle("Stop snoozing").setIcon("alarm-clock").onClick(() => move({ property: "defer", value: undefined })));
    menu.addSeparator();
    for (const status of TASK_STATUSES) {
      if (status !== task.status) menu.addItem(item => item.setTitle(`Mark as ${STATUS_LABELS[status].toLowerCase()}`).setIcon(STATUS_ICONS[status]).onClick(() => this.setStatus(task, status)));
    }
    const rect = row.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  /** Applies to the whole selection when the task is selected, like the move menu. */
  private setStatus(task: Task, status: TaskStatus): void {
    const tasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
    this.pendingFocus = { path: task.path, title: task.title };
    void this.plugin.store.setStatus(tasks, status).then(async paths => {
      for (const path of paths) await this.plugin.index.refreshPath(path);
      this.announce(`${tasks.length === 1 ? taskTitleLabel(task.title) : `${tasks.length} tasks`}: ${STATUS_LABELS[status].toLowerCase()}`);
    }).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not update the task."); });
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
    if (this.expanded?.id === task.id && this.plugin.settings.style === "things") { this.renderTaskCard(list, task, depth); return; }
    const row = list.createDiv({ cls: `tm-task-row tm-task-item${task.completed ? " is-completed" : ""}${task.status === "cancelled" ? " is-cancelled" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    this.bindSelection(row, task);
    const checkboxTarget = row.createEl("label", { cls: "tm-checkbox-target" });
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task), "data-tm-focus-key": "checkbox" } });
    // A cancelled task shows checked, so clicking it reopens it (to do).
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
    // A project's colour marks its tasks' source label and board card; its own page needs no marker.
    const color = this.plugin.index.projectColor(task.path);
    if (color && task.path !== this.taskSourcePath) {
      row.addClass("has-project-color");
      row.style.setProperty("--tm-project-color", color);
    }
    const things = this.plugin.settings.style === "things";
    const lead = things ? primary.createSpan({ cls: "tm-things-lead" }) : undefined;
    const title = primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title), "data-tm-focus-key": "title" } });
    title.addEventListener("click", () => this.editTask(task));
    renderDescriptionIndicator(primary, task.description);
    try {
      // Routine-note repeats get an icon; inline `every …` repeats show a Repeat pill in the details instead.
      if (recurringFile(this.app, task)) {
        const icon = primary.createSpan({ cls: "tm-task-recurring", attr: { role: "img", "aria-label": "Recurring task", title: "Recurring task" } });
        setIcon(icon, "repeat-2");
      }
    } catch { /* Ambiguous recurring links remain editable through the task editor. */ }

    if (this.plugin.settings.showSubtaskCounts && task.childIds.length) {
      const children = task.childIds.map((id) => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child) && child!.status !== "cancelled");
      primary.createSpan({ cls: "tm-progress", text: `${children.filter((child) => child.status === "done").length}/${children.length}` });
    }
    const metadata = content.createDiv({ cls: things ? "tm-things-secondary" : "tm-task-metadata" });
    const implicitSource = this.taskSourcePath ?? (this.state.mode === "inbox" ? this.plugin.settings.inboxPath : undefined);
    const tags = this.rowTags(task);
    const details = {
      grouping: this.metadataGrouping, dateFormat: this.plugin.dateFormat(), show: (property: TaskProperty) => property !== "defer",
      source: task.path !== implicitSource ? task.path : undefined, tags,
      edit: (property: TaskEditorProperty) => this.editTask(task, property), openSource: () => { void this.openSource(task); }
    };
    if (lead) {
      renderThingsTaskDetails({ lead, inline: primary, secondary: metadata }, task, { ...details, todayMarker: this.state.mode !== "today" });
      if (!lead.childElementCount) lead.remove();
    } else renderTaskDetails(primary, metadata, task, details);
    if (!metadata.childElementCount) metadata.remove();
    row.createSpan({ cls: "tm-sr-only tm-selected-marker" });
    this.bindRowKeyboard(row, task, target);
    this.bindSwipe(row, task, checkbox);
  }

  /** A task page or tag list leaves out the tag it is showing. */
  private rowTags(task: Task): string[] {
    return (task.tags ?? []).filter(tag => {
      if (this.state.mode !== "tags") return true;
      return this.pagePath ? this.app.metadataCache.getFirstLinkpathDest(tag, task.path)?.path !== this.pagePath : tag !== this.state.tag;
    });
  }

  /** Double-click or Enter: a card in place in the Things style, the task editor otherwise. */
  private openTask(task: Task): void {
    if (this.plugin.settings.style === "things") void this.expandCard(task);
    else this.plugin.openEditor({ ...this.state, task });
  }

  private async expandCard(task: Task): Promise<void> {
    await this.cardClosing;
    if (this.expanded?.id === task.id) return;
    await this.saveCard();
    const fresh = this.plugin.index.taskById(task.id) ?? task;
    this.expanded = { id: fresh.id, title: fresh.title, notes: cardNotes(fresh.description) };
    // The card takes the place of the row and its subtask rows; it grows out of the space they filled.
    const replaced = [fresh.id, ...this.expandedDescendants()];
    const from = this.rowElements().filter(row => replaced.includes(row.getAttribute("data-task-id") ?? ""))
      .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
    this.cardRowsHeight = from;
    this.clearSelection();
    this.renderTaskResults();
    const card = this.content?.querySelector<HTMLElement>(".tm-things-card");
    card?.querySelector<HTMLTextAreaElement>(".tm-things-card-title")?.focus({ preventScroll: true });
    if (card && from) animateCardOpen(card, from);
  }

  /**
   * Saves the card, shrinks it back into the space its rows take, then shows the rows.
   * Refreshes wait until it has closed, so the save cannot redraw the card mid-animation.
   */
  private collapseCard(): Promise<void> {
    if (this.cardClosing || !this.expanded) return this.cardClosing ?? Promise.resolve();
    const id = this.expanded.id;
    this.cardClosing = (async () => {
      await this.saveCard();
      const card = this.content?.querySelector<HTMLElement>(".tm-things-card");
      if (card) await animateCardClose(card, this.cardRowsHeight || card.querySelector(".tm-things-card-head")!.getBoundingClientRect().height + 10);
      this.expanded = undefined;
      this.refresh();
      this.content?.querySelector<HTMLElement>(`.tm-task-row[data-task-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    })().finally(() => { this.cardClosing = undefined; });
    return this.cardClosing;
  }

  /** Writes the card's title and notes when they changed; the card stays open. */
  private async saveCard(): Promise<void> {
    const card = this.expanded;
    const task = card && this.plugin.index.taskById(card.id);
    if (!card || !task) return;
    const title = card.title.trim() || task.title;
    const notes = card.notes.trim() === cardNotes(task.description).trim() ? undefined : card.notes;
    if (title === task.title && notes === undefined) return;
    try {
      await this.plugin.store.update(task, { ...draftFromTask(task), title, description: notes });
      await this.plugin.index.refreshPath(task.path);
      if (this.expanded?.id === card.id) this.expanded = { ...this.expanded, title, notes: notes ?? this.expanded.notes };
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not save the task.");
    }
  }

  /** Clicking anywhere outside the card (except a dialog or menu it opened) closes it. */
  private collapseCardOutside(event: MouseEvent): void {
    if (!this.expanded || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".tm-things-card, .modal-container, .menu, .suggestion-container")) return;
    void this.collapseCard();
  }

  /** Subtasks of the open card, at any depth. */
  private expandedDescendants(): Set<string> {
    const ids = new Set<string>();
    if (!this.expanded || this.plugin.settings.style !== "things") return ids;
    const visit = (id: string): void => {
      for (const child of this.plugin.index.taskById(id)?.childIds ?? []) if (!ids.has(child)) { ids.add(child); visit(child); }
    };
    visit(this.expanded.id);
    return ids;
  }

  private renderTaskCard(list: HTMLElement, task: Task, depth: number): void {
    const expanded = this.expanded!;
    const focus = this.cardFocus;
    this.cardFocus = undefined;
    renderThingsTaskCard(list, {
      task, depth, draft: expanded, tags: this.rowTags(task), focus,
      childDetails: child => ({
        grouping: "none", dateFormat: this.plugin.dateFormat(), show: property => property !== "defer", tags: this.rowTags(child),
        todayMarker: this.state.mode !== "today", edit: property => void this.editFromCard(child.id, property), openSource: () => {}
      }),
      children: task.childIds.map(id => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child)),
      change: draft => { if (this.expanded?.id === task.id) this.expanded = { id: task.id, ...draft }; },
      toggle: (item, completed) => {
        void this.plugin.store.toggle(item, completed).catch((cause: unknown) => {
          new Notice(cause instanceof Error ? cause.message : "Could not update the task.");
        });
      },
      edit: property => void this.editFromCard(task.id, property),
      collapse: () => void this.collapseCard(),
      renameChild: (child, title) => {
        void this.plugin.store.update(child, { ...draftFromTask(child), title })
          .then(() => this.plugin.index.refreshPath(child.path))
          .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not rename the subtask."); });
      },
      addChild: (title, after, next) => void this.addCardSubtask(task.id, title, after, next)
    });
  }

  /** Writes a subtask typed in the card; after Enter, a fresh one opens right below it, like a Things checklist. */
  private async addCardSubtask(parentId: string, title: string, after: Task | undefined, next: boolean): Promise<void> {
    const parent = this.plugin.index.taskById(parentId);
    if (!parent) return;
    try {
      await this.plugin.store.addSubtask(parent, title, after);
      await this.plugin.index.refreshPath(parent.path);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not add the subtask.");
      return;
    }
    if (!next || this.expanded?.id !== parentId || this.cardClosing) return;
    // The new subtask sits right after `after` (or last); the next one starts after it.
    const children = this.plugin.index.taskById(parentId)?.childIds ?? [];
    const added = after ? children[children.indexOf(after.id) + 1] : children[children.length - 1];
    this.expanded = { ...this.expanded, subtask: { after: added, text: "" } };
    this.cardFocus = "new";
    this.renderTaskResults();
  }

  /** Saves the card first, so the property editor works on the task as it now reads. */
  private async editFromCard(id: string, property: TaskEditorProperty): Promise<void> {
    await this.saveCard();
    const task = this.plugin.index.taskById(id);
    if (task) this.plugin.openEditor({ ...this.state, task, focusProperty: property });
  }

  /**
   * Touch gestures on a row: swipe right to complete (or reopen), left to snooze until tomorrow.
   * Only horizontal touch drags count; vertical movement scrolls as usual and mouse input is ignored.
   */
  private bindSwipe(row: HTMLElement, task: Task, checkbox: HTMLInputElement): void {
    let start: { x: number; y: number; id: number } | undefined;
    let offset = 0;
    let swiping = false;
    let suppressClick = false;
    const reset = (): void => {
      start = undefined; swiping = false; offset = 0;
      row.removeClass("is-swiping", "is-swipe-armed");
      row.removeAttribute("data-swipe");
      row.style.removeProperty("--tm-swipe-offset");
    };
    row.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch" || (event.target as HTMLElement).closest("input")) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    });
    row.addEventListener("pointermove", event => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!swiping) {
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) { reset(); return; }
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 2) return;
        swiping = true;
        row.setPointerCapture?.(event.pointerId);
        row.addClass("is-swiping");
      }
      event.preventDefault();
      offset = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
      row.style.setProperty("--tm-swipe-offset", `${offset}px`);
      row.setAttribute("data-swipe", offset > 0 ? (task.completed ? "reopen" : "complete") : "snooze");
      row.toggleClass("is-swipe-armed", Math.abs(offset) >= SWIPE_COMMIT);
    });
    // Keep Obsidian's own mobile swipe gestures (such as opening a sidebar) from also reacting.
    row.addEventListener("touchmove", event => { if (swiping) { event.stopPropagation(); event.preventDefault(); } }, { passive: false });
    row.addEventListener("pointerup", event => {
      if (!start || event.pointerId !== start.id) return;
      const committed = swiping ? offset : 0;
      if (swiping) suppressClick = true;
      reset();
      if (committed >= SWIPE_COMMIT) {
        checkbox.checked = !task.completed;
        checkbox.dispatchEvent(new Event("change"));
      } else if (committed <= -SWIPE_COMMIT) {
        this.prepareDrag(task);
        void this.dropListTask(task, { property: "defer", value: addDays(todayIso(), 1) });
      }
    });
    row.addEventListener("pointercancel", reset);
    row.addEventListener("click", event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
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
