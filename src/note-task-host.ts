import { MarkdownView, Notice, type App } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { OpenEditorState } from "./main";
import type { BulkTaskPatch } from "./bulk-tasks";
import { NEW_TASK_ID, patchPendingTask, startPendingTask, writePendingTask, type PendingTask } from "./pending-task";
import { TaskPropertyEditors, type PropertyEditorHost } from "./task-property-editors";
import { splitDestination } from "./structure";
import type { TaskEditorProperty } from "./task-editor";
import { isClosedStatus } from "./task-status";
import type { Task, TaskStatus } from "./types";

/** A checklist item's line: a task, or a checklist the index does not read as one (an empty one). */
const CHECKLIST = /^[ \t]*[-+*]\s+\[[^\]]\]/;
/** Lines of a selection looked at for tasks, so selecting a whole long note stays quick. */
const MAX_SELECTED_LINES = 2000;

/**
 * What the Task Details sidebar shows and edits beside a note, with no task view in front: the note's tasks, the ones
 * its caret or selection is on, and a new task started there (Create new task, with three panes). Changes are written
 * to the notes, as a task view writes them.
 */
export class NoteTaskHost implements PropertyEditorHost {
  readonly editors = new TaskPropertyEditors(this);
  private pending?: PendingTask;
  /** The caret position the details were closed on (Escape): its tasks stay away until the caret moves. */
  private dismissed?: string;

  /** `changed`: the sidebar redraws; `written`: a new task was written, for the sidebar to go on showing it. */
  constructor(readonly plugin: TaskManagerPlugin, private readonly app: App, private readonly changed: () => void, private readonly written: (task: Task) => void) {}

  /** The note in front (with a sidebar focused, the main area's last), unless a task view is. */
  noteView(): MarkdownView | undefined {
    const workspace = this.app.workspace;
    const view = workspace.getActiveViewOfType(MarkdownView) ?? workspace.getMostRecentLeaf()?.view;
    return view instanceof MarkdownView && view.file ? view : undefined;
  }

  /** The note's tasks in order, each with how deep it sits among them. */
  noteTasks(): Array<{ task: Task; depth: number }> {
    const path = this.noteView()?.file?.path;
    if (!path) return [];
    const tasks = this.plugin.index.tasksForPath(path);
    const depths = new Map<string, number>();
    return tasks.map(task => {
      const depth = task.parentId && depths.has(task.parentId) ? depths.get(task.parentId)! + 1 : 0;
      depths.set(task.id, depth);
      return { task, depth };
    });
  }

  /** Where the caret (or each selection) is, as the lines it covers in the note; undefined in Reading view. */
  private caretLines(): { path: string; key: string; ranges: Array<[number, number]> } | undefined {
    const view = this.noteView();
    const path = view?.file?.path;
    if (!view || !path || view.getMode() !== "source") return undefined;
    const ranges = view.editor.listSelections().map(({ anchor, head }) => [Math.min(anchor.line, head.line), Math.max(anchor.line, head.line)] as [number, number]);
    return { path, key: `${path}\n${JSON.stringify(ranges)}`, ranges };
  }

  /**
   * The tasks on the lines the caret or selection is on. Each line is matched by its text to the task the index read
   * from it, so a note typed in since it was last read still finds its tasks.
   */
  caretTasks(): Task[] {
    const caret = this.caretLines();
    const editor = this.noteView()?.editor;
    if (!caret || !editor || caret.key === this.dismissed) return [];
    const byText = new Map<string, Task[]>();
    for (const task of this.plugin.index.tasksForPath(caret.path)) byText.set(task.raw, [...byText.get(task.raw) ?? [], task]);
    const found: Task[] = [];
    let budget = MAX_SELECTED_LINES;
    for (const [from, to] of caret.ranges) {
      for (let line = from; line <= to && budget > 0; line++, budget--) {
        const text = editor.getLine(line);
        if (!CHECKLIST.test(text)) continue;
        const nearest = (byText.get(text) ?? []).filter(task => !found.includes(task))
          .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
        if (nearest) found.push(nearest);
      }
    }
    return found;
  }

  // As a task view, for the sidebar.

  getSelectedTasks(): Task[] { return this.caretTasks(); }
  sidebarSelection(): Task[] { return this.caretTasks(); }

  /** The details close (Escape) until the caret moves; the caret itself stays where it is. */
  clearSelection(): void {
    this.dismissed = this.caretLines()?.key;
    this.changed();
  }

  liveTask(id: string): Task | undefined {
    return id === NEW_TASK_ID ? this.pending?.task : this.plugin.index.taskById(id);
  }

  pathOf(task: Task): string {
    return task.id === NEW_TASK_ID && this.pending ? splitDestination(this.pending.draft.destination).path : task.path;
  }

  async updateTasks(tasks: Task[], patch: BulkTaskPatch | ((task: Task) => BulkTaskPatch), failure = "Could not update the task."): Promise<void> {
    if (this.pending && tasks.some(task => task.id === NEW_TASK_ID)) {
      patchPendingTask(this.pending, typeof patch === "function" ? patch(this.pending.task) : patch);
      this.changed();
      tasks = tasks.filter(task => task.id !== NEW_TASK_ID);
    }
    if (!tasks.length) return;
    try {
      for (const path of await this.plugin.store.bulkUpdate(tasks, patch)) await this.plugin.index.refreshPath(path);
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : failure);
    }
  }

  setStatus(_task: Task, status: TaskStatus, tasks: Task[]): void {
    if (this.pending && tasks.some(task => task.id === NEW_TASK_ID)) {
      patchPendingTask(this.pending, { status, completed: isClosedStatus(status) });
      this.changed();
    }
    const changing = tasks.filter(task => task.id !== NEW_TASK_ID && task.status !== status);
    if (!changing.length) return;
    void this.plugin.store.setStatus(changing, status).then(async paths => {
      for (const path of paths) await this.plugin.index.refreshPath(path);
    }).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not update the task."); });
  }

  setTaskStatus(tasks: Task[], status: TaskStatus): void {
    if (tasks[0]) this.setStatus(tasks[0], status, tasks);
  }

  /** A property in its popover beside `anchor`; one without a popover opens the task editor. */
  editTaskProperty(tasks: Task[], property: TaskEditorProperty | "status" | "project", anchor: HTMLElement): void {
    if (!tasks.length) return;
    if (property === "project") this.editors.project(tasks, anchor);
    else if (property === "status") this.editors.status(tasks[0], tasks, anchor, undefined, false);
    else if (!this.editors.open(tasks, property, anchor) && tasks.length === 1 && tasks[0].id !== NEW_TASK_ID) {
      this.plugin.openEditor({ mode: "all", task: tasks[0], focusProperty: property });
    }
  }

  async changeTask(_task: Task, write: () => Promise<string[]>): Promise<void> {
    for (const path of await write()) await this.plugin.index.refreshPath(path);
  }

  // A new task, started with three panes from Create new task.

  /** Starts a new task in the sidebar, as the task editor would start one for `state`. */
  async startNewTask(state: OpenEditorState): Promise<void> {
    const pending = await startPendingTask(this.plugin, this.plugin.newTaskDraft(state), this.app.vault);
    if (!pending) { this.plugin.openEditor(state); return; }
    this.pending = pending;
    this.changed();
  }

  newTaskInSidebar(): { task: Task; title: string; notes: string; destination: string } | undefined {
    const pending = this.pending;
    return pending && { task: pending.task, title: pending.title, notes: pending.notes, destination: pending.draft.destination };
  }

  typeNewTask(title: string, notes: string): void {
    if (this.pending) Object.assign(this.pending, { title, notes });
  }

  /** Enter writes the new task once titled, and the sidebar goes on showing it; Escape (`write` off) drops it. */
  async finishNewTask(write = true): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    this.changed();
    const task = pending && write ? await writePendingTask(this.plugin, pending) : undefined;
    if (task) this.written(task);
  }
}
