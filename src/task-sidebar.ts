import { ItemView, Notice, Platform, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import { NEW_TASK_ID, TaskMainView } from "./task-view";
import { splitDestination } from "./structure";
import { renderCalendar } from "./calendar-view";
import { ListDragController } from "./list-drag-view";
import { activeTaskDrag, markDropZone, startTaskDrag, TASK_DRAG_TYPE, type SidebarDrop, type TaskDrag } from "./sidebar-drop";
import { NEW_TASK_TITLE, taskTitleLabel } from "./task-title";
import { renderThingsTaskDetails } from "./things-row-details";
import { calendarDate, rescheduledDraft } from "./calendar";
import { todayIso } from "./date";
import { parseTaskInput, repeatLabel } from "./parser";
import { sortTasks } from "./query";
import { isRepeatingTask } from "./recurring-task";
import { draftFromTask, draftFromTitle, draftMatchesTask } from "./task-draft";
import type { TaskEditorProperty } from "./task-editor";
import { taskInputRanges } from "./task-input";
import { deadlineIsDistant, deadlineIsOverdue, editable, renderTaskDetails, taskDeadlineCountdown, taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import { STATUS_ICONS, STATUS_LABELS, checkboxLabel, statusClass } from "./task-status";
import { PRIORITY_NAMES, cardNotes, longDate, paintTokens, repeatIcon, type TaskCardDraft } from "./things-task-card";
import type { Task, TaskEditorPreset } from "./types";

export const TASK_SIDEBAR_VIEW = "task-manager-sidebar";

/** What the sidebar shows for the task view in front: Today's calendar, Upcoming's tasks with no date, or the selected
 * task. */
type SidebarMode = "today" | "upcoming" | "details";
/** A property the sidebar edits through the task view showing the task (see TaskMainView.editTaskProperty). */
type SidebarProperty = TaskEditorProperty | "status" | "project";

const noteName = (path: string): string => path.replace(/\.md$/i, "").split("/").pop() ?? path;
const isTextField = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type === "text");

function autosize(area: HTMLTextAreaElement): void {
  area.setCssStyles({ height: "auto" });
  area.setCssStyles({ height: `${area.scrollHeight}px` });
}

/** One part of the sidebar, redrawn only when what it shows changes, so typing in one is not disturbed by the other. */
interface Section { element: HTMLElement; drawn?: string }

/** Upcoming's tasks without a date show in pages, so a large vault does not build every row at once. */
const LIST_PAGE = 100;

/**
 * The Task Details sidebar (in the right sidebar by default). Its content follows the task view in front: with Today open, the
 * day's hours; with Upcoming open, the tasks with no date (beside a calendar, the view's own); and below them when a task is selected (or, anywhere else,
 * filling it) the selected task's details, editable in place. Only the tasks show: no headings or calendar controls. Tasks drag between it and
 * the view: onto an hour to schedule them then, from the tasks without a date onto a day.
 */
export class TaskSidebarView extends ItemView {
  private mode?: SidebarMode;
  /** The shown task's title and notes as typed (and a subtask being typed); `dirty` until they are saved. */
  private draft?: { id: string; dirty: boolean } & TaskCardDraft;
  /** Saves and writes, one after another, so each sees the task as the last one left it. */
  private saving: Promise<void> = Promise.resolve();
  /** The layout drawn (mode, style, density) and its parts: the day or the list on top, then the details. */
  private skeleton = "";
  private planner?: Section;
  private details?: Section;
  /**
   * A task selected here (in the day or the list), or shown here by the view (one it does not list), shown in the
   * details until the view's selection changes.
   */
  private localId?: string;
  /** The view's selection as last seen, to tell when it changes. */
  private viewSelection = "";
  private listRows = LIST_PAGE;
  private listDrag?: ListDragController;
  private indexVersion = 0;
  private renderFrame?: number;
  private closed = false;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string { return TASK_SIDEBAR_VIEW; }
  getDisplayText(): string { return "Task Details"; }
  getIcon(): string { return "circle-check-big"; }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.index.subscribe(() => { this.indexVersion++; this.scheduleRender(); });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRender()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    if (this.renderFrame !== undefined) this.containerEl.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = undefined;
    await this.saveDraft();
  }

  private get content(): HTMLElement { return this.containerEl.children[1] as HTMLElement; }

  /** Bursts of changes (index updates, a new selection, another tab) redraw once, on the next frame. */
  scheduleRender(): void {
    if (this.renderFrame !== undefined || this.closed) return;
    this.renderFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.renderFrame = undefined;
      if (!this.closed) this.render();
    });
  }

  /** The task view the sidebar follows: the active one, or with a sidebar in front, the main area's last one. */
  private taskView(): TaskMainView | undefined {
    const workspace = this.app.workspace;
    const view = workspace.getActiveViewOfType(TaskMainView) ?? workspace.getMostRecentLeaf()?.view;
    return view instanceof TaskMainView ? view : undefined;
  }

  /** `force`: redraw both parts, even unchanged. */
  render(force = false): void {
    const view = this.taskView();
    const state = view?.getState();
    // A calendar, like Upcoming, has the tasks without a date beside it, to drag onto a day.
    const mode: SidebarMode = !view ? "details" : view.hasCalendar ? "upcoming"
      : !view.pagePath && (state?.mode === "today" || state?.mode === "upcoming") ? state.mode : "details";
    const selected = view?.sidebarSelection() ?? [];
    // A task selected in the view takes over from one selected here.
    const viewSelection = selected.map(task => task.id).join("\n");
    if (viewSelection !== this.viewSelection) {
      this.viewSelection = viewSelection;
      if (selected.length) this.localId = undefined;
    }
    if (mode !== this.mode) { this.localId = undefined; this.listRows = LIST_PAGE; }
    const local = this.localId ? this.plugin.index.taskById(this.localId) : undefined;
    if (!local) this.localId = undefined;
    // A new task the view started here (three panes) comes first, until it is written or dropped.
    const entry = view?.newTaskInSidebar();
    const task = entry?.task ?? local ?? (selected.length === 1 ? selected[0] : undefined);
    this.followTask(task, entry);
    const settings = this.plugin.settings;
    const skeleton = [mode, settings.style, settings.density].join("|");
    if (skeleton !== this.skeleton || !this.details?.element.isConnected) this.build(mode, skeleton);
    this.mode = mode;
    const planner = this.planner;
    if (planner && view && mode !== "details") {
      // The tasks without a date are the view's own: a project's, a tag's, a smart list's…
      const undated = mode === "upcoming" ? view.undatedQuery() : undefined;
      this.draw(planner, JSON.stringify([todayIso(), this.indexVersion, this.listRows, undated, settings.calendarProjectColors, settings.calendarPriorityColors]), force,
        () => undated ? this.renderUndated(planner.element, undated) : this.renderToday(planner.element));
      for (const element of Array.from(planner.element.querySelectorAll<HTMLElement>("[data-task-id]"))) element.toggleClass("is-selected", element.getAttribute("data-task-id") === this.localId);
    }
    const details = this.details!;
    // Below Today's hours or Upcoming's list, the details take room only for a selected task, and as much as it needs.
    const shown = mode === "details" || Boolean(task);
    details.element.hidden = !shown;
    // A new task redraws as its properties change (not as it is typed).
    this.draw(details, JSON.stringify([shown, Boolean(view), local ? "local" : selected.length, task?.id, entry && [entry.task, entry.destination], task?.raw, task?.description, task && this.children(task).map(child => child.raw)]), force,
      () => { if (shown) this.renderDetails(details.element, view, entry ? [] : local ? [local] : selected, task, entry?.destination); });
  }

  /** Lays the sidebar out for a mode: in Today and Upcoming, their tasks over the selected task's details; else the details alone. */
  private build(mode: SidebarMode, skeleton: string): void {
    const container = this.content;
    const settings = this.plugin.settings;
    container.empty();
    // It shares the task views' styles (checkboxes, rows, the calendar), which hang off .tm-main-view.
    container.addClass("tm-main-view", "tm-task-sidebar");
    container.toggleClass("tm-style-things", settings.style === "things");
    container.toggleClass("tm-style-griply", settings.style === "griply");
    container.toggleClass("tm-density-compact", settings.density === "compact");
    for (const name of ["today", "upcoming", "details"] as const) container.toggleClass(`is-${name}`, mode === name);
    this.planner = mode === "details" ? undefined : { element: container.createDiv({ cls: "tm-sidebar-planner", attr: { "data-tm-scroll-key": "sidebar-planner" } }) };
    if (mode === "upcoming") this.takeUndatedDrops(this.planner!.element);
    this.details = { element: container.createDiv({ cls: "tm-sidebar-pane", attr: { "data-tm-scroll-key": "sidebar-details" } }) };
    this.skeleton = skeleton;
  }

  private draw(section: Section, drawn: string, force: boolean, render: () => void): void {
    if (!force && section.drawn === drawn) return;
    const first = section.drawn === undefined;
    section.drawn = drawn;
    this.preserveView(section.element, !first, () => { section.element.empty(); render(); });
  }

  /** Re-rendering replaces every element; focus (with its caret) and scroll positions go back where they were. */
  private preserveView(root: HTMLElement, scroll: boolean, update: () => void): void {
    const active = root.ownerDocument.activeElement;
    const key = active && root.contains(active) ? active.closest("[data-tm-focus-key]")?.getAttribute("data-tm-focus-key") : undefined;
    const range = isTextField(active) ? [active.selectionStart ?? 0, active.selectionEnd ?? 0] as const : undefined;
    const scrolled = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[data-tm-scroll-key]"))]
      .map(element => ({ key: element === root ? "" : element.getAttribute("data-tm-scroll-key") ?? "", top: element.scrollTop }));
    update();
    if (scroll) for (const { key, top } of scrolled) {
      const element = key ? root.querySelector<HTMLElement>(`[data-tm-scroll-key="${CSS.escape(key)}"]`) : root;
      if (element) element.scrollTop = top;
    }
    const target = key ? root.querySelector<HTMLElement>(`[data-tm-focus-key="${CSS.escape(key)}"]`) : null;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (range && isTextField(target)) target.setSelectionRange(range[0], range[1]);
  }

  /** Shows a task of the day or the list in the details, until another is selected here or in the view. */
  private select(task: Task): void {
    this.localId = task.id;
    this.render();
  }

  /**
   * Shows a task the view opened, or its new task (three panes; see TaskMainView.revealInSidebar): `focus` puts the
   * caret in its title.
   */
  showTask(id: string, options: { focus?: boolean } = {}): void {
    // Settle on the view in front first (a redraw may be pending), so the task is not taken for the last view's.
    this.render();
    if (id !== NEW_TASK_ID) this.localId = id;
    this.render();
    if (options.focus) this.content.querySelector<HTMLTextAreaElement>(".tm-sidebar-title-field")?.focus();
  }

  /** A time clicked in Today's hours adds a task then: with three panes, here, as the view adds one; else in the task editor. */
  private addTask(preset: TaskEditorPreset): void {
    const view = this.taskView();
    if (view && this.plugin.settings.taskDetails === "sidebar") view.newTask(preset);
    else this.plugin.openEditor({ mode: "all", preset });
  }

  /** Starts a drag of tasks here, which a sidebar list, another pane, or a view's own drop zones can take. */
  private startDrag(tasks: Task[]): Task[] {
    startTaskDrag(this.content.ownerDocument, { tasks, drop: target => this.dropTasks(tasks, target) });
    return tasks;
  }

  /** What dropping tasks dragged here does is the view's to decide, as for its own (so its selection is kept). */
  private async dropTasks(tasks: Task[], target: SidebarDrop): Promise<void> {
    await this.taskView()?.dropTasks(tasks, target);
  }

  // Today: the day's hours. Upcoming, or beside a calendar: the view's tasks without a date, as list rows.

  private renderToday(element: HTMLElement): void {
    const tasks = sortTasks(this.plugin.index.query({ mode: "all", showCompleted: false }).filter(task => calendarDate(task)));
    renderCalendar(element.createDiv({ cls: "tm-sidebar-calendar" }), {
      // Today's hours only: no toolbar, no all-day row, and the period never changes.
      anchor: todayIso(), scope: "day", toolbar: false, allDay: false, tasks, dateFormat: this.plugin.dateFormat(), navigate: () => {},
      color: task => this.plugin.settings.calendarProjectColors ? this.plugin.index.projectColor(task.path) : undefined,
      priorityColors: this.plugin.settings.calendarPriorityColors,
      create: preset => this.addTask(preset),
      // A click shows the task in the details below.
      bind: (card, task) => {
        card.setAttribute("data-task-id", task.id);
        card.addEventListener("click", event => { event.stopPropagation(); this.select(task); });
      },
      edit: task => this.select(task),
      dragStart: task => { this.startDrag([task]); },
      toggle: (task, completed) => this.plugin.store.toggle(task, completed),
      move: (task, date, time) => this.dropTasks([task], { kind: "schedule", date, time }),
      resize: async (task, date, time, duration) => {
        await this.plugin.store.update(task, { ...rescheduledDraft(task, date, time), durationMinutes: duration });
        await this.plugin.index.refreshPath(task.path);
      }
    });
  }

  /**
   * The view's tasks without a date (Upcoming's: All Tasks with No date for both dates), as a list's rows; they drag
   * onto a day in the view, and tasks dragged here from the view lose their dates.
   */
  private renderUndated(element: HTMLElement, { query, sort, descending }: ReturnType<TaskMainView["undatedQuery"]>): void {
    const all = sortTasks(this.plugin.index.query(query), sort, descending);
    const ids = new Set(all.map(task => task.id));
    // Subtasks go with their task.
    const tasks = all.filter(task => !task.parentId || !ids.has(task.parentId));
    if (!tasks.length) {
      const empty = element.createDiv({ cls: "tm-empty tm-sidebar-empty" });
      setIcon(empty.createDiv({ cls: "tm-empty-icon" }), "calendar-check");
      empty.createEl("h3", { text: "Every task has a date" });
      return;
    }
    // Its rows drag to the view (or a sidebar list); among themselves, there is nothing to reorder.
    this.listDrag = new ListDragController(id => this.plugin.index.taskById(id), async () => {}, false, task => this.startDrag([task]), false);
    const list = element.createDiv({ cls: "tm-task-list", attr: { role: "list", "aria-label": "Tasks without a date" } });
    for (const task of tasks.slice(0, this.listRows)) this.renderRow(list, task);
    const hidden = tasks.length - this.listRows;
    if (hidden > 0) {
      const more = element.createEl("button", { cls: "tm-show-more-tasks", text: `Show ${Math.min(LIST_PAGE, hidden)} more (${hidden} hidden)`, attr: { type: "button", "data-tm-focus-key": "sidebar-show-more" } });
      more.addEventListener("click", () => { this.listRows += LIST_PAGE; this.render(); });
    }
  }

  /**
   * Tasks dragged here from the view (its list's rows, or its calendar's cards) take their dates off; a slot opens at the
   * top of the list meanwhile.
   */
  private takeUndatedDrops(element: HTMLElement): void {
    let gap: HTMLElement | undefined;
    const show = (drag: TaskDrag): void => {
      gap ??= element.ownerDocument.createElement("div");
      gap.className = "tm-drop-gap";
      gap.style.setProperty("--tm-gap-height", `${drag.height ?? 32}px`);
      const host = element.querySelector(".tm-task-list") ?? element;
      if (host.firstElementChild !== gap) host.prepend(gap);
    };
    const leave = (): void => { gap?.remove(); gap = undefined; };
    markDropZone(element, {
      hover: (_point, drag) => show(drag),
      leave,
      drop: async (_point, drag) => { leave(); await drag.drop({ kind: "schedule" }); }
    });
    // A calendar card drags natively; tasks without a date (this list's own) have nothing to take off.
    const native = (event: DragEvent): TaskDrag | undefined => {
      const drag = event.dataTransfer?.types.includes(TASK_DRAG_TYPE) ? activeTaskDrag() : undefined;
      return drag?.tasks.some(task => task.scheduledDate || task.deadline) ? drag : undefined;
    };
    element.addEventListener("dragover", event => {
      const drag = native(event);
      if (!drag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      show(drag);
    });
    element.addEventListener("dragleave", event => { if (!element.contains(event.relatedTarget as Node | null)) leave(); });
    element.addEventListener("drop", event => {
      const drag = native(event);
      leave();
      if (!drag) return;
      event.preventDefault();
      void drag.drop({ kind: "schedule" });
    });
  }

  /** A task's row, as a list shows it in the chosen style: its checkbox, title and properties; a click shows its details. */
  private renderRow(list: HTMLElement, task: Task): void {
    const things = this.plugin.settings.style === "things";
    const row = list.createDiv({ cls: `tm-task-row tm-task-item${task.completed ? " is-completed" : ""}`, attr: { role: "listitem", tabindex: "0", "data-task-id": task.id } });
    row.style.setProperty("--tm-depth", "0");
    const repeating = things && isRepeatingTask(this.app, task);
    const target = row.createEl("label", { cls: `tm-checkbox-target${repeating ? ` tm-repeat-target${task.priority ? ` is-p${task.priority}` : ""}` : ""}` });
    const checkbox = target.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task) } });
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => this.toggle(task, checkbox.checked, task.id === this.draft?.id));
    if (repeating) repeatIcon(target);
    const content = row.createDiv({ cls: "tm-task-content" });
    const primary = content.createDiv({ cls: "tm-task-primary" });
    this.listDrag?.row(row, primary, task);
    const color = this.plugin.index.projectColor(task.path);
    if (color) { row.addClass("has-project-color"); row.style.setProperty("--tm-project-color", color); }
    const lead = things ? primary.createSpan({ cls: "tm-things-lead" }) : undefined;
    primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title), "data-tm-focus-key": `sidebar-row:${task.id}` } });
    const metadata = content.createDiv({ cls: things ? "tm-things-secondary" : "tm-task-metadata" });
    const view = this.taskView();
    const details = {
      grouping: "none" as const, dateFormat: this.plugin.dateFormat(), show: (property: string) => property !== "defer", source: task.path, tags: task.tags ?? [],
      edit: (property: TaskEditorProperty) => { if (view) void this.edit(view, task, property); },
      openSource: () => void this.openSource(task)
    };
    if (lead) {
      renderThingsTaskDetails({ lead, inline: primary, secondary: metadata }, task, { ...details, todayMarker: true, subtaskMark: true, datesBelow: Platform.isMobile });
      if (!lead.childElementCount) lead.remove();
    } else renderTaskDetails(primary, metadata, task, details);
    if (!metadata.childElementCount) metadata.remove();
    // The title selects as the rest of the row does; the checkbox and properties keep their own actions.
    row.addEventListener("click", event => {
      const control = (event.target as HTMLElement).closest("input, label, a, [role=button]:not(.tm-task-item)");
      if (!control) this.select(task);
    });
    row.addEventListener("keydown", event => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); this.select(task); }
    });
  }

  // The selected task.

  private children(task: Task): Task[] {
    return task.childIds.map(id => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child));
  }

  /**
   * Another task shown saves the last one's typing first; an untouched draft takes the task's current text (a new
   * task, what is typed for it, which the view keeps).
   */
  private followTask(task: Task | undefined, entry?: { title: string; notes: string }): void {
    if (this.draft && this.draft.id !== task?.id) {
      void this.saveDraft();
      this.draft = undefined;
    }
    if (task && !this.draft?.dirty) this.draft = { id: task.id, dirty: false, title: entry?.title ?? task.title, notes: entry?.notes ?? cardNotes(task.description), subtask: this.draft?.subtask };
  }

  private typed(task: Task, next: TaskCardDraft): void {
    if (this.draft?.id !== task.id) return;
    // A new task's typing is the view's to keep until it is written.
    if (task.id === NEW_TASK_ID) { this.draft = { ...next, id: task.id, dirty: false }; this.taskView()?.typeNewTask(next.title, next.notes); return; }
    const dirty = this.draft.dirty || next.title !== this.draft.title || next.notes !== this.draft.notes;
    this.draft = { ...next, id: task.id, dirty };
  }

  /**
   * Writes the typed title and notes when they changed (tokens in the title set properties, as in a card), keeping the
   * task selected in its view; then redraws, so the title shows what was read from it.
   */
  private saveDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft?.dirty) return this.saving;
    const typed = { ...draft };
    this.saving = this.saving.then(async () => {
      const task = this.plugin.index.taskById(typed.id);
      if (!task) return;
      // A title cleared keeps the task's own.
      const next = draftFromTitle(task, typed.title.trim() ? typed.title : task.title, new Date(), this.plugin.dateFormat());
      const notes = typed.notes.trim() === cardNotes(task.description).trim() ? undefined : typed.notes;
      try {
        if (!draftMatchesTask(task, next) || notes !== undefined) {
          const moveTo = next.destination !== draftFromTask(task).destination ? next.destination.split("#")[0] : undefined;
          // Saving puts the line's properties in order, as a card does.
          await this.change(task, async () => {
            await this.plugin.store.update(task, { ...next, description: notes, sortProperties: true });
            return moveTo ? [task.path, moveTo] : [task.path];
          }, moveTo);
        }
        // Anything typed while saving is still to save.
        const current = this.draft;
        if (current?.id === typed.id && current.title === typed.title && current.notes === typed.notes) {
          current.dirty = false;
          if (!this.closed) this.render(true);
        }
      } catch (cause) {
        new Notice(cause instanceof Error ? cause.message : "Could not save the task.");
      }
    });
    return this.saving;
  }

  /** Writes a change to the shown task through its view, which keeps it selected (and so shown here). */
  private async change(task: Task, write: () => Promise<string[]>, moveTo?: string): Promise<void> {
    const view = this.taskView();
    if (view) await view.changeTask(task, write, moveTo);
    else for (const path of await write()) await this.plugin.index.refreshPath(path);
  }

  /** The property just clicked or focused, for a popover to open beside. */
  private popoverAnchor(): HTMLElement | undefined {
    const active = this.content.ownerDocument.activeElement as HTMLElement | null;
    return active && this.content.contains(active) ? active : undefined;
  }

  /** Edits a property in its popover, as the task's row would; the typing is saved first, so it edits the task as it now reads. */
  private async edit(view: TaskMainView, task: Task, property: SidebarProperty, anchor = this.popoverAnchor()): Promise<void> {
    const key = anchor?.getAttribute("data-tm-focus-key");
    await this.saveDraft();
    // Saving redraws: open beside the same control in the new drawing.
    const target = anchor?.isConnected ? anchor : (key ? this.content.querySelector<HTMLElement>(`[data-tm-focus-key="${CSS.escape(key)}"]`) : null) ?? this.content;
    view.editTaskProperty(this.plugin.index.taskById(task.id) ?? task, property, target);
  }

  /** The shown task's checkbox keeps it selected (completing a recurring task moves its dates); a subtask's just toggles. */
  private toggle(task: Task, completed: boolean, shown: boolean): void {
    const failed = (cause: unknown): void => { new Notice(cause instanceof Error ? cause.message : "Could not update the task."); };
    if (!shown) { void this.plugin.store.toggle(task, completed).catch(failed); return; }
    void this.saveDraft();
    // As the task reads once any typing is saved.
    this.saving = this.saving.then(() => {
      const current = this.plugin.index.taskById(task.id) ?? task;
      return this.change(current, async () => { await this.plugin.store.toggle(current, completed); return [current.path]; });
    }).catch(failed);
  }

  private renameChild(child: Task, title: string): void {
    // A subtask stays under its task: its title's tokens set properties but do not move it.
    const draft = draftFromTitle(child, title, new Date(), this.plugin.dateFormat(), false);
    if (draftMatchesTask(child, draft)) return;
    void this.plugin.store.update(child, { ...draft, sortProperties: true })
      .then(() => this.plugin.index.refreshPath(child.path))
      .catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not rename the subtask."); });
  }

  /** Writes a typed subtask after `after` (the last one); its field stays focused for the next. */
  private async addSubtask(parentId: string, title: string, after: Task | undefined): Promise<void> {
    const parent = this.plugin.index.taskById(parentId);
    if (!parent) return;
    try {
      // Everything in a new subtask was just typed, so its natural-language dates count too.
      const parsed = parseTaskInput(title, new Date(), this.plugin.dateFormat());
      await this.plugin.store.addSubtask(parent, parsed?.title.trim() ? parsed : { title }, after);
      await this.plugin.index.refreshPath(parent.path);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not add the subtask.");
    }
  }

  private async openSource(task: Task): Promise<void> {
    await this.saveDraft();
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file, { eState: { line: task.line } });
  }

  /** `destination`: for a new task, the note it will go to. */
  private renderDetails(container: HTMLElement, view: TaskMainView | undefined, selected: Task[], task: Task | undefined, destination?: string): void {
    if (!view || !task) {
      const empty = container.createDiv({ cls: "tm-empty tm-sidebar-empty" });
      setIcon(empty.createDiv({ cls: "tm-empty-icon" }), selected.length > 1 ? "list-checks" : "mouse-pointer-click");
      empty.createEl("h3", { text: selected.length > 1 ? `${selected.length} tasks selected` : "No task selected" });
      empty.createEl("p", { text: selected.length > 1 ? "Right-click them, or press E, to change them together."
        : view ? "Select a task to see its details here." : "Select a task in a task view to see its details here." });
      return;
    }
    this.renderTaskDetails(container, view, task, destination);
    // A new task is in no note yet.
    if (task.id === NEW_TASK_ID) return;
    const footer = container.createDiv({ cls: "tm-sidebar-footer" });
    const open = footer.createEl("button", { cls: "tm-sidebar-open-note", attr: { type: "button", title: task.path, "data-tm-focus-key": "sidebar-open-note" } });
    setIcon(open.createSpan({ cls: "tm-sidebar-open-note-icon", attr: { "aria-hidden": "true" } }), "file-text");
    open.createSpan({ text: "Open in note" });
    open.addEventListener("click", () => void this.openSource(task));
  }

  /** Typing is saved once focus leaves the title and notes (moving between the two keeps it). */
  private saveOnLeave(root: HTMLElement, fields: string): void {
    root.addEventListener("focusout", event => {
      if (!(event.target as HTMLElement | null)?.matches?.(fields)) return;
      if ((event.relatedTarget as HTMLElement | null)?.matches?.(fields)) return;
      void this.saveDraft();
    });
  }

  /**
   * The title over a list of the task's properties, each a row that opens its editor, then its notes and subtasks; in
   * either style, drawn in its colours and checkboxes.
   */
  private renderTaskDetails(container: HTMLElement, view: TaskMainView, task: Task, destination?: string): void {
    const draft = this.draft!;
    // A new task, not yet written: Enter writes it (once titled), Escape writes it titled or drops it untitled.
    const isNew = task.id === NEW_TASK_ID;
    const now = new Date();
    const today = todayIso(now);
    const dateFormat = this.plugin.dateFormat();
    const panel = container.createDiv({ cls: "tm-sidebar-details" });

    const head = panel.createDiv({ cls: "tm-sidebar-head" });
    // As in its row: in the Things style a recurring task's checkbox is its repeat icon.
    const repeating = this.plugin.settings.style === "things" && isRepeatingTask(this.app, task);
    const box = head.createEl("label", { cls: `tm-checkbox-target${repeating ? ` tm-repeat-target${task.priority ? ` is-p${task.priority}` : ""}` : ""}` });
    const checkbox = box.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task), "data-tm-focus-key": "sidebar-checkbox" } });
    checkbox.checked = task.completed;
    if (isNew) checkbox.disabled = true;
    else checkbox.addEventListener("change", () => this.toggle(task, checkbox.checked, true));
    if (repeating) repeatIcon(box);
    // As in a card: the title is one wrapping line, and what saving reads as a property is marked behind it.
    const titleBox = head.createDiv({ cls: "tm-things-card-title-box" });
    const backdrop = titleBox.createDiv({ cls: "tm-things-card-title-backdrop", attr: { "aria-hidden": "true" } });
    const title = titleBox.createEl("textarea", { cls: "tm-things-card-title tm-sidebar-title-field", attr: { "aria-label": "Title", placeholder: isNew ? NEW_TASK_TITLE : "Title", rows: "1", "data-tm-focus-key": "sidebar-title" } });
    title.value = draft.title;
    const paint = (): void => paintTokens(backdrop, title.value, taskInputRanges(title.value, task.title, now, dateFormat));
    paint();

    const properties = panel.createDiv({ cls: "tm-sidebar-properties", attr: { role: "group", "aria-label": "Properties" } });
    const row = (icon: string, name: string, property: SidebarProperty, fill: (value: HTMLElement) => void, cls = ""): void => {
      const element = properties.createDiv({ cls: `tm-sidebar-property${cls ? ` ${cls}` : ""}` });
      const label = element.createSpan({ cls: "tm-sidebar-property-name" });
      setIcon(label.createSpan({ cls: "tm-sidebar-property-icon", attr: { "aria-hidden": "true" } }), icon);
      label.createSpan({ text: name });
      const value = element.createSpan({ cls: "tm-sidebar-property-value" });
      fill(value);
      if (!value.childElementCount && !value.textContent) { value.addClass("is-empty"); value.setText("None"); }
      editable(element, `${name}: ${value.textContent}`, `sidebar-${property}`, () => void this.edit(view, task, property, element));
    };
    row(STATUS_ICONS[task.status], "Status", "status", value => { value.setText(STATUS_LABELS[task.status]); }, `is-status${statusClass(task.status)}`);
    row("calendar", "Date", "scheduledDate", value => {
      const time = taskTimeDurationLabel(task.scheduledTime, task.durationMinutes);
      const day = task.scheduledDate ? task.scheduledDate === today ? "Today" : longDate(task.scheduledDate, now) : "";
      value.setText([day, time].filter(Boolean).join(", "));
      value.toggleClass("is-overdue", Boolean(task.scheduledDate && task.scheduledDate < today && !task.completed));
    });
    row("flag", "Deadline", "deadline", value => {
      if (!task.deadline) return;
      const pill = value.createSpan({ cls: `tm-task-due${deadlineIsDistant(task.deadline, now) ? " is-distant" : ""}${!task.completed && deadlineIsOverdue(task.deadline, task.deadlineTime, now) ? " is-overdue" : ""}` });
      setIcon(pill.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
      pill.createSpan({ text: taskDeadlineCountdown(task.deadline, now) });
      value.createSpan({ cls: "tm-sidebar-property-extra", text: `${longDate(task.deadline, now)}${task.deadlineTime ? `, ${taskTimeLabel(task.deadlineTime)}` : ""}` });
    });
    row("signal", "Priority", "priority", value => { if (task.priority) value.setText(`P${task.priority} · ${PRIORITY_NAMES[task.priority]}`); }, task.priority ? `is-p${task.priority}` : "");
    row("folder", "Project", "project", value => {
      const path = destination ? splitDestination(destination).path : task.path;
      const source = value.createSpan({ cls: "tm-task-source", text: path === this.plugin.settings.inboxPath ? "Inbox" : noteName(path) });
      const color = this.plugin.index.projectColor(path);
      if (color) source.style.setProperty("--tm-project-color", color);
    });
    row("tag", "Tags", "tags", value => {
      for (const tag of task.tags ?? []) {
        const pill = value.createSpan({ cls: "tm-task-tag" });
        setIcon(pill.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "tag");
        pill.createSpan({ text: tag });
      }
    });
    row("repeat", "Repeat", "repeat", value => { if (task.repeat) value.setText(repeatLabel(task.repeat)); });
    row("eye-off", "Hidden until", "defer", value => { value.setText(task.someday ? "Someday" : task.deferDate ? longDate(task.deferDate, now) : ""); });

    panel.createEl("h5", { cls: "tm-sidebar-section-title", text: "Notes" });
    const notes = panel.createEl("textarea", { cls: "tm-sidebar-notes", attr: { "aria-label": "Notes", placeholder: "Add notes", rows: "2", "data-tm-focus-key": "sidebar-notes" } });
    notes.value = draft.notes;
    const change = (): void => this.typed(task, { title: title.value, notes: notes.value, subtask: this.draft?.subtask });
    title.addEventListener("input", () => {
      if (/[\r\n]/.test(title.value)) title.value = title.value.replace(/[\r\n]+/g, " ");
      autosize(title); paint(); change();
    });
    notes.addEventListener("input", () => { autosize(notes); change(); });
    // Enter in the title moves on to the notes; Escape saves and leaves the field. A new task's Enter writes it once
    // titled, and its Escape writes it titled or drops it untitled.
    panel.addEventListener("keydown", event => {
      const target = event.target as HTMLElement;
      if (target === title && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        if (!isNew) notes.focus();
        else if (title.value.trim()) void view.finishNewTask();
      } else if ((target === title || target === notes) && event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (isNew) void view.finishNewTask();
        else target.blur();
      }
    });
    const fit = (): void => { autosize(title); autosize(notes); };
    if (panel.isConnected) fit();
    window.requestAnimationFrame(fit);
    this.saveOnLeave(panel, ".tm-sidebar-title-field, .tm-sidebar-notes");

    // A new task's subtasks wait until it is written.
    if (!isNew) this.renderSubtasks(panel, task);
  }

  /** The subtasks: each checks off and renames in place; the last line adds one, and Enter starts the next. */
  private renderSubtasks(panel: HTMLElement, task: Task): void {
    const children = this.children(task);
    const heading = panel.createEl("h5", { cls: "tm-sidebar-section-title", text: "Subtasks" });
    if (children.length) heading.createSpan({ cls: "tm-sidebar-section-count", text: `${children.filter(child => child.completed).length}/${children.length}` });
    const list = panel.createDiv({ cls: "tm-sidebar-subtasks", attr: { role: "list", "aria-label": "Subtasks" } });
    for (const child of children) {
      const item = list.createDiv({ cls: `tm-sidebar-subtask${child.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
      const box = item.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${child.priority ? ` is-p${child.priority}` : ""}${statusClass(child.status)}`, attr: { "aria-label": checkboxLabel(child) } });
      box.checked = child.completed;
      box.addEventListener("change", () => this.toggle(child, box.checked, false));
      const name = item.createEl("input", { type: "text", cls: "tm-sidebar-subtask-title", attr: { "aria-label": `Subtask: ${child.title}`, "data-tm-focus-key": `sidebar-subtask:${child.id}` } });
      name.value = child.title;
      const commit = (): void => {
        const value = name.value.trim();
        if (!value) { name.value = child.title; return; }
        if (value !== child.title) this.renameChild(child, value);
      };
      name.addEventListener("blur", commit);
      name.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); name.blur(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); name.value = child.title; name.blur(); }
      });
    }
    const adding = list.createDiv({ cls: "tm-sidebar-subtask is-new" });
    setIcon(adding.createSpan({ cls: "tm-sidebar-subtask-add", attr: { "aria-hidden": "true" } }), "plus");
    const input = adding.createEl("input", { type: "text", cls: "tm-sidebar-subtask-title", attr: { "aria-label": "New subtask", placeholder: "Add subtask", "data-tm-focus-key": "sidebar-subtask-new" } });
    input.value = this.draft?.subtask?.text ?? "";
    const keep = (text: string): void => { if (this.draft) this.draft = { ...this.draft, subtask: text ? { text } : undefined }; };
    input.addEventListener("input", () => keep(input.value));
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      input.value = "";
      keep("");
      void this.addSubtask(task.id, value, children[children.length - 1]);
    });
  }
}
