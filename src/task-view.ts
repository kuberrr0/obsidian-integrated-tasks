import { taskTitleLabel } from "./task-title";
import { splitDestination } from "./structure";
import { activeProjects, projectStatuses, renderProjectProgress } from "./project-progress";
import { renderProjectHeaderDetails } from "./project-header-details";
import { renderTaskDetails } from "./task-row-details";
import { renderThingsProjectDetails, renderThingsTaskDetails } from "./things-row-details";
import { animateCardClose, animateCardOpen, cardNotes, renderThingsBoardCard, renderThingsTaskCard, type TaskCardDraft } from "./things-task-card";
import { isRepeatingTask, recurringFile } from "./recurring-task";
import { cloneTaskFilters, smartListDraft, undatedFilters, type SmartListDraft } from "./task-filters";
import { ViewOptionsPanel } from "./view-options";
import { TaskPropertyEditors } from "./task-property-editors";
import { createTaskRow, dropEmptyRowParts } from "./task-row";
import { NEW_TASK_ID, patchPendingTask, startPendingTask, writePendingTask, type PendingTask } from "./pending-task";
export { NEW_TASK_ID };
import type { TaskEditorProperty } from "./task-editor";
import type { ProjectDraft } from "./project-creator";
import { draftFromTask, draftFromTitle, draftMatchesTask } from "./task-draft";
import { openDatePopover } from "./date-popover";
import { openActionMenu, openTagsPopover, openTaskMenu, priorityIcons } from "./task-menu";
import { openConfirm } from "./confirm-modal";
import { dismissPopovers, openChoicePopover, PRIORITY_CHOICES, type Choice } from "./choice-popover";
import type { BulkTaskPatch } from "./bulk-tasks";
import { parseTaskInput } from "./parser";
import { TaskSelection } from "./task-selection";
import { PROJECT_COLORS, projectColorValue, updateProjectDates } from "./project-properties";
import { renderGantt } from "./gantt-view";
import { ganttYearStart, GANTT_MAX_SCALE, GANTT_MIN_SCALE, GANTT_ZOOMS, type GanttZoom } from "./gantt";

const CALENDAR_SCOPES: CalendarScope[] = ["day", "four-day", "week", "month", "year"];
const GANTT_ZOOM_NAMES = Object.keys(GANTT_ZOOMS) as GanttZoom[];
import { projectHierarchy } from "./project-hierarchy";
import { kanbanColumns, type KanbanColumn } from "./kanban";
import { ListDragController } from "./list-drag-view";
import { draftForGroup, isStructuralGroup, taskGroupTarget, type ListDropGroup, type ListPlacement } from "./list-drag";
import { renderCalendar } from "./calendar-view";
import { addDays, daysBetween, rescheduledDraft, type CalendarScope } from "./calendar";
import { STATUS_ICONS, STATUS_LABELS, TASK_STATUSES, isClosedStatus } from "./task-status";
import { ItemView, Menu, Notice, Platform, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { actionDate, formatDate, parseDateExpression, todayIso } from "./date";
import { groupTasks, orderTaskTree, sortTasks, taskMatchesQuery } from "./query";
import { markDropZone, startTaskDrag, type SidebarDrop } from "./sidebar-drop";
import type TaskManagerPlugin from "./main";
import type { OpenEditorState } from "./main";
import type { TaskFilter, Project, SmartList, SmartListScope, Task, TaskEditorPreset, TaskManagerSettings, TaskQuery, TaskViewMode, TaskViewState, TaskSort, TaskGrouping, TaskStatus, TaskProperty } from "./types";

export const TASK_MAIN_VIEW = "task-manager-main";

/**
 * Whether opened tasks show their details only in the Task Details sidebar (three panes): always on phones, elsewhere
 * (tablets too) as Task details says.
 */
export function tasksOpenInSidebar(settings: Pick<TaskManagerSettings, "taskDetails">): boolean {
  return Platform.isPhone || settings.taskDetails === "sidebar";
}

// Large lists render in pages; more rows load as the "Show more" button scrolls into view.
const ROW_PAGE = 200;
// The first few lists (sections, board columns) always show some rows,
// even after the shared page budget is spent, so no visible group looks empty.
const MIN_LIST_ROWS = 20;
const MIN_ROW_LISTS = 10;
// Swipe gestures on touch screens, in pixels.
const SWIPE_START = 12;
const SWIPE_COMMIT = 80;
const SWIPE_MAX = 120;

/** What had focus before a re-render, so the same control can be focused afterwards. */
interface FocusKey { taskId?: string; index?: number; part?: string; key?: string }

const TITLES: Record<TaskViewMode, string> = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  all: "All Tasks",
  projects: "Projects",
  tags: "Tags",
  smartLists: "Smart Lists"
};

/**
 * A project as a stand-in task, so it sorts, groups and filters with a view's tasks (View options › Projects): its
 * start while still ahead (once started, it is no longer waiting on a date), its deadline, priority and tags.
 */
function projectAsTask(project: Project, tags: string[], today: string, completed = false, calendar = false): Task {
  return {
    id: `project:${project.path}`, path: project.path, title: project.name, status: completed ? "done" : "todo", completed,
    line: 0, endLine: 0, raw: "", indent: 0, childIds: [],
    // Lists date a project by a start still to come; the calendar shows it on its start, past or not.
    scheduledDate: project.scheduledDate && (calendar || project.scheduledDate >= today) ? project.scheduledDate : undefined,
    deadline: project.deadline, deadlineTime: project.deadlineTime, priority: project.priority,
    tags: tags.filter(tag => tag !== "project")
  };
}

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
  /** Where the Gantt is (its first day in view), kept while the view is open; it opens at the start of the year. */
  private ganttAnchor = ganttYearStart(todayIso());
  private ganttZoom: GanttZoom = "year";
  /** The Gantt's scale (pixels per day) when zoomed in or out; else its range's own. */
  private ganttScale?: number;
  private calendarScope: CalendarScope = "month";
  private calendarAnchor = todayIso();
  private showCompleted = false;
  private smartListVersion?: string;
  /** View options › Projects (on by default): the view lists the projects it matches among its tasks. */
  private showProjects = true;
  /** The projects the list now shows, by their stand-in task's id. */
  private shownProjects = new Map<string, Project>();
  private propertyFilters: TaskFilter[] = [];
  private sort: TaskSort = "date";
  private descending = false;
  private grouping: TaskGrouping = "default";
  private filtersExpanded = false;
  private unsubscribe?: () => void;
  private taskResults?: HTMLElement;
  private listDrag?: ListDragController;
  private propertyEditors?: TaskPropertyEditors;
  private renderAfterDrag = false;
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
  /**
   * A new task (Create new task, or an Add task button), written only once its title is entered: what it will be so far
   * (`draft`), the task it would be where it would go (`task`), and its title and notes as typed, in a card in the list
   * or in the Task Details sidebar.
   */
  private newTaskEntry?: PendingTask & { host: "card" | "sidebar" };
  private rovingRow?: HTMLElement;
  private moveTargets = new Map<string, { title: string; target: ListDropGroup }>();
  private viewOptions?: ViewOptionsPanel;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
    this.navigation = false;
  }

  get pagePath(): string | undefined { return this.state.pagePath ?? this.state.projectPath; }

  get hasCalendar(): boolean {
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
  getState(): Record<string, unknown> { return { ...this.state, folded: [...this.folded], layout: this.layout, projectLayout: this.projectLayout, ganttZoom: this.ganttZoom, ganttScale: this.ganttScale, calendar: this.layout === "calendar", calendarScope: this.calendarScope, calendarAnchor: this.calendarAnchor, showProjects: this.showProjects }; }

  /** Which view's options this page keeps: a list's, a project's or a tag's (by its note when it has one). Smart lists keep theirs in their own definition. */
  private get optionsKey(): string | undefined {
    const { mode, tag } = this.state;
    if (this.pagePath) return `${mode === "tags" ? "tag" : "project"}:${this.pagePath}`;
    if (mode === "tags") return tag ? `tag:${tag}` : undefined;
    return mode === "inbox" || mode === "today" || mode === "upcoming" || mode === "all" ? mode : undefined;
  }

  /** The page's kept View options, or the defaults. */
  private restoreViewOptions(showProjects?: boolean): void {
    const key = this.optionsKey;
    const saved = key ? this.plugin.settings?.viewOptions?.[key] : undefined;
    this.propertyFilters = saved ? cloneTaskFilters(saved.filters) : [];
    this.sort = saved?.sort ?? "date";
    this.descending = saved?.descending ?? false;
    this.grouping = saved?.grouping ?? "default";
    this.showProjects = saved ? saved.showProjects !== false : showProjects ?? true;
  }

  /** Keeps the page's View options for its next visit; back at the defaults, nothing is kept. */
  private saveViewOptions(): void {
    const key = this.optionsKey;
    if (!key) return;
    const defaults = !this.propertyFilters.length && this.sort === "date" && !this.descending && this.grouping === "default" && this.showProjects;
    this.plugin.saveViewOptions?.(key, defaults ? undefined : {
      filters: cloneTaskFilters(this.propertyFilters), sort: this.sort, descending: this.descending, grouping: this.grouping,
      ...(this.showProjects ? {} : { showProjects: false })
    });
  }

  /** Which view's layout this page keeps: as for its View options, and a smart list's or the Projects list's too. */
  private get layoutKey(): string | undefined {
    if (this.state.mode === "smartLists") return this.state.smartListId ? `smartList:${this.state.smartListId}` : undefined;
    if (this.state.mode === "projects" && !this.pagePath) return "projects";
    return this.optionsKey;
  }

  /** The layout given, else the one the page was left with, else a list. */
  private restoreLayout(layout?: "list" | "calendar" | "kanban", projectLayout?: "list" | "gantt"): void {
    const key = this.layoutKey;
    const saved = key ? this.plugin.settings?.viewLayouts?.[key] : undefined;
    this.layout = layout ?? (saved === "calendar" || saved === "kanban" ? saved : "list");
    this.projectLayout = projectLayout ?? (saved === "gantt" ? "gantt" : "list");
  }

  /** Keeps the page's layout for its next visit. */
  private saveLayout(): void {
    const key = this.layoutKey;
    if (key) this.plugin.saveViewLayout?.(key, key === "projects" ? this.projectLayout : this.layout);
  }

  /**
   * The calendar scope and Gantt range a tab gave (its own, restored), else the ones the page was left with, else a month
   * and a year. The calendar still opens on today, and the Gantt at the start of the year.
   */
  private restorePeriod(state: Record<string, unknown>): void {
    const key = this.layoutKey;
    const saved = key ? this.plugin.settings?.viewPeriods?.[key] : undefined;
    if (!CALENDAR_SCOPES.includes(state.calendarScope as CalendarScope)) {
      this.calendarScope = CALENDAR_SCOPES.includes(saved?.calendarScope as CalendarScope) ? saved!.calendarScope! : "month";
    }
    if (!("ganttZoom" in state) && !("ganttScale" in state)) {
      this.ganttZoom = GANTT_ZOOM_NAMES.includes(saved?.ganttZoom as GanttZoom) ? saved!.ganttZoom! : "year";
      const scale = saved?.ganttScale;
      this.ganttScale = typeof scale === "number" && scale >= GANTT_MIN_SCALE && scale <= GANTT_MAX_SCALE ? scale : undefined;
    }
  }

  /** Keeps the page's calendar scope and Gantt range for its next visit; at the defaults, nothing is kept. */
  private savePeriod(): void {
    const key = this.layoutKey;
    if (!key) return;
    this.plugin.saveViewPeriod?.(key, {
      ...(this.calendarScope !== "month" ? { calendarScope: this.calendarScope } : {}),
      ...(this.ganttZoom !== "year" || this.ganttScale !== undefined ? { ganttZoom: this.ganttZoom, ganttScale: this.ganttScale } : {})
    });
  }

  /**
   * `result`: Obsidian's; moving to another page (a project, tag, list or smart list) records the page left in the
   * tab's history, as a note does when its file changes, so Back and Forward step through task pages too. Obsidian
   * itself leaves Back, Forward and linked panes out.
   */
  async setState(state: Record<string, unknown>, result?: ViewStateResult): Promise<void> {
    const mode = state.mode;
    // A layout given (a tab's own, or its history's) holds; without one, a new page opens with the layout it was left with.
    const layout = state.layout === "list" || state.layout === "calendar" || state.layout === "kanban" ? state.layout
      : typeof state.calendar === "boolean" ? state.calendar ? "calendar" : "list" : undefined;
    const projectLayout = state.projectLayout === "list" || state.projectLayout === "gantt" ? state.projectLayout : undefined;
    if (state.ganttZoom === "month" || state.ganttZoom === "quarter" || state.ganttZoom === "year" || state.ganttZoom === "five-year") this.ganttZoom = state.ganttZoom;
    else if (state.ganttZoom === "week") this.ganttZoom = "month";
    // A range chosen drops a zoom; a tab restored keeps its own.
    if ("ganttZoom" in state || "ganttScale" in state) {
      this.ganttScale = typeof state.ganttScale === "number" && state.ganttScale >= GANTT_MIN_SCALE && state.ganttScale <= GANTT_MAX_SCALE ? state.ganttScale : undefined;
    }
    const ganttAnchor = typeof state.ganttAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.ganttAnchor) && parseDateExpression(state.ganttAnchor) ? state.ganttAnchor : undefined;
    if (CALENDAR_SCOPES.includes(state.calendarScope as CalendarScope)) this.calendarScope = state.calendarScope as CalendarScope;
    if (typeof state.calendarAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.calendarAnchor) && parseDateExpression(state.calendarAnchor)) this.calendarAnchor = state.calendarAnchor;
    const newPage = this.state.mode !== mode || this.state.projectPath !== state.projectPath || this.state.pagePath !== state.pagePath || this.state.tag !== state.tag || this.state.smartListId !== state.smartListId;
    // The Gantt opens at the start of the year (for an overview of it) unless sent somewhere; it keeps its place only
    // while the page stays open.
    if (ganttAnchor) this.ganttAnchor = ganttAnchor;
    else if (newPage) this.ganttAnchor = ganttYearStart(todayIso());
    if (newPage) {
      // A new task left for another page is written with a title, else dropped.
      if (this.newTaskEntry) {
        void this.endNewTask();
        if (this.expanded?.id === NEW_TASK_ID) this.expanded = undefined;
      }
      // A new page, not the first one this view opens with (a new view is recorded as it replaces the last).
      if (this.stateSet && result) result.history = true;
      this.smartListVersion = undefined;
      this.selection.clear();
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
    // Each view opens with the View options it was left with (a tab saved before they were kept may still say whether it showed projects).
    if (newPage || !this.stateSet) {
      this.restoreViewOptions(typeof state.showProjects === "boolean" ? state.showProjects : undefined);
      this.restoreLayout(layout, projectLayout);
      this.restorePeriod(state);
    } else if ((layout && layout !== this.layout) || (projectLayout && projectLayout !== this.projectLayout)) {
      this.layout = layout ?? this.layout;
      this.projectLayout = projectLayout ?? this.projectLayout;
      this.saveLayout();
    }
    this.stateSet = true;
    this.render();
    this.refreshTitle();
    this.plugin.refreshTaskSidebar?.();
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
    // Obsidian's own undo only covers the editor; in task views Cmd/Ctrl+Z undoes the last task change,
    // and Cmd/Ctrl+Shift+Z (or Ctrl+Y off macOS) redoes it.
    this.registerDomEvent(this.containerEl, "keydown", event => {
      const key = event.key.toLowerCase();
      if (event.altKey || event.defaultPrevented) return;
      // Typing in a field (a card's title or notes, a search) keeps its own keys.
      if ((event.target as HTMLElement | null)?.closest?.("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) return;
      const mod = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (mod && ((event.shiftKey && key === "z") || (!Platform.isMacOS && !event.shiftKey && key === "y"))) {
        event.preventDefault();
        void this.plugin.redoTaskChange();
        return;
      }
      if (event.shiftKey) return;
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
    dismissPopovers(this.containerEl);
    await this.endNewTask();
    await this.saveCard();
    this.expanded = undefined;
    this.closed = true;
    this.unsubscribe?.();
    if (this.renderFrame !== undefined) this.containerEl.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = undefined;
    this.disconnectRowObservers();
    this.plugin.refreshTaskSidebar?.();
  }

  private get content(): HTMLElement { return this.containerEl?.children[1] as HTMLElement; }

  /** Coalesce bursts of index updates into one refresh per frame. */
  private scheduleRender(): void {
    // A row dragged in the list stays under the pointer: the list redraws once the drag ends.
    if (this.listDrag?.dragging) { this.renderAfterDrag = true; return; }
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
      if (!element) continue;
      element.scrollTop = top;
      // The Gantt lays its dates out from where it was left (or sent): only its vertical scroll is kept.
      if (element.getAttribute("data-tm-scroll-axis") !== "y") element.scrollLeft = left;
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
        this.showProjects = list.showProjects !== false;
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
    container.classList.toggle("tm-density-compact", this.plugin.settings.density === "compact");
    container.classList.toggle("tm-style-things", this.plugin.settings.style === "things");
    container.classList.toggle("tm-style-griply", this.plugin.settings.style === "griply");
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

    const viewOptions = this.renderHeader(container);
    this.renderFilters(container, viewOptions);
    this.taskResults = container.createDiv({ cls: "tm-task-results" });
    this.renderTaskResults();
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
    const container = this.taskResults;
    if (!container) return;
    this.preserveView(() => this.renderTaskResultsNow(container));
  }

  /** A smart list's scope, when it was made from a view (View options › Convert to smart list). */
  private get smartListScope(): SmartListScope | undefined {
    return this.state.mode === "smartLists" ? this.plugin.settings.smartLists.find(list => list.id === this.state.smartListId)?.scope : undefined;
  }

  /**
   * The view whose defaults (its grouping, its sections) apply: this page's, or for a smart list made from a view,
   * that view's: a project's note, Today, a tag…
   */
  private get defaults(): { mode: TaskViewMode; path?: string } {
    const scope = this.smartListScope;
    if (!scope) return { mode: this.state.mode, path: this.taskSourcePath };
    return scope.mode === "project" ? { mode: "all", path: scope.path } : scope.mode === "tag" ? { mode: "tags" } : { mode: scope.mode };
  }

  /** What the view lists: its own tasks, or a smart list's, within the view it was made from. */
  private baseQuery(): TaskQuery {
    const scope = this.smartListScope;
    const { mode, path } = this.defaults;
    const tags = mode === "tags";
    return {
      mode: path ? "project" : this.layout === "calendar" && (mode === "today" || mode === "upcoming") ? "all" : mode,
      showCompleted: this.showCompleted,
      projectPath: path,
      tag: scope?.mode === "tag" ? scope.tag : tags && !this.pagePath ? this.state.tag : undefined,
      tagPath: scope?.mode === "tag" ? scope.path : tags ? this.pagePath : undefined,
      filters: this.propertyFilters,
    };
  }

  private renderTaskResultsNow(container: HTMLElement): void {
    container.empty();
    this.resetRows();
    this.updateSelection();
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), this.layout !== "kanban", task => this.prepareDrag(task));
    this.listDrag.onIdle = () => {
      if (!this.renderAfterDrag) return;
      this.renderAfterDrag = false;
      this.scheduleRender();
    };
    const query = this.baseQuery();
    // A new task's card shows where the task would go, among the rest.
    const entry = this.newTaskEntry?.host === "card" ? [this.newTaskEntry.task] : [];
    const tasks = sortTasks([...this.plugin.index.query(query), ...this.projectItems(query), ...entry], this.sort, this.descending);
    this.selection.retain(tasks);
    // In the calendar, its days and hours take them instead.
    this.takeDropsFromOtherPanes(container);
    this.renderTaskLayouts(container, tasks);
    this.selection.retain(this.visibleTasks);
    this.updateSelection();
    this.updateRoving();
  }

  /**
   * Tasks dragged in another pane (the Task Details sidebar's) drop in this list as its own rows do: its gap opens where they
   * would land. On a group of a property's value (a date, a priority…) they take the value but keep their place in their
   * notes; in a note or section, the place dropped on too.
   */
  private takeDropsFromOtherPanes(container: HTMLElement): void {
    markDropZone(container, {
      hover: (point, drag) => this.listDrag?.hoverExternal(point, drag.height ?? 32, container.ownerDocument),
      leave: () => this.listDrag?.leaveExternal(),
      drop: async (_point, drag) => {
        const intent = this.listDrag?.takeExternal();
        if (!intent || !drag.tasks.length) return;
        const place = !intent.group || isStructuralGroup(intent.group);
        this.draggedTasks = drag.tasks;
        await this.dropListTask(drag.tasks[0], intent.group, place ? intent.anchor : undefined, place ? intent.placement : undefined);
      }
    });
  }

  /**
   * With View options › Projects on, the projects the view's own query takes, as stand-in tasks: on a project's page
   * its subprojects, elsewhere every active project (Today: starting or due today or overdue, Upcoming: later, a tag's
   * view: tagged with it; filters apply to its dates, priority and tags). The calendar has no room for them.
   */
  private projectItems(query: TaskQuery): Task[] {
    this.shownProjects.clear();
    if (!this.showProjects) return [];
    const calendar = this.layout === "calendar";
    const today = todayIso();
    const page = this.taskSourcePath;
    const scope: TaskQuery = page ? { ...query, mode: "all", projectPath: undefined } : query;
    const items: Task[] = [];
    const projects = this.plugin.index.projects();
    const statuses = projectStatuses(projects);
    for (const project of projects) {
      // Completed projects show as completed tasks do, only with Show completed on.
      const status = statuses.get(project.path);
      if (status === "archived" || (status === "completed" && !query.showCompleted) || project.path === page || (page !== undefined && project.parentPath !== page)) continue;
      const tags = this.plugin.projectDraft(project).tags.split(/,\s*/).filter(Boolean);
      const item = projectAsTask(project, tags, today, status === "completed", calendar);
      // The calendar shows a project on its start date, or its deadline; one with neither has no day.
      if (calendar && !item.scheduledDate && !item.deadline) continue;
      if (scope.tagPath && !this.plugin.index.taskHasTagPath(item, scope.tagPath)) continue;
      if (!taskMatchesQuery(item, scope, this.plugin.settings.inboxPath)) continue;
      this.shownProjects.set(item.id, project);
      items.push(item);
    }
    return items;
  }

  private renderTaskLayouts(container: HTMLElement, tasks: Task[]): void {
    if (this.layout === "calendar") {
      renderCalendar(container, {
        anchor: this.calendarAnchor, scope: this.calendarScope, tasks, dateFormat: this.plugin.dateFormat(),
        color: task => this.plugin.settings.calendarProjectColors ? this.plugin.index.projectColor(task.path) : undefined,
        priorityColors: this.plugin.settings.calendarPriorityColors,
        navigate: (anchor, scope) => {
          const changed = scope !== this.calendarScope;
          this.calendarAnchor = anchor; this.calendarScope = scope;
          if (changed) this.savePeriod();
          this.renderTaskResults();
        },
        create: preset => this.newTask(preset),
        edit: task => this.editTask(task),
        toggle: (task, completed) => this.plugin.store.toggle(task, completed),
        bind: (card, task) => this.bindSelection(card, task),
        dragStart: task => this.prepareDrag(task),
        project: task => this.shownProjects.get(task.id),
        openProject: project => void this.plugin.openProject(project.path).catch(error => new Notice(String(error))),
        resize: async (task, date, time, duration) => {
          const latest = this.plugin.index.taskById(task.id);
          if (!latest) throw new Error("Task no longer exists. Refresh the view and try again.");
          await this.plugin.store.update(latest, { ...rescheduledDraft(latest, date, time), durationMinutes: duration });
          await this.plugin.index.refreshPath(latest.path);
        },
        move: async (task, date, time) => {
          const project = this.shownProjects.get(task.id);
          if (project) { await this.moveProject(project, date); return; }
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
      const { path } = this.defaults;
      if (path && this.grouping === "default" && !this.propertyFilters.length) {
        this.renderProjectSections(container, path, tasks);
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
    const defaults = this.defaults;
    if (defaults.path) {
      this.renderProjectSections(container, defaults.path, tasks);
      return;
    }
    if (defaults.mode === "today") {
      const today = todayIso();
      // Overdue shows only with something overdue.
      const overdue = tasks.filter((task) => (actionDate(task) ?? today) < today);
      if (overdue.length) this.renderSection(container, "Overdue", overdue, "alert", { property: "date", value: addDays(today, -1) });
      this.renderSection(container, "Today", tasks.filter((task) => actionDate(task) === today), undefined, { property: "date", value: today });
    } else if (defaults.mode === "upcoming") {
      for (const [date, group] of groupTasks(tasks, "date")) this.renderSection(container, formatDate(date, this.plugin.dateFormat()), group, undefined, taskGroupTarget("date", group[0]));
    } else if (defaults.mode === "all") {
      for (const [path, group] of groupTasks(tasks, "source")) {
        this.renderSection(container, path.replace(/\.md$/i, ""), group, undefined, { destination: path });
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }

  /**
   * The board's columns: its grouping's, or with View default the groups a list of this view shows: a project page's
   * sections, Today's overdue and today, Upcoming's dates, All Tasks' notes, and elsewhere one column.
   */
  private kanbanColumns(tasks: Task[]): KanbanColumn[] {
    if (this.grouping !== "default") return kanbanColumns(tasks, this.grouping);
    const defaults = this.defaults;
    if (defaults.path) {
      // Subprojects are a column of their own, before the note's sections.
      const projects = tasks.filter(task => this.shownProjects.has(task.id));
      const columns = kanbanColumns(tasks.filter(task => !this.shownProjects.has(task.id)), "section");
      return projects.length ? [{ title: "Projects", tasks: projects }, ...columns] : columns;
    }
    if (defaults.mode === "today") {
      const today = todayIso();
      // Overdue shows only with something overdue.
      const overdue = tasks.filter(task => (actionDate(task) ?? today) < today);
      return [
        ...overdue.length ? [{ title: "Overdue", tasks: overdue, target: { property: "date" as const, value: addDays(today, -1) } }] : [],
        { title: "Today", tasks: tasks.filter(task => actionDate(task) === today), target: { property: "date" as const, value: today } }
      ];
    }
    if (defaults.mode === "upcoming") return kanbanColumns(tasks, "date");
    if (defaults.mode === "all") return kanbanColumns(tasks, "source");
    return kanbanColumns(tasks, "none");
  }

  private renderKanban(container: HTMLElement, tasks: Task[]): void {
    const columns = this.kanbanColumns(tasks);
    if (!columns.length) { this.renderEmpty(container); return; }
    const board = container.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board", "data-tm-scroll-key": "kanban" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column", attr: { "data-tm-scroll-key": `kanban:${column.title}` } });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      // Date columns are keyed by ISO date; show them in the user's format (Overdue and Today keep their names).
      const title = column.target?.property && ["date", "scheduledDate", "deadline", "defer"].includes(column.target.property) && /^\d{4}-\d{2}-\d{2}$/.test(column.title)
        ? formatDate(column.title, this.plugin.dateFormat()) : column.target?.property === "source" ? column.title.replace(/\.md$/i, "") : column.title;
      header.createEl("h2", { text: title });
      this.renderGroupAddButton(header, title, column.target);
      if (column.target) { this.listDrag?.group(section, column.target); this.addMoveTarget(title, column.target); }
      this.renderTaskList(section, column.tasks, column.target);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
  }

  private renderProjectSections(container: HTMLElement, path: string, items: Task[]): void {
    const headings = this.plugin.index.headingsForPath(path);
    // Subprojects (View options › Projects) are a group of their own, above the note's tasks.
    const projects = items.filter(item => this.shownProjects.has(item.id));
    if (projects.length) this.renderSection(container, "Projects", projects);
    const tasks = items.filter(item => !this.shownProjects.has(item.id));
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
    if (!items.length && !headings.length) this.renderEmpty(container);
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
    // A smart list's title has its actions too: rename it, save the view's options into it, or delete it.
    const smartList = this.state.mode === "smartLists" ? this.plugin.settings.smartLists.find(list => list.id === this.state.smartListId) : undefined;
    if (smartList) {
      const more = titleRow.createEl("button", { cls: "clickable-icon tm-title-more", attr: { type: "button", "aria-label": "Smart list actions", title: "Smart list actions", "aria-haspopup": "menu", "data-tm-focus-key": "smart-list-actions" } });
      setIcon(more, "more-horizontal");
      more.addEventListener("click", event => { event.stopPropagation(); this.openSmartListMenu(smartList, more); });
    }
    this.headerMetadata = heading.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
    this.renderHeaderMetadata();

    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Task view layout" } });
    for (const [layout, icon, label] of [["list", "list", "List"], ["calendar", "calendar-days", "Calendar"], ["kanban", "columns-3", "Kanban"]] as const) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${label} view`, title: `${label} view`, "aria-pressed": String(this.layout === layout), "data-tm-focus-key": `layout-${layout}` } });
      setIcon(button, icon);
      button.addEventListener("click", () => { this.layout = layout; this.saveLayout(); this.render(); });
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
   * in place, in its group or column, as Things does; otherwise the task editor opens. With three panes (Task
   * details › Three panes), it opens in the Task Details sidebar instead, its title empty to type.
   */
  newTask(preset?: TaskEditorPreset): void {
    const state = preset ? { ...this.state, preset } : this.state;
    if (this.detailsInSidebar) { void this.startNewTask(state, "sidebar"); return; }
    // Lists and boards show a card in place; the calendar has no room for one.
    const list = this.layout !== "calendar" && !this.propertyFilters.length && (Boolean(this.taskSourcePath) || ["inbox", "today", "upcoming", "all", "tags"].includes(this.state.mode));
    if (this.plugin.settings.style === "things" && list) void this.startNewTask(state, "card");
    else this.plugin.openEditor(state);
  }

  /**
   * Starts a new task, as the task editor does, written only once its title is entered: Enter writes it, as does
   * leaving it titled; Escape, or leaving it untitled, drops it. In a card it shows where it would go, with its
   * title empty to type; with three panes, in the Task Details sidebar.
   */
  private async startNewTask(state: OpenEditorState, host: "card" | "sidebar"): Promise<void> {
    await this.endNewTask();
    if (host === "card") await this.collapseCard();
    const pending = await startPendingTask(this.plugin, this.plugin.newTaskDraft(state), this.app.vault);
    if (!pending) { this.plugin.openEditor(state); return; }
    const task = pending.task;
    this.newTaskEntry = { ...pending, host };
    if (host === "sidebar") {
      this.clearSelection();
      void this.plugin.showInTaskSidebar(NEW_TASK_ID, { focus: true }).catch((error: unknown) => new Notice(String(error)));
      return;
    }
    await this.expandCard(task, true);
    // A view that does not list the new task cannot show its card: the task editor takes it instead.
    if (!this.content?.querySelector(".tm-things-card")) {
      this.newTaskEntry = undefined;
      this.expanded = undefined;
      this.plugin.openEditor(state);
    }
  }

  /**
   * Ends the new task: written when it has a title (properties typed into it apply, as in the task editor), else, or
   * cancelled (`write` off), dropped. Returns the task written.
   */
  private async endNewTask(write = true): Promise<Task | undefined> {
    const entry = this.newTaskEntry;
    if (!entry) return undefined;
    this.newTaskEntry = undefined;
    this.plugin.refreshTaskSidebar?.();
    return write ? writePendingTask(this.plugin, entry) : undefined;
  }

  /** For the Task Details sidebar: the new task it shows (three panes), with its title and notes as typed and its note. */
  newTaskInSidebar(): { task: Task; title: string; notes: string; destination: string } | undefined {
    const entry = this.newTaskEntry;
    return entry?.host === "sidebar" ? { task: entry.task, title: entry.title, notes: entry.notes, destination: entry.draft.destination } : undefined;
  }

  /** For the Task Details sidebar: the new task's title and notes as typed. */
  typeNewTask(title: string, notes: string): void {
    if (this.newTaskEntry) Object.assign(this.newTaskEntry, { title, notes });
  }

  /**
   * For the Task Details sidebar: Enter writes the new task when it has a title and selects it, so the sidebar goes on
   * showing it; Escape (`write` off) drops it.
   */
  async finishNewTask(write = true): Promise<void> {
    const task = await this.endNewTask(write);
    if (!task) return;
    this.revealInSidebar(task);
    this.selectionRows.get(task.id)?.[0]?.focus({ preventScroll: true });
  }

  /** A task by id as it now reads: the index's, or the new task not yet written. */
  private liveTask(id: string): Task | undefined {
    return id === NEW_TASK_ID ? this.newTaskEntry?.task : this.plugin.index.taskById(id);
  }

  /** Writes a change to tasks; the new task not yet written takes it into what it will be instead. */
  private updateTasks(tasks: Task[], patch: BulkTaskPatch | ((task: Task) => BulkTaskPatch), failure?: string, keep?: { moveTo?: string } | false): Promise<void> {
    const entry = this.newTaskEntry;
    if (entry && tasks.some(task => task.id === NEW_TASK_ID)) {
      this.patchNewTask(typeof patch === "function" ? patch(entry.task) : patch);
      tasks = tasks.filter(task => task.id !== NEW_TASK_ID);
      if (!tasks.length) return Promise.resolve();
    }
    return this.commit(() => this.plugin.store.bulkUpdate(tasks, patch), failure, keep);
  }

  /** Changes what the new task will be. It stays where it is shown, its project naming the note it will go to. */
  private patchNewTask(patch: BulkTaskPatch): void {
    const entry = this.newTaskEntry;
    if (!entry) return;
    patchPendingTask(entry, patch);
    if (entry.host === "card") this.renderTaskResults();
    this.plugin.refreshTaskSidebar?.();
  }

  /** Three panes (Task details, or a phone or tablet): an opened task shows only in the Task Details sidebar. */
  private get detailsInSidebar(): boolean { return tasksOpenInSidebar(this.plugin.settings); }

  /**
   * Three panes: selects the task (when the view lists it) and shows it in the Task Details sidebar, which opens if it is
   * closed (on phones and tablets, its drawer slides in). `focus` puts the caret in its title.
   */
  revealInSidebar(task: Task, options: { focus?: boolean } = {}): void {
    // A task just added (or just changed) is listed as it reads once the view redraws; its line's last task may have its id.
    const listed = (): Task | undefined => this.visibleTasks.find(item => item.id === task.id && item.raw === task.raw);
    if (!listed()) this.renderTaskResults();
    const shown = listed();
    this.selection.clear();
    if (shown) this.selection.click(shown, this.visibleTasks);
    this.updateSelection();
    void this.plugin.showInTaskSidebar(task.id, options).catch((error: unknown) => new Notice(String(error)));
  }

  /** A task's editor: with three panes the Task Details sidebar (see revealInSidebar), else the task editor. */
  private openTaskEditor(task: Task, focusProperty?: TaskEditorProperty): void {
    if (this.detailsInSidebar) this.revealInSidebar(task, { focus: !Platform.isMobile });
    else this.plugin.openEditor({ ...this.state, task, ...(focusProperty ? { focusProperty } : {}) });
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

  /**
   * A smart list's actions, from the "…" beside its title: rename it in a popover beside the menu, update it with the
   * filters, sorting and grouping the view now has, or delete it (after asking).
   */
  private openSmartListMenu(list: SmartList, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const save = (draft: SmartListDraft, done: string): void => {
      void this.plugin.saveSmartList(draft, list.id).then(() => new Notice(done))
        .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not save the smart list."); });
    };
    anchor.setAttribute("aria-expanded", "true");
    const menu = openActionMenu({
      doc: anchor.ownerDocument, at: { x: rect.left, y: rect.bottom + 4 }, label: "Smart list actions", returnFocus: anchor,
      onClose: () => anchor.setAttribute("aria-expanded", "false"),
      entries: [
        { kind: "submenu", label: "Rename", icon: "pencil", key: "n", open: target => {
          openChoicePopover({
            anchor: target, beside: true, label: "Rename smart list", choices: [],
            input: { placeholder: list.name, invalid: "", parse: text => text && text !== list.name ? { value: text, label: `Rename to “${text}”` } : undefined },
            choose: name => { menu.close(); save({ ...smartListDraft(list), name }, `Renamed to “${name}”`); }
          });
        } },
        { kind: "item", label: "Update View Options", icon: "refresh-cw", key: "u", run: () => this.updateSmartList(list) },
        { kind: "separator" },
        { kind: "item", label: "Delete smart list", icon: "trash-2", danger: true, run: () => this.confirmDeleteSmartList(list) }
      ]
    });
  }

  /** The smart list with the filters, sorting, grouping and projects the view now has, in its own scope. */
  private smartListAsShown(list: SmartList): SmartListDraft {
    return { name: list.name, filters: cloneTaskFilters(this.propertyFilters), sort: this.sort, descending: this.descending, grouping: this.grouping,
      ...(this.showProjects ? {} : { showProjects: false }), ...(list.scope ? { scope: list.scope } : {}) };
  }

  /** Saves the view's options into its smart list (its title's menu, or View options › Update smart list). */
  private updateSmartList(list: SmartList): void {
    const draft = this.smartListAsShown(list);
    if (JSON.stringify(draft) === JSON.stringify(smartListDraft(list))) { new Notice(`“${list.name}” already has these view options`); return; }
    void this.plugin.saveSmartList(draft, list.id).then(() => new Notice(`Updated “${list.name}” with the current view options`))
      .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not save the smart list."); });
  }

  private confirmDeleteSmartList(list: SmartList): void {
    openConfirm(this.app, {
      title: `Delete “${list.name}”?`, message: "Its filters, sorting and grouping are removed. Your tasks are not changed.", confirm: "Delete smart list", danger: true,
      run: () => void this.plugin.deleteSmartList(list.id).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not delete the smart list."); })
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
      const choices: Choice[] = activeProjects(projects).filter(item => !inside(item)).sort((a, b) => a.name.localeCompare(b.name))
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
    const project = this.taskSourcePath ? this.plugin.index.projects().find(project => project.path === this.taskSourcePath) : undefined;
    metadata.hidden = !project;
    if (!project) return;
    // The header's source label names the parent project, so it takes the parent's colour.
    const parentColor = project.parentPath ? this.plugin.index.projectColor(project.parentPath) : undefined;
    if (parentColor) metadata.style.setProperty("--tm-project-color", parentColor);
    else metadata.style.removeProperty("--tm-project-color");
    renderProjectHeaderDetails(metadata, project, property => this.openProjectProperty(project, property), this.plugin.dateFormat(), undefined, undefined, this.plugin.settings.style === "things");
    renderProjectProgress(metadata, project);
  }

  /** What the View default grouping groups this view's tasks by (see renderTaskLayouts and kanbanColumns). */
  private defaultGroupLabel(): string {
    if (this.layout === "calendar") return "None";
    const { mode, path } = this.defaults;
    if (path) return "Heading";
    if (mode === "today") return "Overdue and today";
    if (mode === "upcoming") return "Action date";
    if (mode === "all") return "Note";
    return "None";
  }

  private renderFilters(container: HTMLElement, toggle: HTMLButtonElement): void {
    this.viewOptions = new ViewOptionsPanel(toggle.closest<HTMLElement>(".tm-view-header") ?? container, toggle, {
      state: () => ({
        sort: this.sort, descending: this.descending, grouping: this.grouping, filters: this.propertyFilters,
        // Completed tasks are left out unless shown or a status filter asks, on boards too.
        openOnly: !this.showCompleted, defaultGroup: this.defaultGroupLabel(),
        // The calendar has no room for projects.
        showProjects: this.showProjects
      }),
      update: change => {
        if (change.sort !== undefined) this.sort = change.sort;
        if (change.descending !== undefined) this.descending = change.descending;
        if (change.grouping !== undefined) this.grouping = change.grouping;
        if (change.filters !== undefined) this.propertyFilters = change.filters;
        if (change.showProjects !== undefined) this.showProjects = change.showProjects;
        this.saveViewOptions();
        this.renderTaskResults();
      },
      clear: () => {
        this.propertyFilters = [];
        this.sort = "date"; this.descending = false; this.grouping = "default"; this.showProjects = true;
        this.saveViewOptions();
        this.renderTaskResults();
      },
      // Read lazily: the panel outlives task changes, so choices must reflect the current tasks.
      tasks: () => this.plugin.index.allTasks(),
      expanded: () => this.filtersExpanded,
      setExpanded: open => { this.filtersExpanded = open; },
      // A smart list already is one: its options save into it instead.
      ...(this.state.mode !== "smartLists" ? { convert: (anchor: HTMLElement) => this.convertToSmartList(anchor) } : {
        updateSmartList: {
          changed: () => {
            const list = this.plugin.settings.smartLists.find(item => item.id === this.state.smartListId);
            return Boolean(list) && JSON.stringify(this.smartListAsShown(list!)) !== JSON.stringify(smartListDraft(list));
          },
          save: () => {
            const list = this.plugin.settings.smartLists.find(item => item.id === this.state.smartListId);
            if (list) this.updateSmartList(list);
          }
        }
      })
    });
  }

  /**
   * View options › Convert to smart list: a smart list with the view's filters, sorting, grouping and projects that
   * filters this view's tasks (Today's, a project's…), as the view shows them; named in a popover, then opened.
   */
  private convertToSmartList(anchor: HTMLElement): void {
    const { mode, tag } = this.state;
    const scope: SmartListScope | undefined = mode === "tags" ? this.pagePath ? { mode: "tag", path: this.pagePath } : tag ? { mode: "tag", tag } : undefined
      : this.pagePath ? { mode: "project", path: this.pagePath }
      : mode === "inbox" || mode === "today" || mode === "upcoming" ? { mode } : undefined;
    openChoicePopover({
      anchor, label: "Convert to smart list", choices: [],
      input: { placeholder: "Name the smart list", invalid: "", parse: text => text ? { value: text, label: `Create smart list “${text}”` } : undefined },
      choose: name => {
        const draft: SmartListDraft = { name, filters: cloneTaskFilters(this.propertyFilters), sort: this.sort, descending: this.descending, grouping: this.grouping,
          ...(this.showProjects ? {} : { showProjects: false }), ...(scope ? { scope } : {}) };
        void this.plugin.saveSmartList(draft)
          .then(list => this.plugin.openTaskView({ mode: "smartLists", smartListId: list.id }))
          .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not create the smart list."); });
      }
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
    const tags = this.plugin.index.tagSummaries();
    if (!tags.length) {
      container.createDiv({ cls: "tm-empty", text: "No tags yet. Add a tag to a task to see it here." });
      return;
    }
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
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
      button.addEventListener("click", () => {
        if (layout === "gantt" && this.projectLayout !== "gantt") this.ganttAnchor = ganttYearStart(todayIso());
        this.projectLayout = layout; this.saveLayout(); this.render();
      });
    }
    const create = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Create new project", title: "Create new project" } });
    setIcon(create, "plus");
    create.addEventListener("click", () => this.plugin.openProjectCreator());
    const projects = this.plugin.index.projects();
    const statuses = projectStatuses(projects);
    const withStatus = (status: string): Project[] => projects.filter(project => statuses.get(project.path) === status);
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
        navigate: (anchor, zoom, scale) => { this.ganttAnchor = anchor; this.ganttZoom = zoom; this.ganttScale = scale; this.savePeriod(); this.render(); },
        viewportChanged: anchor => { this.ganttAnchor = anchor; },
        scale: this.ganttScale,
        // The timeline redraws itself; the view keeps where it is for its next drawing.
        zoomed: (anchor, zoom, scale) => { this.ganttAnchor = anchor; this.ganttZoom = zoom; this.ganttScale = scale; this.savePeriod(); },
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
    this.renderProjectGroup(container, "Active", withStatus("active"));
    this.renderProjectGroup(container, "Completed", withStatus("completed"));
    this.renderProjectGroup(container, "Archived", withStatus("archived"));
  }

  /** Moves a project dragged to `date` in the calendar: its start goes there and its end keeps its distance, or, with
   * no start, its deadline goes there. */
  private async moveProject(project: Project, date: string): Promise<void> {
    const changes: Partial<Record<"scheduledDate" | "endDate" | "deadline", string>> = {};
    if (project.scheduledDate) {
      if (project.scheduledDate === date) return;
      changes.scheduledDate = date;
      if (project.endDate) changes.endDate = addDays(project.endDate, daysBetween(project.scheduledDate, date));
    } else if (project.deadline && project.deadline !== date) changes.deadline = date;
    else return;
    const file = this.app.vault.getAbstractFileByPath(project.path);
    if (!(file instanceof TFile)) throw new Error("Project note no longer exists.");
    await this.plugin.store.updateFrontmatter(file, (frontmatter: Record<string, unknown>) => updateProjectDates(frontmatter, changes, project, this.plugin.dateFormat()), `Changed dates of “${project.name}”`);
    await this.plugin.index.refreshPath(project.path);
  }

  private renderProjectGroup(container: HTMLElement, title: string, projects: Project[]): void {
    if (!projects.length) return;
    const section = container.createEl("section", { cls: "tm-section" });
    section.createEl("h2", { text: title }).createSpan({ cls: "tm-section-count", text: String(projects.length) });
    const list = section.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    for (const { project, depth } of projectHierarchy(projects)) this.renderProjectRow(list, project, depth);
  }

  /**
   * A project's row, as the Projects list shows it: its progress, name, dates and deadline; a click opens it. `board`:
   * a board's card, in a column too narrow for the dates beside the name.
   */
  private renderProjectRow(list: HTMLElement, project: Project, depth: number, board = false): HTMLElement {
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
      // On phones, and in a board's narrow columns, the dates go below the name, which would otherwise have no room.
      renderThingsProjectDetails({ lead, inline: primary, secondary }, project, { dateFormat: this.plugin.dateFormat(), edit: field => this.openProjectProperty(project, field), datesBelow: Platform.isPhone || board });
      if (!lead.childElementCount) lead.remove();
      if (!secondary.childElementCount) secondary.remove();
      return row;
    }
    const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata tm-project-header-metadata" });
    renderProjectHeaderDetails(metadata, project, property => this.openProjectProperty(project, property), this.plugin.dateFormat(), undefined, primary, false, false);
    if (!metadata.childElementCount) metadata.remove();
    return row;
  }

  private renderGroupAddButton(parent: HTMLElement, title: string, target?: ListDropGroup): void {
    const add = parent.createEl("button", { cls: "clickable-icon tm-group-add-task", attr: {
      type: "button", "aria-label": `Add task to ${title}`, title: `Add task to ${title}`
    } });
    setIcon(add, "plus");
    add.addEventListener("click", event => { event.stopPropagation(); this.addToGroup(target); });
  }

  /** Opens the editor for a new task in a group: its note, section, date or other property. */
  private addToGroup(target?: ListDropGroup): void {
    const blank: Task = { id: "", path: this.taskSourcePath ?? this.plugin.settings.inboxPath, title: "", status: "todo", completed: false, line: 0, endLine: 0, raw: "", indent: 0, childIds: [] };
    this.newTask(draftForGroup(blank, target));
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
    // The whole heading folds too, except its own buttons and links, and a click that ends a text selection in it.
    heading.toggleClass("tm-foldable-heading", true);
    heading.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("button, a, input")) return;
      const selection = heading.ownerDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed && heading.contains(selection.anchorNode)) return;
      this.toggleFold(key);
    });
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
    // The Griply style, which has no cards, always lists them.
    const showSubtasks = this.plugin.settings.style === "griply" || this.plugin.settings.showSubtasks;
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
      if (anchor && placement) { this.sort = "source"; this.descending = false; this.saveViewOptions(); }
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
    // Working in the task menu, a popover or the Task Details sidebar (which shows the selected task) edits the selection; it
    // does not end it.
    if (target?.closest?.(".tm-task-menu, .tm-date-popover, .tm-choice-popover, .tm-tags-popover, .tm-task-sidebar, .workspace-leaf-content[data-type='task-manager-sidebar']")) return;
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
    else this.openTaskEditor(task, focusProperty);
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
   * For the Task Details sidebar: a property of the shown task, or of the selected tasks together, in a popover beside
   * `anchor`, as their rows (or their menu) edit it; they stay selected. Status and project have their lists.
   */
  editTaskProperty(tasks: Task[], property: TaskEditorProperty | "status" | "project", anchor: HTMLElement): void {
    if (!tasks.length) return;
    if (property === "project") this.editors.project(tasks, anchor);
    else if (property === "status") {
      openChoicePopover({
        anchor, label: "Status", selected: tasks.every(task => task.status === tasks[0].status) ? tasks[0].status : undefined, cycleKey: "s",
        choices: TASK_STATUSES.map(status => ({ value: status, label: STATUS_LABELS[status], icon: STATUS_ICONS[status] })),
        choose: value => this.setTaskStatus(tasks, value as TaskStatus)
      });
    } else if (!this.openPropertyEditor(tasks, property, anchor) && tasks.length === 1) this.openTaskEditor(tasks[0], property);
  }

  /** For the Task Details sidebar: completes, reopens or otherwise sets tasks' status; the selection stays (focus does not move here). */
  setTaskStatus(tasks: Task[], status: TaskStatus): void {
    if (tasks.some(task => task.id === NEW_TASK_ID)) this.patchNewTask({ status, completed: isClosedStatus(status) });
    const changing = tasks.filter(task => task.id !== NEW_TASK_ID && task.status !== status);
    if (changing.length) void this.commit(() => this.plugin.store.setStatus(changing, status));
  }

  /**
   * For the Task Details sidebar: writes a change to one task (its title or notes) and keeps it selected when it was. Changed
   * in place it keeps its line, and so its id; moved to `moveTo`, it is found there by its title.
   */
  async changeTask(task: Task, write: () => Promise<string[]>, moveTo?: string): Promise<void> {
    // Asked of the selection itself: the rows are redrawn a frame after each write, so they can be behind.
    const selected = this.selection.has(task);
    for (const path of await write()) await this.plugin.index.refreshPath(path);
    if (!selected) return;
    const latest = moveTo ? undefined : this.plugin.index.taskById(task.id);
    if (latest) { this.selection.replace(task, latest); this.updateSelection(); }
    else this.reselect([task], moveTo);
  }

  /**
   * For the Task Details sidebar: the selected tasks, as last selected or rewritten (see changeTask), so a task the sidebar
   * just saved stays shown while the rows catch up.
   */
  sidebarSelection(): Task[] { return this.selection.chosen(this.visibleTasks); }

  /**
   * For the Task Details sidebar beside this view's calendar (or Upcoming): the view's own tasks (a project's, a tag's, a smart
   * list's…) that have no date, through its filters but those on dates, in its order. Today's and Upcoming's are every
   * task's, since their own all have dates.
   */
  undatedQuery(): { query: TaskQuery; sort: TaskSort; descending: boolean } {
    const query = this.baseQuery();
    const mode = query.mode === "today" || query.mode === "upcoming" ? "all" : query.mode;
    return { query: { ...query, mode, showCompleted: false, filters: undatedFilters(query.filters ?? []) }, sort: this.sort, descending: this.descending };
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
      pickDate: anchor => void this.editors.date(tasks, "scheduledDate", anchor, true, () => menu.close()),
      setPriority: priority => void this.commit(() => this.plugin.store.bulkUpdate(tasks.filter(item => item.priority !== priority), { priority })),
      submenus: [
        { label: "Project", icon: "folder-input", key: "g", open: anchor => this.editors.project(tasks, anchor, true, () => menu.close()) },
        { label: "Deadline", icon: "flag", key: "D", open: anchor => void this.editors.date(tasks, "deadline", anchor, true, () => menu.close()) },
        { label: "Tags", icon: "tag", key: "t", open: anchor => this.editors.tags(tasks, anchor, true) },
        { label: "Repeat", icon: "repeat", key: "r", open: anchor => this.editors.repeat(tasks, anchor, true, () => menu.close()) },
        { label: "Snooze", icon: "alarm-clock-off", key: "S", open: anchor => this.editors.snooze(tasks, anchor, true, () => menu.close()) },
        { label: "Status", icon: "circle-dot", key: "s", open: anchor => this.editors.status(task, tasks, anchor, () => menu.close()) }
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

  /** A selected task drags the whole selection along; returns what moves. */
  private prepareDrag(task: Task): Task[] {
    const tasks = this.selection.has(task) ? this.getSelectedTasks() : [task];
    this.draggedTasks = tasks;
    const doc = this.selectionRows.get(task.id)?.[0]?.ownerDocument;
    if (doc) startTaskDrag(doc, { tasks, drop: target => this.dropTasks(tasks, target) });
    return tasks;
  }

  /**
   * Dragged tasks dropped on a list in the sidebar: Inbox or a project takes them in, Today schedules them for today,
   * and a tag is added to them. A calendar's day (or hour) in the Task Details sidebar or another pane schedules them then, and
   * a place for tasks without a date takes their dates off. Also for tasks dragged in the Task Details sidebar.
   */
  async dropTasks(tasks: Task[], target: SidebarDrop): Promise<void> {
    this.draggedTasks = [];
    if (target.kind === "schedule") {
      const { date, time } = target;
      const label = `${date ? "Rescheduled" : "Took the dates off"} ${tasks.length === 1 ? `“${tasks[0].title}”` : `${tasks.length} tasks`}`;
      await this.commit(() => this.plugin.store.bulkChange(tasks, task => date ? rescheduledDraft(task, date, time) : draftForGroup(task, { property: "date" }), {}, label));
    } else if (target.kind === "today") {
      const today = todayIso();
      const changing = tasks.filter(task => task.scheduledDate !== today);
      if (changing.length) await this.commit(() => this.plugin.store.bulkUpdate(changing, { scheduledDate: today }));
    } else if (target.kind === "tag") {
      const changing = tasks.filter(task => !(task.tags ?? []).includes(target.tag));
      if (changing.length) await this.commit(() => this.plugin.store.bulkUpdate(changing, task => ({ tags: [...task.tags ?? [], target.tag] })));
    } else {
      const path = target.kind === "inbox" ? this.plugin.settings.inboxPath : target.path;
      const moving = tasks.filter(task => task.path !== path);
      if (moving.length) await this.commit(() => this.plugin.store.bulkUpdate(moving, { destination: path }), "Could not move the task.", { moveTo: path });
    }
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
    // A click selects: alone, or with Cmd/Ctrl to toggle and Shift for a range. On mobile, where a swipe right
    // selects (see bindSwipe), a tap opens the task instead.
    row.addEventListener("click", event => {
      if (Platform.isMacOS && event.ctrlKey) return;
      const additive = Platform.isMacOS ? event.metaKey : event.ctrlKey;
      if (!additive && !event.shiftKey && control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      if (Platform.isMobile && !additive && !event.shiftKey) { open(); return; }
      this.selection.click(task, this.visibleTasks, event.shiftKey, additive);
      row.focus({ preventScroll: true });
      this.updateSelection();
    }, true);
    // A double-click opens the task (on mobile its first tap already has).
    row.addEventListener("dblclick", event => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || control(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      if (Platform.isMobile) return;
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
    // Selecting a task leaves the new task in the Task Details sidebar: written with a title (which may move the selected
    // task's line, so it is found again), else dropped.
    if (this.newTaskEntry?.host === "sidebar" && this.getSelectedTasks().length) {
      const selected = this.getSelectedTasks();
      void this.endNewTask().then(task => { if (task) this.reselect(selected); });
    }
    const selectedRows = new Set<Element>();
    for (const task of this.visibleTasks) for (const row of this.selectionRows.get(task.id) ?? []) {
      const selected = this.selection.has(task);
      row.classList.toggle("is-selected", selected);
      if (selected) selectedRows.add(row);
      // A hidden marker, not an aria-label: a label would replace the row's dates and tags for screen readers.
      const marker = row.querySelector?.(".tm-selected-marker");
      if (marker) marker.textContent = selected ? "Selected" : "";
    }
    // A selected row that the next row's selection continues squares off where they meet.
    for (const rows of this.selectionRows.values()) for (const row of rows) {
      const next = row.nextElementSibling;
      row.classList.toggle("is-selection-continues", selectedRows.has(row) && Boolean(next && selectedRows.has(next)));
    }
    // The Task Details sidebar shows the selected task.
    this.plugin.refreshTaskSidebar?.();
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
      d: (task, row) => void this.editors.date(tasks(task), "scheduledDate", row),
      "shift+d": (task, row) => void this.editors.date(tasks(task), "deadline", row),
      p: (task, row) => void this.editors.priority(tasks(task), row),
      t: (task, row) => this.editors.tags(tasks(task), row),
      g: (task, row) => this.editors.project(tasks(task), row),
      r: (task, row) => this.editors.repeat(tasks(task), row),
      s: (task, row) => this.editors.status(task, tasks(task), row, undefined, false),
      "shift+s": (task, row) => this.editors.snooze(tasks(task), row),
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
    const nesting = this.layout !== "kanban";
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
    const { mode, path } = this.defaults;
    if (path) return "section";
    if (mode === "all") return "source";
    if (mode === "upcoming") return "date";
    return "none";
  }

  private renderTaskRow(list: HTMLElement, task: Task, depth: number, target?: ListDropGroup, foldable = false): void {
    // A project shown among the tasks: its progress in place of a checkbox, and a project's actions.
    const project = this.shownProjects.get(task.id);
    if (project) { this.renderProjectRow(list, project, depth, this.layout === "kanban"); return; }
    if (this.expanded?.id === task.id && this.plugin.settings.style === "things") { this.renderTaskCard(list, task, depth); return; }
    const things = this.plugin.settings.style === "things";
    // Things board cards read like an open task card; list rows are one line.
    const board = things && this.layout === "kanban";
    // A project's colour marks its tasks' source label and board card; its own page needs no marker.
    const color = this.plugin.index.projectColor(task.path);
    const parts = createTaskRow(list, task, {
      cls: `tm-task-item${board ? " tm-things-board-card" : ""}`, depth, repeatCheckbox: things && isRepeatingTask(this.app, task), things, lead: things && !board,
      color: task.path !== this.taskSourcePath ? color : undefined, markColor: true, focusKeys: { checkbox: "checkbox", title: "title" }
    });
    const { row, checkbox, primary, title, lead, metadata } = parts;
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
    this.listDrag?.row(row, primary, task, target);
    title.addEventListener("click", () => this.editTask(task));
    try {
      // Routine-note repeats get an icon; inline `every …` repeats show a Repeat pill in the details instead.
      // (In the Things style the repeat icon is the task's checkbox.)
      if (!things && recurringFile(this.app, task)) {
        const icon = primary.createSpan({ cls: "tm-task-recurring", attr: { role: "img", "aria-label": "Recurring task", title: "Recurring task" } });
        setIcon(icon, "repeat-2");
      }
    } catch { /* Ambiguous recurring links remain editable through the task editor. */ }

    const implicitSource = this.taskSourcePath ?? (this.state.mode === "inbox" ? this.plugin.settings.inboxPath : undefined);
    const tags = this.rowTags(task);
    const details = {
      grouping: this.metadataGrouping, dateFormat: this.plugin.dateFormat(), show: (property: TaskProperty) => property !== "defer",
      source: task.path !== implicitSource ? task.path : undefined, tags,
      edit: (property: TaskEditorProperty) => this.editTask(task, property), openSource: () => { void this.openSource(task); },
      openTag: (tag: string) => void this.openTagView(tag)
    };
    if (board) renderThingsBoardCard(metadata, task, details);
    else if (lead) {
      // With subtasks listed as rows, the mark saying a task has them would only repeat what is in view.
      renderThingsTaskDetails({ lead, inline: primary, secondary: metadata }, task, { ...details, todayMarker: this.state.mode !== "today", subtaskMark: !this.plugin.settings.showSubtasks, datesBelow: Platform.isPhone });
    } else renderTaskDetails(primary, metadata, task, details);
    dropEmptyRowParts(parts);
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
    this.bindSwipe(row, task);
    // After the drag and swipe handlers, so a click that ends a swipe or a long press is dropped before it selects
    // or opens the task.
    this.bindSelection(row, task);
    this.bindRowKeyboard(row, task, target, foldable);
  }

  /** A task page or tag list leaves out the tag it is showing. */
  private rowTags(task: Task): string[] {
    return (task.tags ?? []).filter(tag => {
      if (this.state.mode !== "tags") return true;
      return this.pagePath ? this.app.metadataCache.getFirstLinkpathDest(tag, task.path)?.path !== this.pagePath : tag !== this.state.tag;
    });
  }

  /**
   * Opens a task: in the Things style as a card in place, except in the calendar, which has no room for one; with
   * three panes, in the Task Details sidebar (with the caret in its title, but on phones and tablets, where it only shows).
   */
  private openTask(task: Task): void {
    if (this.plugin.settings.style === "things" && this.layout !== "calendar" && !this.detailsInSidebar) void this.expandCard(task);
    else this.openTaskEditor(task);
  }

  /** `blank`: a new task's card, its title empty to type (its note keeps the placeholder until then). */
  private async expandCard(task: Task, blank = false): Promise<void> {
    await this.cardClosing;
    if (this.expanded?.id === task.id) return;
    // The card open before is saved (a new task's written, or dropped untitled), which may move this task's line.
    if (this.expanded?.id === NEW_TASK_ID) await this.endNewTask();
    else await this.saveCard();
    const latest = this.plugin.index.taskById(task.id);
    const fresh = (latest?.raw === task.raw ? latest : this.plugin.index.tasksForPath(task.path).find(item => item.raw === task.raw)) ?? task;
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
    // Once it has grown, only when it is not all in view, just far enough to show it. (Phones open tasks in the Task
    // Details sidebar, never as a card.)
    if (card) void opened.then(() => { if (card.isConnected) card.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
  }

  /**
   * Saves the card (unless cancelled: `save` off leaves the task as it was), shrinks it back into the space its rows
   * take, then shows the rows. Refreshes wait until it has closed, so the save cannot redraw the card mid-animation.
   */
  private collapseCard(save = true): Promise<void> {
    if (this.cardClosing || !this.expanded) return this.cardClosing ?? Promise.resolve();
    let id = this.expanded.id;
    this.cardClosing = (async () => {
      // A new task's card writes it (with a title, else drops it); the row then focused is the task written.
      if (id === NEW_TASK_ID) id = (await this.endNewTask(save))?.id ?? "";
      else if (save) await this.saveCard();
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
    if (task.id === NEW_TASK_ID) { this.renderNewTaskCard(list, task, depth); return; }
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
      cancel: () => void this.collapseCard(false),
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

  /**
   * The new task's card: what is set in it is what will be written. Enter writes it once titled, as closing it does;
   * closed untitled (Escape), it goes. Its subtasks wait until it is written.
   */
  private renderNewTaskCard(list: HTMLElement, task: Task, depth: number): void {
    const entry = this.newTaskEntry;
    if (!entry) return;
    const focus = this.cardFocus;
    this.cardFocus = undefined;
    const tags = (): string[] => this.newTaskEntry?.task.tags ?? [];
    renderThingsTaskCard(list, {
      task, depth, draft: this.expanded!, tags: tags(), focus, dateFormat: this.plugin.dateFormat(), children: [],
      change: draft => {
        if (this.expanded?.id === task.id) this.expanded = { id: task.id, ...draft };
        this.typeNewTask(draft.title, draft.notes);
      },
      submit: () => { if (this.newTaskEntry?.title.trim()) void this.collapseCard(); },
      cancel: () => void this.collapseCard(false),
      edit: property => void this.editFromCard(task.id, property),
      collapse: () => void this.collapseCard(),
      renameChild: () => {},
      addTags: added => this.patchNewTask({ tags: [...new Set([...tags(), ...added])] }),
      removeTag: tag => this.patchNewTask({ tags: tags().filter(item => item !== tag) }),
      // As a card names a note typed into its title: "Site › Copy".
      project: { label: entry.draft.destination.replace(/\.md(?=#|$)/i, "").split("/").pop()!.replace("#", " › "), choose: anchor => this.editors.project([task], anchor) },
      tagSuggestions: this.plugin.index.tagSummaries().map(tag => tag.name)
    });
  }

  /** Opens a tag's view; an open card is saved and closed first, so nothing typed in it is lost. */
  private async openTagView(tag: string): Promise<void> {
    if (this.expanded) {
      if (this.expanded.id === NEW_TASK_ID) await this.endNewTask();
      else await this.saveCard();
      this.expanded = undefined;
    }
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
      anchor, label: "Move to project", choices: this.editors.projectChoices(task.path), selected: task.path,
      input: this.editors.projectSearch(path => void this.moveCardTask(id, path)), choose: path => void this.moveCardTask(id, path)
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
    const task = this.liveTask(id);
    if (task && !this.openPropertyEditor([task], property, anchor) && id !== NEW_TASK_ID) this.plugin.openEditor({ ...this.state, task, focusProperty: property });
  }

  /** The property popovers, writing through this view (a new task not yet written takes their changes into it). */
  private get editors(): TaskPropertyEditors {
    return this.propertyEditors ??= new TaskPropertyEditors({
      plugin: this.plugin,
      liveTask: id => this.liveTask(id),
      updateTasks: (tasks, patch, failure, keep) => this.updateTasks(tasks, patch, failure, keep),
      setStatus: (task, status, tasks) => this.setStatus(task, status, tasks),
      // The new task's note is the one it will go to.
      pathOf: task => task.id === NEW_TASK_ID && this.newTaskEntry ? splitDestination(this.newTaskEntry.draft.destination).path : task.path
    });
  }

  /** A property's popover, beside `anchor` (else the task's row): dates, times and durations, priority, tags, repeat or snooze. False for anything else. */
  private openPropertyEditor(tasks: Task[], property: TaskEditorProperty, anchor = this.popoverAnchor()): boolean {
    const target = anchor ?? (tasks[0] && this.selectionRows.get(tasks[0].id)?.[0]) ?? this.content;
    return Boolean(target) && this.editors.open(tasks, property, target);
  }

  /** The property just clicked or focused, for a popover to open beside; else the view. */
  private popoverAnchor(): HTMLElement | undefined {
    const active = this.content?.ownerDocument.activeElement as HTMLElement | null | undefined;
    return active && this.content?.contains(active) ? active : undefined;
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
