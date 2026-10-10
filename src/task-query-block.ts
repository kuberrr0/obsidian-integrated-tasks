import { MarkdownRenderChild, Notice, Platform, setIcon, TFile } from "obsidian";
import type TaskManagerPlugin from "./main";
import { renderCalendar } from "./calendar-view";
import { calendarDate, rescheduledDraft, type CalendarScope } from "./calendar";
import { formatDate, todayIso } from "./date";
import { kanbanColumns } from "./kanban";
import { groupTasks, orderTaskTree, sortTasks } from "./query";
import { isRepeatingTask, recurringFile } from "./recurring-task";
import { parseTaskQuery, QUERY_KEYS, type ParsedTaskQuery } from "./task-query";
import type { TaskEditorProperty } from "./task-editor";
import { renderTaskDetails, type TaskDetailsOptions } from "./task-row-details";
import { createTaskRow, dropEmptyRowParts } from "./task-row";
import { renderThingsTaskDetails } from "./things-row-details";
import { renderThingsBoardCard } from "./things-task-card";
import { STATUS_LABELS } from "./task-status";
import type { Task, TaskGrouping, TaskProperty } from "./types";

type QueryHost = Pick<TaskManagerPlugin, "app" | "index" | "store" | "settings" | "dateFormat" | "openEditor" | "openTask" | "startTask" | "openTaskView" | "openTag">;

export const TASK_QUERY_LANGUAGE = "task-query";
export const TASK_QUERY_TEMPLATE = "```task-query\nview: today\n```\n";

/**
 * A live, checkable task list rendered from a ```task-query block, in Reading view and Live Preview: rows, a board or a
 * calendar, drawn as the task views draw them (in the chosen style).
 */
export class TaskQueryBlock extends MarkdownRenderChild {
  private frame?: number;
  /** The calendar's period, once its toolbar has moved it (until the note is opened again). */
  private calendarAnchor?: string;
  private calendarScope?: CalendarScope;
  /** Where its hours were scrolled to, kept as the block redraws (on every change to the tasks). */
  private calendarScroll?: number;

  constructor(containerEl: HTMLElement, private readonly source: string, private readonly sourcePath: string, private readonly plugin: QueryHost) {
    super(containerEl);
  }

  onload(): void {
    // In Live Preview a click would otherwise move the caret into the block's source; a calendar takes every click.
    for (const type of ["mousedown", "pointerdown", "click"]) {
      this.containerEl.addEventListener(type, event => {
        if ((event.target as HTMLElement).closest("button, input, a, [role=button], .tm-calendar")) event.stopPropagation();
      });
    }
    this.render();
    this.register(this.plugin.index.subscribe(() => this.schedule()));
  }

  onunload(): void {
    if (this.frame !== undefined) this.containerEl.win.cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    if (this.frame !== undefined) return;
    this.frame = this.containerEl.win.requestAnimationFrame(() => { this.frame = undefined; this.render(); });
  }

  render(): void {
    const root = this.containerEl;
    const settings = this.plugin.settings;
    root.empty();
    // It shares the task views' styles (rows in either style, boards, the calendar), which hang off .tm-main-view.
    root.addClass("tm-query-block", "tm-main-view");
    root.toggleClass("tm-style-things", settings.style === "things");
    root.toggleClass("tm-style-griply", settings.style === "griply");
    root.toggleClass("tm-density-compact", settings.density === "compact");
    const parsed = parseTaskQuery(this.source, {
      sourcePath: this.sourcePath, dateFormat: this.plugin.dateFormat(), smartLists: settings.smartLists,
      resolveNote: name => this.plugin.app.metadataCache.getFirstLinkpathDest(name, this.sourcePath)?.path
    });
    root.toggleClass("is-kanban-view", !parsed.errors.length && parsed.layout === "board");
    root.toggleClass("is-calendar-view", !parsed.errors.length && parsed.layout === "calendar");
    if (parsed.errors.length) {
      const box = root.createDiv({ cls: "tm-query-error", attr: { role: "alert" } });
      box.createEl("strong", { text: "This task query has a problem" });
      const list = box.createEl("ul");
      for (const error of parsed.errors) list.createEl("li", { text: error });
      box.createDiv({ cls: "tm-query-help", text: `Options: ${QUERY_KEYS.join(", ")}.` });
      return;
    }
    const all = sortTasks(this.plugin.index.query(parsed.query), parsed.sort, parsed.descending);
    // A calendar shows a period, so every task in it; it has no room for tasks without a date.
    const tasks = parsed.layout === "calendar" ? all.filter(task => calendarDate(task)) : all;
    if (parsed.title) {
      const header = root.createDiv({ cls: "tm-query-title" });
      header.createSpan({ text: parsed.title });
      header.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
    }
    if (parsed.layout === "calendar") { this.renderCalendar(root, tasks, parsed); return; }
    if (!tasks.length) { root.createDiv({ cls: "tm-query-empty", text: "No matching tasks." }); return; }
    const shown = parsed.layout === "board" ? this.renderBoard(root, tasks, parsed) : this.renderList(root, tasks, parsed);
    if (shown < tasks.length) {
      const footer = root.createDiv({ cls: "tm-query-footer" });
      footer.createSpan({ text: `Showing ${shown} of ${tasks.length} tasks.` });
      const opens = parsed.opens;
      if (opens) footer.createEl("button", { text: "Show all" }).addEventListener("click", () => {
        void this.plugin.openTaskView(opens as Parameters<QueryHost["openTaskView"]>[0]).catch(error => new Notice(String(error)));
      });
    }
  }

  /** Rows, under a heading per group, up to the limit; returns how many it shows. */
  private renderList(root: HTMLElement, tasks: Task[], parsed: ParsedTaskQuery): number {
    let remaining = parsed.limit;
    const groups = parsed.grouping === "none" || parsed.grouping === "default" ? new Map([["", tasks]]) : groupTasks(tasks, parsed.grouping);
    for (const [key, group] of groups) {
      if (remaining <= 0) break;
      if (key) root.createDiv({ cls: "tm-query-group", text: this.groupTitle(key, parsed.grouping) });
      const list = root.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
      const visible = new Set(group.map(task => task.id));
      for (const task of orderTaskTree(group).slice(0, remaining)) this.renderRow(list, task, this.depth(task, visible), parsed.grouping, visible);
      remaining -= Math.min(group.length, remaining);
    }
    return parsed.limit - Math.max(0, remaining);
  }

  /**
   * A board: a column per group (by status unless the block groups otherwise), of the first tasks up to the limit.
   * Done and Cancelled stay out of a status board unless the block shows completed tasks.
   */
  private renderBoard(root: HTMLElement, tasks: Task[], parsed: ParsedTaskQuery): number {
    const shown = tasks.slice(0, parsed.limit);
    const grouping: TaskGrouping = parsed.grouping === "none" || parsed.grouping === "default" ? "status" : parsed.grouping;
    const closed = [STATUS_LABELS.done, STATUS_LABELS.cancelled];
    const columns = kanbanColumns(shown, grouping).filter(column => grouping !== "status" || parsed.query.showCompleted || column.tasks.length || !closed.includes(column.title));
    const board = root.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column" });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      header.createEl("h2", { text: this.groupTitle(column.title, grouping) });
      const list = section.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
      for (const task of column.tasks) this.renderRow(list, task, 0, grouping, undefined, true);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
    return shown.length;
  }

  /** The task views' calendar, on today's period (or the date the block names); its toolbar moves it, and a task dragged to a day or time moves there. */
  private renderCalendar(root: HTMLElement, tasks: Task[], parsed: ParsedTaskQuery): void {
    const { index, store, settings } = this.plugin;
    renderCalendar(root, {
      anchor: this.calendarAnchor ?? parsed.calendarAnchor ?? todayIso(), scope: this.calendarScope ?? parsed.calendarScope, tasks, dateFormat: this.plugin.dateFormat(),
      color: task => settings.calendarProjectColors ? index.projectColor(task.path) : undefined,
      priorityColors: settings.calendarPriorityColors,
      initialScrollTop: this.calendarScroll,
      navigate: (anchor, scope) => { this.calendarAnchor = anchor; this.calendarScope = scope; this.calendarScroll = undefined; this.render(); },
      create: preset => this.plugin.startTask({ mode: "all", preset }),
      edit: task => this.plugin.openTask(task),
      toggle: (task, completed) => store.toggle(task, completed),
      resize: async (task, date, time, duration) => {
        const latest = index.taskById(task.id);
        if (!latest) throw new Error("Task no longer exists.");
        await store.update(latest, { ...rescheduledDraft(latest, date, time), durationMinutes: duration });
        await index.refreshPath(latest.path);
      },
      move: async (task, date, time) => {
        const latest = index.taskById(task.id) ?? task;
        const paths = await store.bulkChange([latest], original => rescheduledDraft(original, date, time), {}, `Rescheduled “${latest.title}”`);
        for (const path of paths) await index.refreshPath(path);
      }
    });
    const hours = root.querySelector<HTMLElement>(".tm-calendar-day-scroll");
    if (!hours) return;
    hours.addEventListener("scroll", () => { this.calendarScroll = hours.scrollTop; });
    // Drawn before the note puts the block on the page, the hours could not scroll to the current time: once there, again.
    if (!root.isConnected && this.calendarScroll === undefined) root.win.requestAnimationFrame(() => { if (root.isConnected && this.calendarScroll === undefined) this.render(); });
  }

  private groupTitle(key: string, grouping: TaskGrouping): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return formatDate(key, this.plugin.dateFormat());
    return grouping === "source" ? key.replace(/\.md$/i, "").split("/").pop()! : key;
  }

  private depth(task: Task, visible: Set<string>): number {
    let depth = 0;
    for (let parent = task.parentId; parent && visible.has(parent); parent = this.plugin.index.taskById(parent)?.parentId) depth++;
    return depth;
  }

  /**
   * A task's row as a task view draws it in the chosen style; on a board, its card. `visible`: the tasks listed with it,
   * whose rows make a mark for its subtasks unneeded.
   */
  private renderRow(list: HTMLElement, task: Task, depth: number, grouping: TaskGrouping, visible?: Set<string>, board = false): void {
    const app = this.plugin.app;
    const things = this.plugin.settings.style === "things";
    const color = this.plugin.index.projectColor(task.path);
    const parts = createTaskRow(list, task, {
      cls: `tm-task-item tm-query-row${board && things ? " tm-things-board-card" : ""}`, depth, repeatCheckbox: things && isRepeatingTask(app, task),
      things, lead: things && !board, color: task.path !== this.sourcePath ? color : undefined, markColor: true,
      attr: { "data-task-id": task.id }
    });
    const { checkbox, primary, title, lead, metadata } = parts;
    checkbox.addEventListener("change", () => {
      void this.plugin.store.toggle(task, checkbox.checked).catch((error: unknown) => {
        checkbox.checked = !checkbox.checked;
        new Notice(error instanceof Error ? error.message : "Could not update the task.");
      });
    });
    title.addEventListener("click", () => this.plugin.openTask(task));
    try {
      // As in a task view: routine-note repeats get an icon (in the Things style the repeat icon is the checkbox).
      if (!things && recurringFile(app, task)) setIcon(primary.createSpan({ cls: "tm-task-recurring", attr: { role: "img", "aria-label": "Recurring task", title: "Recurring task" } }), "repeat-2");
    } catch { /* Ambiguous recurring links remain editable through the task editor. */ }
    const details: TaskDetailsOptions & { tags: string[]; openSource: () => void } = {
      grouping: grouping === "default" ? "none" : grouping, dateFormat: this.plugin.dateFormat(), show: (property: TaskProperty) => property !== "defer",
      source: task.path !== this.sourcePath ? task.path : undefined, tags: task.tags ?? [],
      edit: (property: TaskEditorProperty) => this.plugin.openTask(task, property),
      openSource: () => {
        const file = app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) void app.workspace.getLeaf("tab").openFile(file, { eState: { line: task.line } });
      },
      openTag: tag => void this.plugin.openTag(tag).catch((error: unknown) => new Notice(String(error)))
    };
    if (board && things) renderThingsBoardCard(metadata, task, details);
    else if (lead) {
      renderThingsTaskDetails({ lead, inline: primary, secondary: metadata }, task, {
        ...details, subtaskMark: !task.childIds.every(id => visible?.has(id)), datesBelow: Platform.isPhone
      });
    } else renderTaskDetails(primary, metadata, task, details);
    dropEmptyRowParts(parts);
  }
}
