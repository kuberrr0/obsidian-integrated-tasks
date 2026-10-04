import { ItemView, Notice, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import { TaskMainView } from "./task-view";
import { renderCalendar } from "./calendar-view";
import { calendarDate, rescheduledDraft } from "./calendar";
import { todayIso } from "./date";
import { parseTaskInput, repeatLabel } from "./parser";
import { sortTasks } from "./query";
import { isRepeatingTask } from "./recurring-task";
import { draftFromTask, draftFromTitle, draftMatchesTask } from "./task-draft";
import type { TaskEditorProperty } from "./task-editor";
import { taskInputRanges } from "./task-input";
import { deadlineIsDistant, deadlineIsOverdue, editable, taskDeadlineCountdown, taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import { STATUS_ICONS, STATUS_LABELS, checkboxLabel, statusClass } from "./task-status";
import { PRIORITY_NAMES, cardNotes, longDate, paintTokens, repeatIcon, type TaskCardDraft } from "./things-task-card";
import type { Task, TaskFilter } from "./types";

export const TASK_SIDEBAR_VIEW = "task-manager-sidebar";

/** What the sidebar shows for the task view in front: Today's calendar, Upcoming's tasks with no date, or the selected
 * task. */
type SidebarMode = "today" | "upcoming" | "details";
/** A property the sidebar edits through the task view showing the task (see TaskMainView.editTaskProperty). */
type SidebarProperty = TaskEditorProperty | "status" | "project";

/** Upcoming's list is All Tasks with View options › No date for both the scheduled date and the deadline. */
const UNDATED: TaskFilter[] = [
  { property: "scheduledDate", operator: "missing", values: [] },
  { property: "deadline", operator: "missing", values: [] }
];

const noteName = (path: string): string => path.replace(/\.md$/i, "").split("/").pop() ?? path;
const isTextField = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type === "text");

function autosize(area: HTMLTextAreaElement): void {
  area.setCssStyles({ height: "auto" });
  area.setCssStyles({ height: `${area.scrollHeight}px` });
}

/**
 * The task sidebar (in the right sidebar by default). Its content follows the task view in front: with Today open, the
 * day's calendar; with Upcoming open, the tasks with no date; anywhere else, the selected task's details, editable in
 * place. Only the tasks show: no headings or calendar controls.
 */
export class TaskSidebarView extends ItemView {
  private mode?: SidebarMode;
  /** The shown task's title and notes as typed (and a subtask being typed); `dirty` until they are saved. */
  private draft?: { id: string; dirty: boolean } & TaskCardDraft;
  /** Saves and writes, one after another, so each sees the task as the last one left it. */
  private saving: Promise<void> = Promise.resolve();
  /** What the last render drew; a render that would draw the same is skipped, leaving typing and scrolling alone. */
  private drawn = "";
  private indexVersion = 0;
  private renderFrame?: number;
  private closed = false;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string { return TASK_SIDEBAR_VIEW; }
  getDisplayText(): string { return "Task sidebar"; }
  getIcon(): string { return "panel-right"; }

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

  render(force = false): void {
    const view = this.taskView();
    const state = view?.getState();
    const mode: SidebarMode = view && !view.pagePath && (state?.mode === "today" || state?.mode === "upcoming") ? state.mode : "details";
    const selected = mode === "details" ? view?.sidebarSelection() ?? [] : [];
    const task = selected.length === 1 ? selected[0] : undefined;
    this.followTask(task);
    const settings = this.plugin.settings;
    const drawn = JSON.stringify([mode, settings.style, settings.density, mode === "details"
      ? [Boolean(view), selected.length, task?.id, task?.raw, task?.description, task && this.children(task).map(child => child.raw)]
      : [todayIso(), this.indexVersion, settings.calendarProjectColors, settings.calendarPriorityColors]]);
    if (!force && drawn === this.drawn) return;
    const modeChanged = mode !== this.mode;
    this.drawn = drawn;
    this.mode = mode;
    this.preserveView(!modeChanged, () => {
      const container = this.content;
      container.empty();
      // It shares the task views' styles (checkboxes, pills, the calendar), which hang off .tm-main-view.
      container.addClass("tm-main-view", "tm-task-sidebar");
      container.toggleClass("tm-style-things", settings.style === "things");
      container.toggleClass("tm-style-griply", settings.style === "griply");
      container.toggleClass("tm-density-compact", settings.density === "compact");
      for (const name of ["today", "upcoming", "details"] as const) container.toggleClass(`is-${name}`, mode === name);
      if (mode === "details") this.renderDetails(container, view, selected, task);
      else this.renderPlanner(container, mode);
    });
  }

  /** Re-rendering replaces every element; focus (with its caret) and scroll positions go back where they were. */
  private preserveView(scroll: boolean, update: () => void): void {
    const container = this.content;
    const active = container.ownerDocument.activeElement;
    const key = active && container.contains(active) ? active.closest("[data-tm-focus-key]")?.getAttribute("data-tm-focus-key") : undefined;
    const range = isTextField(active) ? [active.selectionStart ?? 0, active.selectionEnd ?? 0] as const : undefined;
    const scrolled = [container, ...Array.from(container.querySelectorAll<HTMLElement>("[data-tm-scroll-key]"))]
      .map(element => ({ key: element === container ? "" : element.getAttribute("data-tm-scroll-key") ?? "", top: element.scrollTop }));
    update();
    if (scroll) for (const { key, top } of scrolled) {
      const element = key ? container.querySelector<HTMLElement>(`[data-tm-scroll-key="${CSS.escape(key)}"]`) : container;
      if (element) element.scrollTop = top;
    }
    const target = key ? container.querySelector<HTMLElement>(`[data-tm-focus-key="${CSS.escape(key)}"]`) : null;
    if (!target) return;
    target.focus({ preventScroll: true });
    if (range && isTextField(target)) target.setSelectionRange(range[0], range[1]);
  }

  // Today and Upcoming: their tasks on a calendar, without its toolbar.

  private renderPlanner(container: HTMLElement, mode: "today" | "upcoming"): void {
    const today = todayIso();
    const tasks = sortTasks(this.plugin.index.query({ mode: "all", showCompleted: false, filters: mode === "upcoming" ? UNDATED : [] })
      .filter(task => mode === "upcoming" || calendarDate(task)));
    if (mode === "upcoming" && !tasks.length) {
      const empty = container.createDiv({ cls: "tm-empty tm-sidebar-empty" });
      setIcon(empty.createDiv({ cls: "tm-empty-icon" }), "calendar-check");
      empty.createEl("h3", { text: "Every task has a date" });
      return;
    }
    renderCalendar(container.createDiv({ cls: "tm-sidebar-calendar" }), {
      // Today's day, and for Upcoming only the tasks without a date; neither changes period.
      anchor: today, scope: mode === "today" ? "day" : "month", toolbar: false, unscheduledOnly: mode === "upcoming",
      tasks, dateFormat: this.plugin.dateFormat(), navigate: () => {},
      color: task => this.plugin.settings.calendarProjectColors ? this.plugin.index.projectColor(task.path) : undefined,
      priorityColors: this.plugin.settings.calendarPriorityColors,
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
  }

  // Everywhere else: the selected task.

  private children(task: Task): Task[] {
    return task.childIds.map(id => this.plugin.index.taskById(id)).filter((child): child is Task => Boolean(child));
  }

  /** Another task shown saves the last one's typing first; an untouched draft takes the task's current text. */
  private followTask(task: Task | undefined): void {
    if (this.draft && this.draft.id !== task?.id) {
      void this.saveDraft();
      this.draft = undefined;
    }
    if (task && !this.draft?.dirty) this.draft = { id: task.id, dirty: false, title: task.title, notes: cardNotes(task.description), subtask: this.draft?.subtask };
  }

  private typed(task: Task, next: TaskCardDraft): void {
    if (this.draft?.id !== task.id) return;
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
      const next = draftFromTitle(task, typed.title, new Date(), this.plugin.dateFormat());
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

  private renderDetails(container: HTMLElement, view: TaskMainView | undefined, selected: Task[], task: Task | undefined): void {
    if (!view || !task) {
      const empty = container.createDiv({ cls: "tm-empty tm-sidebar-empty" });
      setIcon(empty.createDiv({ cls: "tm-empty-icon" }), selected.length > 1 ? "list-checks" : "mouse-pointer-click");
      empty.createEl("h3", { text: selected.length > 1 ? `${selected.length} tasks selected` : "No task selected" });
      empty.createEl("p", { text: selected.length > 1 ? "Right-click them, or press E, to change them together."
        : view ? "Select a task to see its details here." : "Select a task in a task view to see its details here." });
      return;
    }
    this.renderTaskDetails(container, view, task);
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
  private renderTaskDetails(container: HTMLElement, view: TaskMainView, task: Task): void {
    const draft = this.draft!;
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
    checkbox.addEventListener("change", () => this.toggle(task, checkbox.checked, true));
    if (repeating) repeatIcon(box);
    // As in a card: the title is one wrapping line, and what saving reads as a property is marked behind it.
    const titleBox = head.createDiv({ cls: "tm-things-card-title-box" });
    const backdrop = titleBox.createDiv({ cls: "tm-things-card-title-backdrop", attr: { "aria-hidden": "true" } });
    const title = titleBox.createEl("textarea", { cls: "tm-things-card-title tm-sidebar-title-field", attr: { "aria-label": "Title", placeholder: "Title", rows: "1", "data-tm-focus-key": "sidebar-title" } });
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
      const source = value.createSpan({ cls: "tm-task-source", text: task.path === this.plugin.settings.inboxPath ? "Inbox" : noteName(task.path) });
      const color = this.plugin.index.projectColor(task.path);
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
    // Enter in the title moves on to the notes; Escape saves and leaves the field.
    panel.addEventListener("keydown", event => {
      const target = event.target as HTMLElement;
      if (target === title && event.key === "Enter" && !event.isComposing) { event.preventDefault(); notes.focus(); }
      else if ((target === title || target === notes) && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); target.blur(); }
    });
    const fit = (): void => { autosize(title); autosize(notes); };
    if (panel.isConnected) fit();
    window.requestAnimationFrame(fit);
    this.saveOnLeave(panel, ".tm-sidebar-title-field, .tm-sidebar-notes");

    this.renderSubtasks(panel, task);
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
