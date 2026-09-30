import { taskTitleLabel } from "./task-title";
import { renderProjectProgress } from "./project-progress";
import { renderProjectHeaderDetails } from "./project-header-details";
import { editable, renderTaskDetails } from "./task-row-details";
import { renderThingsProjectDetails, renderThingsTaskDetails } from "./things-row-details";
import { animateCardClose, animateCardOpen, cardNotes, renderThingsCardProperties, renderThingsTaskCard, repeatIcon, type TaskCardDraft } from "./things-task-card";
import { isRepeatingTask, recurringFile } from "./recurring-task";
import { renderDashboard } from "./dashboard-view";
import { renderTodaySummary, todaySummary } from "./today-summary";
import { cloneTaskFilters } from "./task-filters";
import { ViewOptionsPanel } from "./view-options";
import type { TaskEditorProperty } from "./task-editor";
import type { ProjectDraft } from "./project-creator";
import { draftFromTask, draftFromTitle, draftMatchesTask } from "./task-draft";
import { nextWeek, openDatePopover } from "./date-popover";
import { openActionMenu, openTagsPopover, openTaskMenu, priorityIcons } from "./task-menu";
import { openConfirm } from "./confirm-modal";
import { openChoicePopover, PRIORITY_CHOICES, projectChoices, repeatChoices, REPEAT_INPUT, type Choice, type ChoiceInput } from "./choice-popover";
import type { BulkTaskPatch } from "./bulk-tasks";
import { parseTaskInput } from "./parser";
import { TaskSelection } from "./task-selection";
import { PROJECT_COLORS, projectColorValue, updateProjectDates } from "./project-properties";
import { renderGantt } from "./gantt-view";
import type { GanttZoom } from "./gantt";
import { projectHierarchy } from "./project-hierarchy";
import { kanbanColumns } from "./kanban";
import { ListDragController } from "./list-drag-view";
import { draftForGroup, isStructuralGroup, taskGroupTarget, type ListDropGroup, type ListPlacement } from "./list-drag";
import { renderCalendar } from "./calendar-view";
import { addDays, rescheduledDraft, type CalendarScope } from "./calendar";
import { STATUS_ICONS, STATUS_LABELS, TASK_STATUSES, checkboxLabel, statusClass } from "./task-status";
import { ItemView, Menu, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { actionDate, formatDate, parseDateExpression, todayIso } from "./date";
import { groupTasks, isDeferred, orderTaskTree, sortTasks } from "./query";
import type TaskManagerPlugin from "./main";
import type { OpenEditorState } from "./main";
import type { TaskFilter, Project, Task, TaskDraft, TaskEditorPreset, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping, TaskStatus, TaskProperty } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";
/** What a new task's card is called in its note until a title is typed, as Things names a new to-do. */
const NEW_TASK_TITLE = "New To-Do";

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
/** Two taps on a task this close together open it. */
const DOUBLE_TAP_MS = 350;

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

/**
 * A page's title, looking as a note's inline title does in the theme: the heading sits at the note text size, so
 * the theme's inline title size (usually in em) comes out as it does in a note, whatever size the view's text is.
 */
function pageTitle(parent: HTMLElement, text: string): HTMLElement {
  const heading = parent.createEl("h1", { cls: "tm-page-title" });
  heading.createSpan({ text });
  return heading;
}

export class TaskMainView extends ItemView {
  private state: TaskViewState = { mode: "today" };
  /** Whether `setState` has run, so the title names the view's list rather than its starting one. */
  private stateSet = false;
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
  // Double taps, recognised from clicks: the pointer that pressed last, the last tap, and when a double tap opened a task.
  private lastPointer = "";
  private lastTap?: { id: string; at: number };
  private tapOpenedAt = 0;
  private visibleTasks: Task[] = [];
  private selectionRows = new Map<string, HTMLElement[]>();
  private draggedTasks: Task[] = [];
  private rowsLeft = 0;
  private listsRendered = 0;
  /** Rows the user loaded per list, kept across re-renders so a list never shrinks under them. */
  private listRows = new Map<string, number>();
  /** Folded groups ("group:…") and tasks ("task:…"); saved with the view, reset on another page. */
  private folded = new Set<string>();
  private rowObservers: IntersectionObserver[] = [];
  private renderFrame?: number;
  private renderGeneration = 0;
  private closed = false;
  private preserving = false;
  private headerMetadata?: HTMLElement;
  private liveRegion?: HTMLElement;
  /** A moved task gets a new id (its line changes); focus it again by note and title. */
  private pendingFocus?: { path: string; title: string };
  /** The card of a task Create new task (or an Add task button) just added; closing it untouched removes the task. */
  private newCardId?: string;
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
    // Before its state arrives the view is no particular list yet (it starts as Today).
    if (!this.stateSet) return "Tasks";
    if (this.state.mode === "smartLists" && this.state.smartListId) return this.plugin.settings.smartLists.find(list => list.id === this.state.smartListId)?.name ?? "Smart list not found";
    if (this.state.mode === "tags" && this.state.tag) return this.state.tag;
    if (this.pagePath) return this.pagePath.replace(/\.md$/i, "").split("/").pop() ?? "Project";
    return TITLES[this.state.mode];
  }
  getIcon(): string { return this.state.mode === "projects" ? "target" : "circle-check-big"; }
  getState(): Record<string, unknown> { return { ...this.state, folded: [...this.folded], layout: this.layout, projectLayout: this.projectLayout, ganttAnchor: this.ganttAnchor, ganttZoom: this.ganttZoom, calendar: this.layout === "calendar", calendarScope: this.calendarScope, calendarAnchor: this.calendarAnchor }; }

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
      this.folded.clear();
    }
    if (Array.isArray(state.folded)) this.folded = new Set(state.folded.filter((key): key is string => typeof key === "string"));
    if (typeof mode === "string" && mode in TITLES) this.state.mode = mode as TaskViewMode;
    this.state.smartListId = typeof state.smartListId === "string" ? state.smartListId : undefined;
    this.state.tag = typeof state.tag === "string" && state.tag ? state.tag : undefined;
    this.state.pagePath = typeof state.pagePath === "string" ? state.pagePath : undefined;
    this.state.markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState as Record<string, unknown> : undefined;
    this.state.projectPath = typeof state.projectPath === "string" ? state.projectPath : undefined;
    // File-backed task views must participate in normal same-tab navigation.
    this.navigation = Boolean(this.pagePath);
    this.stateSet = true;
    this.render();
    this.refreshTitle();
  }

  /**
   * Obsidian reads a view's title once, while loading it, before its state arrives: refresh the view header's title,
   * the tab's label and the window title from the state just set. All three are Obsidian's own (internal) parts,
   * skipped if they are ever gone.
   */
  private refreshTitle(): void {
    (this as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
    (this.leaf as { updateHeader?: () => void } | undefined)?.updateHeader?.();
    (this.app?.workspace as { updateTitle?: () => void } | undefined)?.updateTitle?.();
  }

  async onOpen(): Promise<void> {
    this.registerDomEvent(this.containerEl.ownerDocument, "click", event => { this.clearSelectionOutside(event); this.collapseCardOutside(event); }, true);
    this.registerDomEvent(this.containerEl.ownerDocument, "pointerdown", event => this.viewOptions?.handleOutside(event));
    // Obsidian's own undo only covers the editor; in task views Cmd/Ctrl+Z undoes the last task change.
    this.registerDomEvent(this.containerEl, "keydown", event => {
      const key = event.key.toLowerCase();
      if (event.shiftKey || event.altKey || event.defaultPrevented) return;
      // Typing in a field (a card's title or notes, a search) keeps its own keys.
      if ((event.target as HTMLElement | null)?.closest?.("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) return;
      const mod = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      const selected = this.getSelectedTasks();
      // Delete or Backspace deletes the selected tasks (with their subtasks); Cmd/Ctrl+Z brings them back.
      if ((key === "delete" || key === "backspace") && selected.length && (mod || (!event.metaKey && !event.ctrlKey))) {
        event.preventDefault();
        void this.commit(async () => { const paths = await this.plugin.store.bulkDelete(selected); this.clearSelection(); return paths; }, "Could not delete the tasks.", false);
        return;
      }
      if (!mod) return;
      if (key === "k") { event.preventDefault(); this.plugin.openQuickSwitcher(); }
      else if (key === "z") { event.preventDefault(); void this.plugin.undoTaskChange(); }
      // Selects every task the view shows (folded subtasks stay out, as they have no row).
      else if (key === "a" && this.visibleTasks.length) { event.preventDefault(); this.selection.select(this.visibleTasks); this.updateSelection(); }
      else if (key === "c" && selected.length) { event.preventDefault(); void this.copyTasks(selected); }
      else if (key === "v") { event.preventDefault(); void this.pasteTasks(); }
      else if (key === "d" && selected.length) { event.preventDefault(); void this.commit(() => this.plugin.store.duplicate(selected), "Could not duplicate the tasks."); }
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
    pageTitle(title, "Weekly Review");
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
      // Grouped by the property the list is sorted on, a descending sort also turns the groups around.
      for (const [key, group] of groupTasks(tasks, this.grouping, this.descending && this.sort === this.grouping)) {
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
    // With every task under a heading, an empty list still waits above the first one, so a task can be
    // dragged there (above all headings); it takes no space until a drag opens its gap.
    this.renderTaskList(container, unsectioned, { destination: path }, Boolean(headings.length && !unsectioned.length));
    for (const heading of headings) {
      const group = bySection.get(heading.line) ?? [];
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      const target = { destination: `${path}#${heading.name}` };
      this.renderGroupAddButton(title, heading.name, target);
      this.listDrag?.group(section, target);
      this.addMoveTarget(heading.name, target);
      if (!this.renderGroupFold(section, title, `group:${path}#${heading.name}`, heading.name)) this.renderTaskList(section, group, target);
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
    const titleRow = heading.createDiv({ cls: "tm-title-row" });
    pageTitle(titleRow, this.getDisplayText());
    const project = this.taskSourcePath ? this.plugin.index.projects().find(project => project.path === this.taskSourcePath) : undefined;
    if (project) {
      const more = titleRow.createEl("button", { cls: "clickable-icon tm-title-more", attr: { type: "button", "aria-label": "Project actions", title: "Project actions", "aria-haspopup": "menu", "data-tm-focus-key": "project-actions" } });
      setIcon(more, "more-horizontal");
      more.addEventListener("click", event => { event.stopPropagation(); this.openProjectMenu(project, more); });
    }
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
    add.addEventListener("click", () => this.newTask());
    return toggle;
  }

  /**
   * A new task in this view's context: its tag, its project, or today's (or tomorrow's) date, and a group's value
   * when added from the group's heading (`preset`). In the Things style a list or board opens it as a blank card
   * in place, in its group or column, as Things does; otherwise the task editor opens.
   */
  newTask(preset?: TaskEditorPreset): void {
    const state = preset ? { ...this.state, preset } : this.state;
    // Lists and boards show a card in place; the calendar has no room for one.
    const list = this.layout !== "calendar" && !this.propertyFilters.length && (Boolean(this.taskSourcePath) || ["inbox", "today", "upcoming", "all", "tags"].includes(this.state.mode));
    if (this.plugin.settings.style === "things" && list) void this.newTaskCard(state);
    else this.plugin.openEditor(state);
  }

  /** Writes the new task at once (titled "New To-Do" in its note) and opens its card with the title empty to type. */
  private async newTaskCard(state: OpenEditorState): Promise<void> {
    await this.collapseCard();
    const draft: TaskDraft = { ...this.plugin.newTaskDraft(state), title: NEW_TASK_TITLE };
    const path = draft.destination.split("#")[0];
    try {
      const line = await this.plugin.store.create(draft);
      await this.plugin.index.refreshPath(path);
      const task = this.plugin.index.tasksForPath(path).find(item => item.line === line);
      if (!task) return;
      this.newCardId = task.id;
      await this.expandCard(task, true);
      // A view that does not list the new task cannot show its card: edit it in the task editor instead.
      if (!this.content?.querySelector(".tm-things-card")) {
        this.expanded = undefined;
        this.newCardId = undefined;
        this.plugin.openEditor({ ...this.state, task });
      }
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not add the task.");
    }
  }

  /** Closing a new task's card with nothing typed (no title, notes or subtasks) removes the task again. */
  private async discardNewCard(): Promise<boolean> {
    const card = this.expanded;
    if (!card || card.id !== this.newCardId) return false;
    this.newCardId = undefined;
    const task = this.plugin.index.taskById(card.id);
    if (!task || card.title.trim() || card.notes.trim() || task.childIds.length) return false;
    try {
      await this.plugin.store.delete(task);
      await this.plugin.index.refreshPath(task.path);
      return true;
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not remove the empty task.");
      return false;
    }
  }

  /** The Open project actions command: the menu below the project title's "…" button. */
  openProjectActions(): void {
    const project = this.taskSourcePath ? this.plugin.index.projects().find(item => item.path === this.taskSourcePath) : undefined;
    const button = this.content?.querySelector<HTMLElement>(".tm-title-more");
    if (project && button) this.openProjectMenu(project, button);
  }

  private projectDraft(project: Project): ProjectDraft { return this.plugin.projectDraft(project); }

  /** Saves a change to a project's properties; a failure shows as a notice. */
  private updateProject(project: Project, change: (draft: ProjectDraft) => ProjectDraft): void {
    void this.plugin.updateProject(project.path, change).catch((cause: unknown) => {
      new Notice(cause instanceof Error ? cause.message : "Could not update the project.");
    });
  }

  /**
   * The project's actions, like a task's: priority at once; dates, parent, tags, colour and name in popovers
   * beside the menu; archive, open its note, or delete it.
   */
  private openProjectMenu(project: Project, anchor: HTMLElement, at?: { x: number; y: number }): void {
    const rect = anchor.getBoundingClientRect();
    const beside = (property: keyof ProjectDraft) => (target: HTMLElement): void => this.openProjectProperty(project, property, target, true, () => menu.close());
    // The button reads as pressed while its menu is open.
    anchor.setAttribute("aria-expanded", "true");
    const menu = openActionMenu({
      doc: anchor.ownerDocument, at: at ?? { x: rect.left, y: rect.bottom + 4 }, label: "Project actions", returnFocus: anchor,
      onClose: () => anchor.setAttribute("aria-expanded", "false"),
      entries: [
        { kind: "icons", label: "Priority", key: "p", buttons: priorityIcons(project.priority, priority => this.updateProject(project, draft => ({ ...draft, priority: priority ? String(priority) : "" }))) },
        { kind: "separator" },
        { kind: "submenu", label: "Start date", icon: "calendar", key: "d", open: beside("date") },
        { kind: "submenu", label: "End date", icon: "calendar-check", key: "e", open: beside("endDate") },
        { kind: "submenu", label: "Deadline", icon: "flag", key: "D", open: beside("deadline") },
        { kind: "submenu", label: "Parent project", icon: "folder-tree", key: "g", open: beside("parent") },
        { kind: "submenu", label: "Tags", icon: "tag", key: "t", open: beside("tags") },
        { kind: "submenu", label: "Color", icon: "palette", key: "c", open: beside("color") },
        { kind: "submenu", label: "Rename", icon: "pencil", key: "n", open: beside("name") },
        { kind: "separator" },
        { kind: "item", label: project.archived ? "Unarchive project" : "Archive project", icon: project.archived ? "archive-restore" : "archive",
          run: () => this.updateProject(project, draft => ({ ...draft, archived: !project.archived })) },
        { kind: "item", label: "Open note", icon: "file-text", run: () => {
          const file = this.app.vault.getAbstractFileByPath(project.path);
          if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
        } },
        { kind: "separator" },
        { kind: "item", label: "Delete project", icon: "trash-2", danger: true, run: () => this.confirmDeleteProject(project) }
      ]
    });
  }

  private confirmDeleteProject(project: Project): void {
    const tasks = project.openTasks + project.completedTasks;
    openConfirm(this.app, {
      title: `Delete “${project.name}”?`,
      message: `Its note${tasks ? `, with ${tasks} task${tasks === 1 ? "" : "s"},` : ""} moves to the trash. Subprojects keep their notes.`,
      confirm: "Delete project", danger: true,
      run: () => void this.plugin.deleteProject(project.path).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not delete the project."); })
    });
  }

  /** A project property's popover beside `anchor` (the property itself, or a menu row): a date, priority, parent, tags, colour or name. */
  private openProjectProperty(project: Project, property: keyof ProjectDraft, anchor = this.popoverAnchor() ?? this.content, beside = false, done?: () => void): void {
    if (!anchor) return;
    const current = this.projectDraft(project);
    const save = (change: (draft: ProjectDraft) => ProjectDraft): void => { done?.(); this.updateProject(project, change); };
    if (property === "date" || property === "endDate" || property === "deadline") {
      const label = property === "date" ? "Start date" : property === "endDate" ? "End date" : "Deadline";
      const value = property === "date" ? project.scheduledDate : property === "endDate" ? project.endDate : project.deadline;
      openDatePopover({
        anchor, beside, kind: "date", label, dateFormat: this.plugin.dateFormat(), value: { date: value },
        // The note stores dates in the vault's format; the editor reads ISO dates too.
        save: next => save(draft => ({ ...draft, [property]: next.date ?? "" }))
      });
    } else if (property === "priority") {
      openChoicePopover({ anchor, beside, label: "Priority", choices: PRIORITY_CHOICES, cycleKey: "p", selected: current.priority, choose: value => save(draft => ({ ...draft, priority: value })) });
    } else if (property === "parent") {
      // Not the project itself, nor one of its subprojects: a project cannot sit inside itself.
      const projects = this.plugin.index.projects();
      const inside = (candidate: Project): boolean => {
        for (let path: string | undefined = candidate.path, depth = 0; path && depth < 50; depth++) {
          if (path === project.path) return true;
          path = projects.find(item => item.path === path)?.parentPath;
        }
        return false;
      };
      const choices: Choice[] = projects.filter(item => !item.archived && !inside(item)).sort((a, b) => a.name.localeCompare(b.name))
        .map(item => ({ value: item.path, label: item.name, icon: "circle", color: item.color }));
      choices.push({ value: "", label: "No parent", separated: true });
      openChoicePopover({ anchor, beside, label: "Parent project", choices, selected: current.parent, input: { placeholder: "Find a project", filter: true },
        choose: value => save(draft => ({ ...draft, parent: value })) });
    } else if (property === "tags") {
      const own = current.tags.split(/[,\s]+/).filter(Boolean);
      // Other projects' tags are the ones to offer.
      const vault = [...new Set(this.plugin.index.projects().filter(item => item.path !== project.path)
        .flatMap(item => this.projectDraft(item).tags.split(/[,\s]+/)).filter(tag => tag && !own.includes(tag)))].sort((a, b) => a.localeCompare(b));
      let tags = own;
      const write = (): void => this.updateProject(project, draft => ({ ...draft, tags: tags.join(", ") }));
      openTagsPopover({
        anchor, beside, tags: [...own.map(name => ({ name, state: "all" as const })), ...vault.map(name => ({ name, state: "none" as const }))],
        // Frontmatter tags have no spaces: a typed "open house" becomes "open-house".
        toggle: (tag, on) => { tags = on ? [...new Set([...tags, tag])] : tags.filter(item => item !== tag); write(); },
        add: added => { tags = [...new Set([...tags, ...added.map(tag => tag.replace(/\s+/g, "-"))])]; write(); }
      });
    } else if (property === "color") {
      const choices: Choice[] = PROJECT_COLORS.map(color => ({ value: color, label: color[0].toUpperCase() + color.slice(1), icon: "circle", color: projectColorValue(color) }));
      choices.push({ value: "", label: "No color", separated: true });
      openChoicePopover({
        anchor, beside, label: "Color", choices, selected: current.color,
        input: { placeholder: "Find a color, or type a hex such as #3b82f6", filter: true,
          parse: text => /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) ? { value: `#${text.replace(/^#/, "").toLowerCase()}`, label: `Use #${text.replace(/^#/, "").toLowerCase()}` } : undefined },
        choose: value => save(draft => ({ ...draft, color: value }))
      });
    } else if (property === "name") {
      openChoicePopover({
        anchor, beside, label: "Rename project", choices: [],
        input: { placeholder: project.name, invalid: "", parse: text => text && text !== project.name ? { value: text, label: `Rename to “${text}”` } : undefined },
        choose: name => save(draft => ({ ...draft, name }))
      });
    }
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
    renderProjectHeaderDetails(metadata, project, property => this.openProjectProperty(project, property), this.plugin.dateFormat(), undefined, undefined, this.plugin.settings.style === "things");
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

  /** What the View default grouping groups this view's tasks by (see renderTaskLayouts and kanbanColumns). */
  private defaultGroupLabel(): string {
    if (this.layout === "calendar") return "None";
    if (this.layout === "kanban") return this.state.mode === "all" && !this.taskSourcePath ? "Note" : "Section";
    if (this.taskSourcePath) return "Section";
    if (this.state.mode === "today") return "Overdue and today";
    if (this.state.mode === "upcoming") return "Action date";
    if (this.state.mode === "all") return "Note";
    return "None";
  }

  private renderFilters(container: HTMLElement, toggle: HTMLButtonElement): void {
    this.viewOptions = new ViewOptionsPanel(toggle.closest<HTMLElement>(".tm-view-header") ?? container, toggle, {
      state: () => ({
        sort: this.sort, descending: this.descending, grouping: this.grouping, filters: this.propertyFilters,
        // Completed tasks are left out unless shown (boards show them in their own columns) or a status filter asks.
        openOnly: !(this.showCompleted || this.layout === "kanban"), defaultGroup: this.defaultGroupLabel()
      }),
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
    pageTitle(header, "Smart Lists");
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
    pageTitle(container, "Tags");
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
    pageTitle(title, "Projects");
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
        anchor: this.ganttAnchor, zoom: this.ganttZoom, dateFormat: this.plugin.dateFormat(), things: this.plugin.settings.style === "things",
        navigate: (anchor, zoom) => { this.ganttAnchor = anchor; this.ganttZoom = zoom; this.render(); },
        viewportChanged: anchor => { this.ganttAnchor = anchor; },
        open: project => { void this.plugin.openProject(project.path).catch(error => new Notice(String(error))); },
        edit: (project, field) => this.openProjectProperty(project, field),
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
      // Right-click opens the project's actions, as it does a task's.
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        this.openProjectMenu(project, button, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
      });
      if (lead) {
        const secondary = content.createDiv({ cls: "tm-things-secondary" });
        renderThingsProjectDetails({ lead, inline: primary, secondary }, project, { dateFormat: this.plugin.dateFormat(), edit: field => this.openProjectProperty(project, field), datesBelow: Platform.isMobile });
        if (!lead.childElementCount) lead.remove();
        if (!secondary.childElementCount) secondary.remove();
        continue;
      }
      const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
      renderProjectHeaderDetails(metadata, project, property => this.openProjectProperty(project, property), this.plugin.dateFormat(), undefined, primary, false, false);
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
      this.newTask(draftForGroup(blank, target));
    });
  }

  private renderSection(container: HTMLElement, title: string, tasks: Task[], variant?: "alert", target?: ListDropGroup): void {
    if (!tasks.length && !target) return;
    const section = container.createEl("section", { cls: `tm-section${variant ? ` is-${variant}` : ""}` });
    const heading = section.createEl("h2");
    heading.createSpan({ text: title });
    this.renderGroupAddButton(heading, title, target);
    if (target) { this.listDrag?.group(section, target); this.addMoveTarget(title, target); }
    if (!this.renderGroupFold(section, heading, `group:${title}`, title)) this.renderTaskList(section, tasks, target);
  }

  /** Folds a group from a chevron before its heading; returns whether it is folded (its tasks then stay hidden). */
  private renderGroupFold(section: HTMLElement, heading: HTMLElement, key: string, title: string): boolean {
    if (this.layout === "kanban") return false;
    const folded = this.folded.has(key);
    section.toggleClass("is-folded", folded);
    const button = heading.createEl("button", { cls: "clickable-icon tm-fold-toggle tm-group-fold", attr: {
      type: "button", "aria-expanded": String(!folded), "aria-label": `${folded ? "Unfold" : "Fold"} ${title}`, title: folded ? "Unfold" : "Fold", "data-tm-focus-key": `fold:${key}`
    } });
    setIcon(button, "chevron-right");
    button.addEventListener("click", event => { event.stopPropagation(); this.toggleFold(key); });
    heading.prepend(button);
    return folded;
  }

  private toggleFold(key: string): void {
    if (!this.folded.delete(key)) this.folded.add(key);
    // Saved with the view (getState), so folds survive a reload.
    this.app.workspace.requestSaveLayout?.();
    this.renderTaskResults();
  }

  private taskFoldKey(task: Task): string { return `task:${task.path}#${task.title}`; }

  private addMoveTarget(title: string, target: ListDropGroup): void {
    this.moveTargets.set(this.listKey(target), { title, target });
  }

  private listKey(target?: ListDropGroup): string {
    return target ? `${target.property ?? ""}|${target.value ?? ""}|${target.destination ?? ""}` : `list-${this.listsRendered}`;
  }

  private renderTaskList(container: HTMLElement, tasks: Task[], target?: ListDropGroup, dropOnly = false): void {
    const list = container.createDiv({ cls: `tm-task-list${dropOnly ? " tm-drop-only" : ""}`, attr: { role: "list" } });
    if (target) this.listDrag?.group(list, target);
    const key = this.listKey(target);
    const floor = this.listsRendered++ < MIN_ROW_LISTS ? MIN_LIST_ROWS : 0;
    const visibleIds = new Set(tasks.map((task) => task.id));
    // An open card lists its subtasks itself; a folded task hides its subtasks (boards show every card).
    const inCard = this.expandedDescendants();
    // With subtasks off, a subtask whose task is in the list lives in that task's card instead of a row.
    const showSubtasks = this.plugin.settings.showSubtasks;
    const foldable = this.layout !== "kanban" && showSubtasks;
    const parents = new Set(foldable ? tasks.filter(task => task.childIds.some(id => visibleIds.has(id))).map(task => task.id) : []);
    const hidden = new Set<string>();
    const hide = (task: Task): void => {
      for (const id of task.childIds) if (visibleIds.has(id) && !hidden.has(id)) { hidden.add(id); const child = this.plugin.index.taskById(id); if (child) hide(child); }
    };
    for (const task of tasks) if (parents.has(task.id) && this.folded.has(this.taskFoldKey(task))) hide(task);
    const ordered = orderTaskTree(tasks).filter(task => !inCard.has(task.id) && !hidden.has(task.id) && (showSubtasks || !task.parentId || !visibleIds.has(task.parentId)));
    let rendered = 0;
    const renderRows = (count: number): HTMLElement | undefined => {
      const first = list.childElementCount;
      for (const task of ordered.slice(rendered, rendered + count)) this.renderTaskRow(list, task, this.depthWithin(task, visibleIds), target, parents.has(task.id));
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
      // A board column for a property value takes the task at its own place in its note; a column for a
      // note or section is a place in the note, so the drop's position there is kept.
      if (this.layout === "kanban" && group && !isStructuralGroup(group) && selected.some(task => {
        const previous = group.property ? taskGroupTarget(group.property, task) : undefined;
        return group.value !== previous?.value || (group.destination && group.destination !== draftForGroup(task).destination);
      })) {
        originalAnchor = undefined;
        placement = undefined;
      }
      const anchor = originalAnchor ? this.plugin.index.taskById(originalAnchor.id) : undefined;
      if (originalAnchor && (!anchor || anchor.raw !== originalAnchor.raw)) throw new Error("Drop target changed while dragging. Refresh and try again.");
      // The moved tasks stay selected when they were; dragging an unselected task leaves the selection alone.
      const kept = this.getSelectedTasks();
      const moved = selected.every(task => kept.some(item => item.id === task.id));
      const paths = await this.plugin.store.bulkDrop(selected, group, anchor, placement);
      const resort = Boolean(anchor && placement) && (this.sort !== "source" || this.descending);
      if (anchor && placement) { this.sort = "source"; this.descending = false; }
      for (const path of paths) await this.plugin.index.refreshPath(path);
      const moveTo = anchor ? anchor.path : group?.destination ? group.destination.split("#")[0] : undefined;
      if (moved) this.reselect(kept, moveTo);
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
    // Working in the task menu or a popover edits the selection; it does not end it.
    if (target?.closest?.(".tm-task-menu, .tm-date-popover, .tm-choice-popover, .tm-tags-popover")) return;
    const onRow = Array.from(this.selectionRows.values()).some(rows => rows.some(row => target && row.contains(target)));
    if (!onRow) this.clearSelection();
  }

  private editTask(task: Task, focusProperty?: TaskEditorProperty): void {
    if (!this.selection.has(task)) this.clearSelection();
    const tasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
    // A property edits in a popover beside it, for the whole selection.
    if (focusProperty && this.openPropertyEditor(tasks, focusProperty)) return;
    // Several selected tasks open their menu; one task opens its editor.
    if (tasks.length > 1) {
      const row = this.selectionRows.get(task.id)?.[0];
      const rect = row?.getBoundingClientRect();
      if (row && rect) this.openTaskMenu(task, row, { x: rect.left + 24, y: rect.bottom });
    }
    else if (focusProperty) this.plugin.openEditor({ ...this.state, task, focusProperty });
    else this.plugin.openEditor({ ...this.state, task });
  }

  /** The Edit task properties command: the selection's menu, below its first row. */
  openSelectionMenu(): void {
    const [task] = this.getSelectedTasks();
    const row = task && this.selectionRows.get(task.id)?.[0];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    this.openTaskMenu(task, row, { x: rect.left + 24, y: rect.bottom });
  }

  /**
   * The right-click menu, for the selection when the task is selected: complete, dates and priority at once,
   * project, deadline, tags, repeat, snooze and status in popovers beside it, duplicate and delete.
   */
  private openTaskMenu(task: Task, row: HTMLElement, at: { x: number; y: number }): void {
    const tasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
    const first = tasks[0];
    if (!first) return;
    const shared = <T>(value: (task: Task) => T): T | undefined => tasks.every(item => value(item) === value(first)) ? value(first) : undefined;
    const today = todayIso();
    const menu = openTaskMenu({
      doc: row.ownerDocument, at, today, returnFocus: row,
      completed: tasks.every(item => item.completed),
      scheduled: shared(item => item.scheduledDate), priority: shared(item => item.priority),
      complete: () => this.setStatus(task, tasks.every(item => item.completed) ? "todo" : "done", tasks),
      schedule: date => void this.commit(() => this.plugin.store.bulkUpdate(tasks, { scheduledDate: date })),
      pickDate: anchor => void this.openDateEditor(tasks, "scheduledDate", anchor, true, () => menu.close()),
      setPriority: priority => void this.commit(() => this.plugin.store.bulkUpdate(tasks.filter(item => item.priority !== priority), { priority })),
      submenus: [
        { label: "Project", icon: "folder-input", key: "g", open: anchor => this.openProjectChoice(tasks, anchor, true, () => menu.close()) },
        { label: "Deadline", icon: "flag", key: "D", open: anchor => void this.openDateEditor(tasks, "deadline", anchor, true, () => menu.close()) },
        { label: "Tags", icon: "tag", key: "t", open: anchor => this.openTagsEditor(tasks, anchor, true) },
        { label: "Repeat", icon: "repeat", key: "r", open: anchor => this.openRepeatEditor(tasks, anchor, true, () => menu.close()) },
        { label: "Snooze", icon: "alarm-clock-off", key: "S", open: anchor => this.openSnoozeEditor(tasks, anchor, true, () => menu.close()) },
        { label: "Status", icon: "circle-dot", key: "s", open: anchor => this.openStatusEditor(task, tasks, anchor, () => menu.close()) }
      ],
      duplicate: () => void this.commit(() => this.plugin.store.duplicate(tasks), "Could not duplicate the task."),
      delete: () => void this.commit(async () => {
        const paths = await this.plugin.store.bulkDelete(tasks);
        this.clearSelection();
        return paths;
      }, "Could not delete the task.", false)
    });
  }

  /** Copies tasks as Markdown, each with its notes and subtasks, for pasting here or into any note. */
  private async copyTasks(tasks: Task[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(await this.plugin.store.copyTasks(tasks));
      this.announce(`Copied ${tasks.length === 1 ? taskTitleLabel(tasks[0].title) : `${tasks.length} tasks`}`);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not copy the tasks.");
    }
  }

  /**
   * Pastes copied tasks right after the last selected task, or, with none selected, where a new task in this view
   * would go; the pasted tasks are selected.
   */
  private async pasteTasks(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      const after = this.getSelectedTasks().at(-1);
      const pasted = await this.plugin.store.pasteTasks(text, after ? { after } : { destination: this.plugin.newTaskDraft(this.state).destination });
      if (!pasted) { new Notice("There are no tasks on the clipboard to paste."); return; }
      await this.plugin.index.refreshPath(pasted.path);
      const tasks = this.plugin.index.tasksForPath(pasted.path).filter(task => task.line >= pasted.from && task.line < pasted.to);
      const top = Math.min(...tasks.map(task => task.indent));
      this.selection.select(tasks.filter(task => task.indent === top));
      this.updateSelection();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not paste the tasks.");
    }
  }

  /**
   * Writes a change, then refreshes the notes it touched; a failure shows as a notice. The selection is
   * kept, as the tasks now read (in `moveTo` when they moved there); `false` for tasks that are gone.
   */
  private async commit(write: () => Promise<string[]>, failure = "Could not update the task.", keep: { moveTo?: string } | false = {}): Promise<void> {
    const selected = keep ? this.getSelectedTasks() : [];
    try {
      for (const path of await write()) await this.plugin.index.refreshPath(path);
      if (keep) this.reselect(selected, keep.moveTo);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : failure);
    }
  }

  /**
   * Selects tasks again after a write changed them (and so their ids or text): each by its title in its note
   * (`moveTo` when it moved), the nearest to its old line when the title repeats.
   */
  private reselect(before: Task[], moveTo?: string): void {
    if (!before.length) return;
    const chosen: Task[] = [];
    for (const task of before) {
      const path = moveTo ?? task.path;
      const candidates = this.plugin.index.tasksForPath(path).filter(item => item.title === task.title && !chosen.includes(item));
      const nearest = candidates.sort((a, b) => Math.abs(a.line - task.line) - Math.abs(b.line - task.line))[0];
      if (nearest) chosen.push(nearest);
    }
    this.selection.select(chosen);
    this.updateSelection();
  }

  /** A property's popover: dates, times and durations, priority, tags, repeat or snooze. False for anything else. */
  private openPropertyEditor(tasks: Task[], property: TaskEditorProperty, anchor = this.popoverAnchor()): boolean {
    if (this.openDateEditor(tasks, property, anchor)) return true;
    const target = anchor ?? (tasks[0] && this.selectionRows.get(tasks[0].id)?.[0]) ?? this.content;
    if (!target || !tasks.length) return false;
    if (property === "tags") this.openTagsEditor(tasks, target);
    else if (property === "repeat") this.openRepeatEditor(tasks, target);
    else if (property === "defer") this.openSnoozeEditor(tasks, target);
    else return false;
    return true;
  }

  /** Inbox and the active projects; choosing one moves the tasks (with their subtasks) there. */
  private openProjectChoice(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
    const current = tasks.every(task => task.path === tasks[0].path) ? tasks[0].path : undefined;
    const move = (path: string): void => {
      done?.();
      const moving = tasks.filter(task => task.path !== path);
      if (moving.length) void this.commit(() => this.plugin.store.bulkUpdate(moving, { destination: path }), "Could not move the task.", { moveTo: path });
    };
    openChoicePopover({
      anchor, beside, label: "Move to project", choices: this.projectChoices(current), selected: current,
      input: this.projectSearch(path => move(path)), choose: move
    });
  }

  /** Searches the projects; typed text that names none can become a new project, which `use` then receives. */
  private projectSearch(use: (path: string) => void): ChoiceInput {
    return {
      placeholder: "Find or create a project", filter: true,
      create: {
        label: text => `Create project “${text}”`, icon: "folder-plus",
        run: text => {
          this.plugin.createProjectNote({ name: text }).then(path => {
            new Notice(`Created project ${text}`);
            use(path);
          }).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not create the project."); });
        }
      }
    };
  }

  /** Inbox, the given note when it is not a project, then the active projects by name. */
  private projectChoices(current?: string): Choice[] {
    return projectChoices(this.plugin.index.projects(), this.plugin.settings.inboxPath, current);
  }

  /**
   * Tags on the tasks (checked, or a dash when only some have one), then the vault's other tags. Each change
   * writes at once, one after another, to the tasks as they then read.
   */
  private openTagsEditor(tasks: Task[], anchor: HTMLElement, beside = false): void {
    const ids = tasks.map(task => task.id);
    const counts = new Map<string, number>();
    for (const task of tasks) for (const tag of task.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const own = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, state: count === tasks.length ? "all" as const : "some" as const }));
    const others = this.plugin.index.tagSummaries().map(tag => tag.name).filter(name => !counts.has(name)).map(name => ({ name, state: "none" as const }));
    let queue = Promise.resolve();
    const change = (next: (tags: string[]) => string[]): void => {
      queue = queue.then(() => this.commit(() => {
        const current = ids.map(id => this.plugin.index.taskById(id)).filter((task): task is Task => Boolean(task));
        const changed = current.filter(task => next(task.tags ?? []).join("\n") !== (task.tags ?? []).join("\n"));
        return changed.length ? this.plugin.store.bulkUpdate(changed, task => ({ tags: next(task.tags ?? []) })) : Promise.resolve([]);
      }));
    };
    openTagsPopover({
      anchor, beside, tags: [...own, ...others],
      toggle: (tag, on) => change(tags => on ? [...new Set([...tags, tag])] : tags.filter(item => item !== tag)),
      add: added => change(tags => [...new Set([...tags, ...added])])
    });
  }

  private openRepeatEditor(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
    const current = tasks.every(task => task.repeat === tasks[0].repeat) ? tasks[0].repeat ?? "" : undefined;
    openChoicePopover({
      anchor, beside, label: "Repeat", choices: repeatChoices(current), selected: current, input: REPEAT_INPUT,
      choose: value => {
        done?.();
        const repeat = value || undefined;
        void this.commit(() => this.plugin.store.bulkUpdate(tasks.filter(task => task.repeat !== repeat), { repeat }));
      }
    });
  }

  /** Snoozing hides a task from Inbox, Today and Upcoming until the date (see isDeferred). */
  private openSnoozeEditor(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
    const today = todayIso();
    const choices: Choice[] = [
      { value: addDays(today, 1), label: "Until tomorrow", icon: "sunrise" },
      { value: nextWeek(today), label: "Until next week", icon: "square-arrow-right" },
      { value: "someday", label: "Someday", icon: "archive" }
    ];
    if (tasks.some(task => task.deferDate || task.someday)) choices.push({ value: "", label: "Stop snoozing", icon: "alarm-clock", separated: true });
    const current = tasks.every(task => task.someday) ? "someday" : tasks.every(task => task.deferDate && task.deferDate === tasks[0].deferDate) ? tasks[0].deferDate : undefined;
    openChoicePopover({
      anchor, beside, label: "Snooze", choices, selected: current,
      input: {
        placeholder: "Snooze until, e.g. next fri", invalid: "Not a date",
        parse: text => {
          if (/^some ?day$/i.test(text)) return { value: "someday", label: "Someday" };
          const date = parseDateExpression(text, new Date(), this.plugin.dateFormat());
          return date ? { value: date, label: `Until ${formatDate(date, "ddd, MMM D, YYYY")}` } : undefined;
        }
      },
      choose: value => {
        done?.();
        const patch: BulkTaskPatch = value === "someday" ? { deferDate: undefined, someday: true } : { deferDate: value || undefined, someday: undefined };
        void this.commit(() => this.plugin.store.bulkUpdate(tasks, patch));
      }
    });
  }

  private openStatusEditor(task: Task, tasks: Task[], anchor: HTMLElement, done?: () => void, beside = true): void {
    const current = tasks.every(item => item.status === tasks[0].status) ? tasks[0].status : undefined;
    openChoicePopover({
      // S, which opens the list, moves on to the next status; Enter or a click sets it.
      anchor, beside, label: "Status", selected: current, cycleKey: "s",
      choices: TASK_STATUSES.map(status => ({ value: status, label: STATUS_LABELS[status], icon: STATUS_ICONS[status] })),
      choose: value => { done?.(); this.setStatus(task, value as TaskStatus, tasks); }
    });
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
    // Select on press: contextmenu may wait for release or the native menu gesture.
    row.addEventListener("pointerdown", event => {
      this.lastPointer = event.pointerType;
      this.contextSelectionOnPress = event.button === 2 || (Platform.isMacOS && event.button === 0 && event.ctrlKey);
      if (this.contextSelectionOnPress) selectForContextMenu(event);
    });
    // Right-clicking opens the task menu for the selection. Also support keyboard context-menu requests.
    row.addEventListener("contextmenu", event => {
      // Consume the context gesture even if the row moved after press.
      if (!this.contextSelectionOnPress) selectForContextMenu(event);
      this.contextSelectionOnPress = false;
      event.preventDefault();
      // Cmd/Ctrl-right-clicking a selected task takes it out of the selection instead.
      if (!this.selection.has(task)) return;
      const rect = row.getBoundingClientRect();
      this.openTaskMenu(task, row, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + 24, y: rect.bottom });
    });
    row.addEventListener("pointercancel", () => { this.contextSelectionOnPress = false; });
    const open = (): void => {
      this.selection.clear();
      this.selection.click(task, this.visibleTasks);
      this.updateSelection();
      this.openTask(task);
    };
    // A click selects: alone, or with Cmd/Ctrl to toggle and Shift for a range.
    row.addEventListener("click", event => {
      if (Platform.isMacOS && event.ctrlKey) return;
      const additive = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (!additive && !event.shiftKey && control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      // Touch screens do not always send dblclick for a double tap, so a second tap soon after opens the task.
      if (this.lastPointer === "touch" && !additive && !event.shiftKey) {
        const now = Date.now();
        if (this.lastTap?.id === task.id && now - this.lastTap.at < DOUBLE_TAP_MS) {
          this.lastTap = undefined;
          this.tapOpenedAt = now;
          open();
          return;
        }
        this.lastTap = { id: task.id, at: now };
      }
      this.selection.click(task, this.visibleTasks, event.shiftKey, additive);
      row.focus({ preventScroll: true });
      this.updateSelection();
    }, true);
    // A double-click opens the task's editor (unless a double tap already has).
    row.addEventListener("dblclick", event => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      if (Date.now() - this.tapOpenedAt < DOUBLE_TAP_MS) return;
      open();
    }, true);
    row.addEventListener("keydown", event => {
      this.contextSelectionOnPress = false;
      if (interactive(event.target)) return;
      if (event.key === "Escape") { event.preventDefault(); this.clearSelection(); }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        // No separate "active" task: a task focused but not selected is selected first.
        if (!this.selection.has(task)) {
          this.selection.click(task, this.visibleTasks);
          this.updateSelection();
          return;
        }
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

  private bindRowKeyboard(row: HTMLElement, task: Task, target?: ListDropGroup, foldable = false): void {
    // Controls inside a row join the tab order only while focus is in that row.
    const controls = Array.from(row.querySelectorAll<HTMLElement>("input, button, a, [role=button]"));
    for (const control of controls) control.tabIndex = -1;
    row.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight E M Shift+T D Shift+D P T G R S Shift+S C");
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
      // Letter shortcuts act on the selection (see rowShortcut); a row that keeps focus after Escape (or a click
      // elsewhere) is not selected, so they do nothing there.
      const shortcut = !event.altKey && key.length === 1 ? this.rowShortcut(key.toLowerCase(), event.shiftKey) : undefined;
      const arrows = event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key);
      if ((shortcut || arrows) && !this.selection.has(task)) return;
      if (shortcut) {
        event.preventDefault(); event.stopPropagation();
        shortcut(task, row);
        return;
      }
      if (event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        this.moveWithKeyboard(task, row, key, target);
        return;
      }
      // Left folds a task's subtasks away and Right shows them again.
      if (foldable && !event.altKey && !event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        const folded = this.folded.has(this.taskFoldKey(task));
        if (folded === (key === "ArrowRight")) { event.preventDefault(); event.stopPropagation(); this.toggleFold(this.taskFoldKey(task)); }
        return;
      }
      if (event.altKey || !["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
      const rows = this.rowElements();
      const index = rows.indexOf(row);
      // The arrows move the selection itself; with nothing selected they start at the first (or last) task.
      const selected = this.getSelectedTasks().length > 0;
      const next = !selected && (key === "ArrowDown" || key === "Home") ? rows[0]
        : !selected ? rows[rows.length - 1]
        : key === "ArrowUp" ? rows[index - 1] : key === "ArrowDown" ? rows[index + 1] : key === "Home" ? rows[0] : rows[rows.length - 1];
      event.preventDefault(); event.stopPropagation();
      const nextTask = next && this.taskForRow(next);
      if (!next || !nextTask || (next === row && selected)) return;
      // Shift extends from the anchor; otherwise the next task alone is selected.
      if (event.shiftKey && selected) {
        if (!this.selection.has(task)) this.selection.click(task, this.visibleTasks);
        this.selection.click(nextTask, this.visibleTasks, true);
      } else this.selection.click(nextTask, this.visibleTasks);
      this.updateSelection();
      next.focus();
    });
  }

  /**
   * What a letter does to the selected tasks, popovers opening below the row: E actions, M move, Shift+T today, D date,
   * Shift+D deadline, P priority, T tags, G project, R repeat, S status, Shift+S snooze, C complete (or reopen).
   */
  private rowShortcut(letter: string, shift: boolean): ((task: Task, row: HTMLElement) => void) | undefined {
    const tasks = (task: Task): Task[] => this.selection.has(task) ? this.getSelectedTasks() : [task];
    const shortcuts: Record<string, (task: Task, row: HTMLElement) => void> = {
      m: (task, row) => this.openMoveMenu(task, row),
      e: (task, row) => { const rect = row.getBoundingClientRect(); this.openTaskMenu(task, row, { x: rect.left + 24, y: rect.bottom }); },
      "shift+t": task => void this.commit(() => this.plugin.store.bulkUpdate(tasks(task), { scheduledDate: todayIso() })),
      d: (task, row) => void this.openDateEditor(tasks(task), "scheduledDate", row),
      "shift+d": (task, row) => void this.openDateEditor(tasks(task), "deadline", row),
      p: (task, row) => void this.openDateEditor(tasks(task), "priority", row),
      t: (task, row) => this.openTagsEditor(tasks(task), row),
      g: (task, row) => this.openProjectChoice(tasks(task), row),
      r: (task, row) => this.openRepeatEditor(tasks(task), row),
      s: (task, row) => this.openStatusEditor(task, tasks(task), row, undefined, false),
      "shift+s": (task, row) => this.openSnoozeEditor(tasks(task), row),
      c: task => { const all = tasks(task); this.setStatus(task, all.every(item => item.completed) ? "todo" : "done", all); }
    };
    return shortcuts[shift ? `shift+${letter}` : letter];
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
    if (!this.moveTargets.size) menu.addItem(item => item.setTitle("Nowhere to move to in this view").setIcon("arrow-right").setDisabled(true));
    const rect = row.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  /** Applies to the whole selection when the task is selected (or to the tasks given), like the move menu. */
  private setStatus(task: Task, status: TaskStatus, tasks = this.selection.has(task) ? this.getSelectedTasks() : [task]): void {
    this.pendingFocus = { path: task.path, title: task.title };
    const selected = this.getSelectedTasks();
    void this.plugin.store.setStatus(tasks, status).then(async paths => {
      for (const path of paths) await this.plugin.index.refreshPath(path);
      this.reselect(selected);
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

  private renderTaskRow(list: HTMLElement, task: Task, depth: number, target?: ListDropGroup, foldable = false): void {
    if (this.expanded?.id === task.id && this.plugin.settings.style === "things") { this.renderTaskCard(list, task, depth); return; }
    const row = list.createDiv({ cls: `tm-task-row tm-task-item${task.completed ? " is-completed" : ""}${task.status === "cancelled" ? " is-cancelled" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    this.bindSelection(row, task);
    const things = this.plugin.settings.style === "things";
    // In the Things style a recurring task's checkbox is its repeat icon (the checkbox stays, unseen, beneath it).
    const repeating = things && isRepeatingTask(this.app, task);
    const checkboxTarget = row.createEl("label", { cls: `tm-checkbox-target${repeating ? ` tm-repeat-target${task.priority ? ` is-p${task.priority}` : ""}` : ""}` });
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task), "data-tm-focus-key": "checkbox" } });
    if (repeating) repeatIcon(checkboxTarget);
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
    // Things board cards read like an open task card; list rows are one line.
    const board = things && this.layout === "kanban";
    if (board) row.addClass("tm-things-board-card");
    const lead = things && !board ? primary.createSpan({ cls: "tm-things-lead" }) : undefined;
    const title = primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title), "data-tm-focus-key": "title" } });
    title.addEventListener("click", () => this.editTask(task));
    try {
      // Routine-note repeats get an icon; inline `every …` repeats show a Repeat pill in the details instead.
      // (In the Things style the repeat icon is the task's checkbox.)
      if (!things && recurringFile(this.app, task)) {
        const icon = primary.createSpan({ cls: "tm-task-recurring", attr: { role: "img", "aria-label": "Recurring task", title: "Recurring task" } });
        setIcon(icon, "repeat-2");
      }
    } catch { /* Ambiguous recurring links remain editable through the task editor. */ }

    const metadata = content.createDiv({ cls: things ? "tm-things-secondary" : "tm-task-metadata" });
    const implicitSource = this.taskSourcePath ?? (this.state.mode === "inbox" ? this.plugin.settings.inboxPath : undefined);
    const tags = this.rowTags(task);
    const details = {
      grouping: this.metadataGrouping, dateFormat: this.plugin.dateFormat(), show: (property: TaskProperty) => property !== "defer",
      source: task.path !== implicitSource ? task.path : undefined, tags,
      edit: (property: TaskEditorProperty) => this.editTask(task, property), openSource: () => { void this.openSource(task); },
      openTag: (tag: string) => void this.openTagView(tag)
    };
    if (board) this.renderBoardCard(primary, metadata, task, details);
    else if (lead) {
      // With subtasks listed as rows, the mark saying a task has them would only repeat what is in view.
      renderThingsTaskDetails({ lead, inline: primary, secondary: metadata }, task, { ...details, todayMarker: this.state.mode !== "today", subtaskMark: !this.plugin.settings.showSubtasks, datesBelow: Platform.isMobile });
      if (!lead.childElementCount) lead.remove();
    } else renderTaskDetails(primary, metadata, task, details);
    if (!metadata.childElementCount) metadata.remove();
    if (foldable) {
      // A chevron in the row's left gutter folds the subtasks away; it stays visible while folded.
      const key = this.taskFoldKey(task);
      const folded = this.folded.has(key);
      row.toggleClass("is-folded", folded);
      const fold = row.createEl("button", { cls: "clickable-icon tm-fold-toggle tm-row-fold", attr: {
        type: "button", "aria-expanded": String(!folded), "aria-label": `${folded ? "Show" : "Hide"} subtasks of ${taskTitleLabel(task.title)}`, title: folded ? "Show subtasks" : "Hide subtasks", "data-tm-focus-key": "fold"
      } });
      setIcon(fold, "chevron-right");
      fold.addEventListener("click", event => { event.stopPropagation(); this.toggleFold(key); });
    }
    row.createSpan({ cls: "tm-sr-only tm-selected-marker" });
    this.bindRowKeyboard(row, task, target, foldable);
    this.bindSwipe(row, task);
  }

  /**
   * A Things board card, laid out like an open task card: the title, a few lines of its notes, its property lines,
   * and below them the note it lives in.
   */
  private renderBoardCard(primary: HTMLElement, below: HTMLElement, task: Task, details: { grouping: TaskGrouping; tags: string[]; source?: string; edit: (property: TaskEditorProperty) => void }): void {
    const notes = cardNotes(task.description).trim();
    if (notes) below.before(below.parentElement!.createDiv({ cls: "tm-things-board-notes", text: notes }));
    // Grouped by tag, the column names it; grouped by anything else, the card keeps every property.
    const properties = renderThingsCardProperties(below.parentElement!, task, details.grouping === "tags" ? [] : details.tags, details.edit, undefined, { open: tag => void this.openTagView(tag) });
    if (properties) below.before(properties);
    // Left out when the board is grouped by note: the column already names it.
    if (details.source && details.grouping !== "source") {
      const source = below.createSpan({ cls: "tm-things-source", text: details.source.replace(/\.md$/i, "").split("/").pop(), attr: { title: details.source } });
      editable(source, `Open source note: ${details.source}`, "source", () => { void this.openSource(task); });
    }
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

  /** `blank`: a new task's card, its title empty to type (its note keeps the placeholder until then). */
  private async expandCard(task: Task, blank = false): Promise<void> {
    await this.cardClosing;
    if (this.expanded?.id === task.id) return;
    if (!(this.newCardId && await this.discardNewCard())) await this.saveCard();
    const fresh = this.plugin.index.taskById(task.id) ?? task;
    this.expanded = { id: fresh.id, title: blank ? "" : fresh.title, notes: cardNotes(fresh.description) };
    // The card takes the place of the row and its subtask rows; it grows out of the space they filled.
    const replaced = [fresh.id, ...this.expandedDescendants()];
    const from = this.rowElements().filter(row => replaced.includes(row.getAttribute("data-task-id") ?? ""))
      .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
    this.cardRowsHeight = from;
    this.clearSelection();
    this.renderTaskResults();
    const card = this.content?.querySelector<HTMLElement>(".tm-things-card");
    card?.querySelector<HTMLTextAreaElement>(".tm-things-card-title")?.focus({ preventScroll: true });
    const opened = card && from ? animateCardOpen(card, from) : Promise.resolve();
    // Once it has grown: on phones the card moves to just above the keyboard; elsewhere, only when it is not all in
    // view, just far enough to show it.
    if (card) void opened.then(() => {
      if (Platform.isMobile) this.revealCardAboveKeyboard(card);
      else if (card.isConnected) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  /**
   * On phones, scrolls an open card the keyboard covers until its bottom sits just above the keyboard (the bottom of
   * the part of the list that can be seen), as far as the list scrolls; a card taller than that shows from its top,
   * and one above the visible part scrolls down into it. A card in full view stays put. Again if the keyboard then
   * opens for its title.
   */
  private revealCardAboveKeyboard(card: HTMLElement): void {
    const win = card.ownerDocument.defaultView;
    let scroller = card.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(win?.getComputedStyle(scroller).overflowY ?? ""))) scroller = scroller.parentElement;
    if (!win || !scroller) return;
    const list = scroller;
    // Obsidian's mobile app keeps the page full height under the keyboard and publishes the keyboard's height (and,
    // with a toolbar above the keyboard, the toolbar's) as CSS variables; a browser shrinks its visual viewport instead.
    const pixels = (element: Element, name: string): number => parseFloat(win.getComputedStyle(element).getPropertyValue(name)) || 0;
    const reveal = (): void => {
      if (!card.isConnected) return;
      const area = list.getBoundingClientRect();
      const viewport = win.visualViewport;
      const doc = card.ownerDocument;
      const toolbar = doc.body.hasClass("mod-toolbar-open") ? pixels(doc.body, "--mobile-toolbar-height") : 0;
      const top = Math.max(area.top, viewport?.offsetTop ?? 0);
      const bottom = Math.min(area.bottom, viewport ? viewport.offsetTop + viewport.height : win.innerHeight,
        win.innerHeight - pixels(doc.documentElement, "--keyboard-height") - toolbar);
      const rect = card.getBoundingClientRect();
      const gap = 8;
      const fits = rect.height + 2 * gap <= bottom - top;
      const by = fits && rect.bottom > bottom - gap ? rect.bottom - (bottom - gap) : !fits || rect.top < top + gap ? rect.top - (top + gap) : 0;
      if (by) list.scrollBy({ top: by, behavior: "smooth" });
    };
    reveal();
    // The keyboard opens for the card's title a moment later: check again when it has (Obsidian's app announces it;
    // a browser resizes its visual viewport), for a second and a half.
    const targets: EventTarget[] = [win, ...(win.visualViewport ? [win.visualViewport] : [])];
    const events = ["keyboardDidShow", "resize"];
    const again = (): void => reveal();
    for (const target of targets) for (const event of events) target.addEventListener(event, again);
    win.setTimeout(() => { for (const target of targets) for (const event of events) target.removeEventListener(event, again); }, 1500);
  }

  /**
   * Saves the card, shrinks it back into the space its rows take, then shows the rows.
   * Refreshes wait until it has closed, so the save cannot redraw the card mid-animation.
   */
  private collapseCard(): Promise<void> {
    if (this.cardClosing || !this.expanded) return this.cardClosing ?? Promise.resolve();
    const id = this.expanded.id;
    this.cardClosing = (async () => {
      if (!(this.newCardId && await this.discardNewCard())) await this.saveCard();
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
    // Tokens typed into the title (dates, times, p1, #[[tags]], ~[[Note]]…) set properties, as in the task editor.
    const draft = draftFromTitle(task, card.title, new Date(), this.plugin.dateFormat());
    const notes = card.notes.trim() === cardNotes(task.description).trim() ? undefined : card.notes;
    if (draftMatchesTask(task, draft) && notes === undefined) return;
    try {
      // Saving a card puts the line's properties in order, as the note does when its line is left.
      await this.plugin.store.update(task, { ...draft, description: notes, sortProperties: true });
      await this.plugin.index.refreshPath(task.path);
      if (draft.destination !== draftFromTask(task).destination) await this.plugin.index.refreshPath(draft.destination.split("#")[0]);
      if (this.expanded?.id === card.id) this.expanded = { ...this.expanded, title: draft.title, notes: notes ?? this.expanded.notes };
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not save the task.");
    }
  }

  /** Clicking anywhere outside the card (except a dialog or menu it opened) closes it. */
  private collapseCardOutside(event: MouseEvent): void {
    if (!this.expanded || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".tm-things-card, .tm-task-menu, .tm-date-popover, .tm-choice-popover, .tm-tags-popover, .modal-container, .menu, .suggestion-container")) return;
    void this.collapseCard();
  }

  /** Subtasks of the open card, at any depth. */
  private expandedDescendants(): Set<string> {
    const ids = new Set<string>();
    // With Show subtasks on, subtasks keep their own rows below the card.
    if (!this.expanded || this.plugin.settings.style !== "things" || this.plugin.settings.showSubtasks) return ids;
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
      task, depth, draft: expanded, tags: this.rowTags(task), focus, dateFormat: this.plugin.dateFormat(), repeating: isRepeatingTask(this.app, task),
      childDetails: child => ({
        grouping: "none", dateFormat: this.plugin.dateFormat(), show: property => property !== "defer", tags: this.rowTags(child),
        todayMarker: this.state.mode !== "today", edit: property => void this.editFromCard(child.id, property), openSource: () => {},
        openTag: tag => void this.openTagView(tag)
      }),
      children: this.plugin.settings.showSubtasks ? [] : task.childIds.map(id => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child)),
      change: draft => { if (this.expanded?.id === task.id) this.expanded = { id: task.id, ...draft }; },
      toggle: (item, completed) => {
        void this.plugin.store.toggle(item, completed).catch((cause: unknown) => {
          new Notice(cause instanceof Error ? cause.message : "Could not update the task.");
        });
      },
      edit: property => void this.editFromCard(task.id, property),
      collapse: () => void this.collapseCard(),
      renameChild: (child, title) => {
        // A subtask stays under its parent: its title's tokens set properties but do not move it.
        const draft = draftFromTitle(child, title, new Date(), this.plugin.dateFormat(), false);
        if (draftMatchesTask(child, draft)) return;
        void this.plugin.store.update(child, { ...draft, sortProperties: true })
          .then(() => this.plugin.index.refreshPath(child.path))
          .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not rename the subtask."); });
      },
      addChild: (title, after, next) => void this.addCardSubtask(task.id, title, after, next),
      // One after another, so quick changes in the tag list each see the last one.
      addTags: tags => { this.cardTagEdits = this.cardTagEdits.then(() => this.addCardTags(task.id, tags)); },
      removeTag: tag => { this.cardTagEdits = this.cardTagEdits.then(() => this.removeCardTag(task.id, tag)); },
      project: { label: task.path.replace(/\.md$/i, "").split("/").pop() ?? task.path, choose: anchor => this.openProjectPicker(task.id, anchor) },
      openTag: tag => void this.openTagView(tag),
      tagSuggestions: this.plugin.index.tagSummaries().map(tag => tag.name)
    });
  }

  /** Opens a tag's view; an open card is saved and closed first, so nothing typed in it is lost. */
  private async openTagView(tag: string): Promise<void> {
    if (this.expanded) { await this.saveCard(); this.expanded = undefined; }
    await this.plugin.openTag(tag).catch((error: unknown) => { new Notice(String(error)); });
  }

  /**
   * The card's project button: Inbox and the active projects (the task's own note checked, even when it
   * is not a project); choosing one moves the task, with its subtasks, there and closes the card.
   */
  private openProjectPicker(id: string, anchor: HTMLElement): void {
    const task = this.plugin.index.taskById(id);
    if (!task) return;
    openChoicePopover({
      anchor, label: "Move to project", choices: this.projectChoices(task.path), selected: task.path,
      input: this.projectSearch(path => void this.moveCardTask(id, path)), choose: path => void this.moveCardTask(id, path)
    });
  }

  private async moveCardTask(id: string, path: string): Promise<void> {
    await this.saveCard();
    const task = this.plugin.index.taskById(id);
    if (!task || task.path === path) return;
    try {
      await this.plugin.store.update(task, { ...draftFromTask(task), destination: path });
      // Its id changes with its note, so the card closes; the task shows up in its new project.
      if (this.expanded?.id === id) this.expanded = undefined;
      await this.plugin.index.refreshPath(task.path);
      await this.plugin.index.refreshPath(path);
      new Notice(`Moved to ${path.replace(/\.md$/i, "").split("/").pop()}`);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not move the task.");
    }
  }

  private cardTagEdits: Promise<void> = Promise.resolve();

  /** The cross on a card's tag takes that tag off the task. */
  private async removeCardTag(id: string, tag: string): Promise<void> {
    await this.saveCard();
    const task = this.plugin.index.taskById(id);
    if (!task?.tags?.includes(tag)) return;
    try {
      await this.plugin.store.update(task, { ...draftFromTask(task), tags: task.tags.filter(item => item !== tag) });
      await this.plugin.index.refreshPath(task.path);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not remove the tag.");
    }
  }

  /** Tags typed into the card join the task's own. */
  private async addCardTags(id: string, tags: string[]): Promise<void> {
    await this.saveCard();
    const task = this.plugin.index.taskById(id);
    if (!task) return;
    const next = [...new Set([...(task.tags ?? []), ...tags])];
    if (next.length === (task.tags ?? []).length) return;
    try {
      await this.plugin.store.update(task, { ...draftFromTask(task), tags: next });
      await this.plugin.index.refreshPath(task.path);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not add the tag.");
    }
  }

  /** Writes a subtask typed in the card; after Enter, a fresh one opens right below it, like a Things checklist. */
  private async addCardSubtask(parentId: string, title: string, after: Task | undefined, next: boolean): Promise<void> {
    const parent = this.plugin.index.taskById(parentId);
    if (!parent) return;
    try {
      // Everything in a new subtask was just typed, so its natural-language dates count too.
      const parsed = parseTaskInput(title, new Date(), this.plugin.dateFormat());
      await this.plugin.store.addSubtask(parent, parsed?.title.trim() ? parsed : { title }, after);
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
    const anchor = this.popoverAnchor();
    await this.saveCard();
    const task = this.plugin.index.taskById(id);
    if (task && !this.openPropertyEditor([task], property, anchor)) this.plugin.openEditor({ ...this.state, task, focusProperty: property });
  }

  /** Priority edits in a small list beside the property: P1–P3 or none, for every task given. */
  private openPriorityEditor(tasks: Task[], anchor = this.popoverAnchor(), beside = false): boolean {
    const first = tasks[0];
    const target = anchor ?? (first && this.selectionRows.get(first.id)?.[0]) ?? this.content;
    if (!first || !target) return false;
    const shared = tasks.every(task => task.priority === first.priority);
    openChoicePopover({
      // P, which opens the list, moves on to the next priority; Enter or a click sets it.
      anchor: target, beside, label: "Priority", choices: PRIORITY_CHOICES, cycleKey: "p", selected: shared ? String(first.priority ?? "") : undefined,
      choose: value => {
        const priority = value ? Number(value) as Task["priority"] : undefined;
        const changed = tasks.filter(task => task.priority !== priority);
        if (!changed.length) return;
        void this.plugin.store.bulkUpdate(changed, { priority }).then(async paths => {
          for (const path of paths) await this.plugin.index.refreshPath(path);
        }).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not update the task."); });
      }
    });
    return true;
  }

  /** The property just clicked or focused, for a popover to open beside; else the view. */
  private popoverAnchor(): HTMLElement | undefined {
    const active = this.content?.ownerDocument.activeElement as HTMLElement | null | undefined;
    return active && this.content?.contains(active) ? active : undefined;
  }

  /**
   * Opens the date popover for a schedule (with its time and duration) or a deadline (with its time),
   * saving to every task given. Returns false for properties it does not edit.
   */
  private openDateEditor(tasks: Task[], property: TaskEditorProperty, anchor = this.popoverAnchor(), beside = false, saved?: () => void): boolean {
    if (property === "priority") return this.openPriorityEditor(tasks, anchor, beside);
    const kind = property === "deadline" ? "deadline" : property === "scheduledDate" || property === "durationMinutes" ? "scheduled" : undefined;
    const first = tasks[0];
    if (!kind || !first) return false;
    const target = anchor ?? this.selectionRows.get(first.id)?.[0] ?? this.content;
    if (!target) return false;
    openDatePopover({
      anchor: target, kind, beside, dateFormat: this.plugin.dateFormat(),
      value: kind === "deadline" ? { date: first.deadline, time: first.deadlineTime } : { date: first.scheduledDate, time: first.scheduledTime, duration: first.durationMinutes },
      save: value => {
        saved?.();
        // Only what changed is written, so a multi-selection keeps each task's other values.
        const patch: BulkTaskPatch = {};
        if (kind === "deadline") {
          if (value.date !== first.deadline) patch.deadline = value.date;
          if (value.time !== first.deadlineTime) patch.deadlineTime = value.time;
        } else {
          if (value.date !== first.scheduledDate) patch.scheduledDate = value.date;
          if (value.time !== first.scheduledTime) patch.scheduledTime = value.time;
          if (value.duration !== first.durationMinutes) patch.durationMinutes = value.duration;
        }
        void this.plugin.store.bulkUpdate(tasks, patch).then(async paths => {
          for (const path of paths) await this.plugin.index.refreshPath(path);
        }).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not update the task."); });
      }
    });
    return true;
  }

  /**
   * Touch gestures on a row: swipe right to select or deselect the task, left to open its actions.
   * Only horizontal touch drags count; vertical movement scrolls as usual and mouse input is ignored.
   */
  private bindSwipe(row: HTMLElement, task: Task): void {
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
      // A long press lifted the row for dragging (see ListDragController): the finger moves it, not a swipe.
      if (row.hasClass("is-drag-armed") || row.hasClass("is-dragging")) { reset(); return; }
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
      row.setAttribute("data-swipe", offset < 0 ? "actions" : this.selection.has(task) ? "deselect" : "select");
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
        this.selection.click(task, this.visibleTasks, false, true);
        this.updateSelection();
      } else if (committed <= -SWIPE_COMMIT) {
        // The actions menu opens under the row, for the selection when the task is in it.
        const rect = row.getBoundingClientRect();
        this.openTaskMenu(task, row, { x: rect.left + 24, y: rect.bottom });
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
