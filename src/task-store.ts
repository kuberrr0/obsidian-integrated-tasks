import { updateRecurringLogDates } from "./recurring-log";
import { recurringFile, repeatRules, nextRepeatDate, repeatAnchor, storedRepeatAnchor, advanceRecurringTask, appendRecurringLog, advanceInlineRepeat, REPEAT_ANCHOR, type RecurringOutcome } from "./recurring-task";
import { todayIso } from "./date";
import { updateTaskDateTokens } from "./task-date-update";
import { newTaskLines } from "./task-description";
import { isMove, planBulkTasks, type BulkTaskPatch, type BulkTaskOptions } from "./bulk-tasks";
import { draftForGroup, type ListDropGroup } from "./list-drag";
import { copiedTaskText, duplicateTaskBlocks, insertAfterTask, liveTaskBlock, pastedTaskLines } from "./task-block";
import { serializeTask } from "./parser";
import { TASK_INDENT } from "./task-indentation";
import type { ListPlacement } from "./list-drag";
import { splitDestination } from "./structure";
import { normalizePath, type App, TFile, TFolder } from "obsidian";
import {
  findLiveLine,
  insertIntoDestination,
  removeLinesFromContent,
  toggleTaskInContent,
  updateTaskInContent
} from "./markdown";
import { STATUS_LABELS, draftStatus, isClosedStatus, statusFromLabel } from "./task-status";
import type { ParsedTaskMetadata, Task, TaskDraft, TaskManagerSettings, TaskStatus } from "./types";

/** One user action's effect on notes, kept so the action can be undone as a unit. */
export interface TaskChange {
  label: string;
  /** `before` is undefined for a note the action created. */
  files: Array<{ path: string; before?: string; after: string }>;
}

const UNDO_HISTORY = 20;

/** The first checklist line of what an insertion added: from the first line that differs, the first task line. */
export function insertedTaskLine(before: string, after: string): number {
  const old = before.split("\n"), next = after.split("\n");
  let line = 0;
  while (line < old.length && line < next.length && old[line] === next[line]) line++;
  while (line < next.length && !/^\s*[-*+]\s+\[.\]/.test(next[line])) line++;
  return line < next.length ? line : -1;
}

function taskName(title: string): string {
  const trimmed = title.trim();
  return `“${trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed}”`;
}

function tasksName(tasks: Array<{ title: string }>): string {
  return tasks.length === 1 ? taskName(tasks[0].title) : `${tasks.length} tasks`;
}

export class TaskStore {
  /** Called after each recorded action, e.g. to offer an Undo notice. */
  onChange?: (change: TaskChange) => void;
  private history: TaskChange[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private journal?: Map<string, { file: TFile; before?: string }>;

  constructor(
    private readonly app: App,
    private readonly getDateFormat: () => string,
    private readonly getNewTaskPosition: () => TaskManagerSettings["newTaskPosition"] = () => "top",
    private readonly getLinkDates: () => boolean = () => true,
    private readonly getSectionHeadingLevel: () => number = () => 1,
    private readonly getCompletionDates: () => boolean = () => false
  ) {}

  updateDates(sourceFormats: string[]): Promise<string[]> {
    return this.run("Updated task dates", () => this.updateDatesNow(sourceFormats));
  }

  private async updateDatesNow(sourceFormats: string[]): Promise<string[]> {
    const format = this.getDateFormat();
    const linkDates = this.getLinkDates();
    const files = new Map(this.app.vault.getMarkdownFiles().map(file => [file.path, file]));
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    for (const [path, file] of files) {
      const content = await this.app.vault.read(file);
      const cache = this.app.metadataCache?.getFileCache(file);
      const rawTags: unknown = cache?.frontmatter?.tags;
      const frontmatterTags: unknown[] = Array.isArray(rawTags) ? rawTags : typeof rawTags === "string" ? rawTags.split(/[\s,]+/) : [];
      const tags: unknown[] = [...frontmatterTags, ...(cache?.tags ?? []).map(tag => tag.tag)];
      const recurring = tags.some(tag => String(tag).replace(/^#/, "") === "recurring-task");
      const tasksUpdated = updateTaskDateTokens(content, sourceFormats, format, linkDates);
      const updated = recurring ? updateRecurringLogDates(tasksUpdated, sourceFormats, format, linkDates) : tasksUpdated;
      if (updated !== content) { before.set(path, content); after.set(path, updated); }
    }
    return this.commitChanges(files, before, after);
  }

  toggle(task: Task, completed: boolean): Promise<void> {
    return this.run(`${completed ? "Completed" : "Reopened"} ${taskName(task.title)}`, async () => {
      if (completed && (recurringFile(this.app, task) || task.repeat)) {
        await this.resolveRecurringNow(task, "COMPLETED");
        return;
      }
      const file = this.requireFile(task.path);
      const draft = this.stampCompletion(task, { ...draftForGroup(task), completed });
      await this.process(file, (content) => draft.completedDate === task.completedDate
        ? toggleTaskInContent(content, task, completed, this.getSectionHeadingLevel())
        : updateTaskInContent(content, task, draft, this.getDateFormat(), this.getLinkDates(), this.getSectionHeadingLevel()));
    });
  }

  resolveRecurring(task: Task, outcome: RecurringOutcome): Promise<string[]> {
    const verb = outcome === "COMPLETED" ? "Completed" : "Cancelled";
    return this.run(`${verb} ${taskName(task.title)}`, () => this.resolveRecurringNow(task, outcome));
  }

  private async resolveRecurringNow(task: Task, outcome: RecurringOutcome): Promise<string[]> {
    const recurring = recurringFile(this.app, task);
    if (!recurring) {
      if (!task.repeat) throw new Error("Task does not repeat.");
      if (task.completed) throw new Error("Select an open repeating task.");
      // An inline repeat has no routine note: advance its dates in place, with no log or anchor.
      const file = this.requireFile(task.path);
      const draft: TaskDraft = { ...draftForGroup(task), ...advanceInlineRepeat(task), status: "todo", completed: false };
      await this.process(file, content => updateTaskInContent(content, task, draft, this.getDateFormat(), this.getLinkDates(), this.getSectionHeadingLevel()));
      return [file.path];
    }
    const source = this.requireFile(task.path);
    const files = new Map([[recurring.path, recurring], [source.path, source]]);
    const before = new Map(await Promise.all([...files].map(async ([path, file]) => [path, await this.app.vault.read(file)] as const)));
    const after = new Map(before);
    const anchor = this.advanceRecurring(after, task, recurring, outcome).anchor;
    const paths = await this.commitChanges(files, before, after);
    await this.saveRepeatAnchors(new Map([[recurring, anchor]]), before);
    return paths;
  }

  /** Advance one recurring task to its next instance and log the outcome, within planned contents. */
  private advanceRecurring(contents: Map<string, string>, task: Task, recurring: TFile, outcome: RecurringOutcome): { task: Task; anchor?: string } {
    if (task.completed || !task.scheduledDate) throw new Error("Select an open recurring task with a scheduled date.");
    const definition = contents.get(recurring.path)!;
    const rules = repeatRules(definition);
    const anchor = repeatAnchor(rules, task.scheduledDate, storedRepeatAnchor(definition));
    const next = nextRepeatDate(rules, task.scheduledDate, anchor);
    const source = contents.get(task.path)!;
    const line = findLiveLine(source.split(/\r?\n/), task, this.getSectionHeadingLevel());
    const advanced = advanceRecurringTask(source, task, next, this.getDateFormat(), this.getSectionHeadingLevel());
    contents.set(task.path, advanced);
    contents.set(recurring.path, appendRecurringLog(contents.get(recurring.path)!, outcome, task.scheduledDate, this.getDateFormat(), this.getLinkDates()));
    return { task: { ...task, line, raw: advanced.split(/\r?\n/)[line], scheduledDate: next, status: "todo" }, anchor };
  }

  /** Persist month/year anchors after the task writes commit; a lost anchor only resets to the next scheduled date. */
  private async saveRepeatAnchors(anchors: Map<TFile, string | undefined>, before: Map<string, string>): Promise<void> {
    for (const [file, anchor] of anchors) {
      if (!anchor || anchor === storedRepeatAnchor(before.get(file.path) ?? "") || !this.app.fileManager?.processFrontMatter) continue;
      try {
        await this.remember(file);
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => { frontmatter[REPEAT_ANCHOR] = anchor; });
      } catch (error) { console.error("Could not save the repeat anchor", error); }
    }
  }

  delete(task: Task): Promise<void> {
    return this.run(`Deleted ${taskName(task.title)}`, async () => {
      const file = this.requireFile(task.path);
      await this.process(file, content => {
        const block = liveTaskBlock(content, task, this.getDateFormat(), this.getSectionHeadingLevel());
        return removeLinesFromContent(content, block.start, block.lines.length);
      });
    });
  }

  /** Writes a new task; resolves to the line it landed on in its note. */
  create(draft: TaskDraft): Promise<number> {
    return this.run(`Added ${taskName(draft.title)}`, async () => {
      const { path, heading } = splitDestination(draft.destination);
      const file = heading ? this.requireFile(path) : await this.ensureFile(path);
      let line = -1;
      await this.process(file, (content) => {
        const next = insertIntoDestination(content, newTaskLines(draft, this.getDateFormat(), this.getLinkDates()), heading, this.getNewTaskPosition(), this.getSectionHeadingLevel());
        line = insertedTaskLine(content, next);
        return next;
      });
      return line;
    });
  }

  /**
   * Adds a to-do subtask to `parent`: right after `after` (one of its subtasks, keeping that subtask's
   * indentation) or, with no `after`, at the end of the parent's block one level deeper.
   */
  addSubtask(parent: Task, subtask: ParsedTaskMetadata, after?: Task): Promise<void> {
    return this.run(`Added ${taskName(subtask.title)}`, async () => {
      const file = this.requireFile(parent.path);
      await this.process(file, content => {
        const anchor = liveTaskBlock(content, after ?? parent, this.getDateFormat(), this.getSectionHeadingLevel());
        const leading = /^[ \t]*/.exec(anchor.lines[0])![0];
        const indent = after ? leading : leading + " ".repeat(TASK_INDENT);
        const line = indent + serializeTask({ ...subtask, status: "todo", completed: false, destination: parent.path, indent: 0 }, this.getDateFormat(), this.getLinkDates());
        const lines = content.split("\n");
        lines.splice(anchor.end, 0, line);
        return lines.join("\n");
      });
    });
  }

  update(task: Task, draft: TaskDraft): Promise<void> {
    return this.run(`Edited ${taskName(task.title)}`, async () => {
      // Description edits, moves and recurring completions share the planned, all-or-nothing bulk path.
      if ((draft.description !== undefined && draft.description !== (task.description ?? "")) || isMove(task, draft) || this.completesRecurring(task, draft)) {
        await this.bulkChangeNow([task], () => draft);
        return;
      }
      const file = this.requireFile(task.path);
      await this.process(file, (content) => updateTaskInContent(content, task, this.stampCompletion(task, draft), this.getDateFormat(), this.getLinkDates(), this.getSectionHeadingLevel()));
    });
  }

  /** One patch for every task, or a patch for each (for example to add a tag to what each task has). */
  async bulkUpdate(tasks: Task[], patch: BulkTaskPatch | ((task: Task) => BulkTaskPatch)): Promise<string[]> {
    if (typeof patch !== "function" && !Object.keys(patch).length) return [];
    const patchFor = typeof patch === "function" ? patch : () => patch;
    return this.bulkChange(tasks, task => {
      const change = patchFor(task);
      const closed = change.status && { completed: isClosedStatus(change.status) };
      return { ...draftForGroup(task), ...change, ...closed };
    }, {}, `Edited ${tasksName(tasks)}`);
  }

  /** The Markdown of tasks (each with its notes and subtasks) for the clipboard, as their notes now read. */
  async copyTasks(tasks: Task[]): Promise<string> {
    const contents = new Map<string, string>();
    for (const path of new Set(tasks.map(task => task.path))) contents.set(path, await this.app.vault.read(this.requireFile(path)));
    return copiedTaskText(contents, tasks, this.getDateFormat(), this.getSectionHeadingLevel());
  }

  /**
   * Adds copied tasks (Markdown with checklist lines, and their notes and subtasks): right after `after`, as its next
   * siblings, or into `destination` where new tasks go. Resolves to the note and the lines they took, or undefined
   * when the text holds no task.
   */
  pasteTasks(text: string, where: { after: Task } | { destination: string }): Promise<{ path: string; from: number; to: number } | undefined> {
    const lines = pastedTaskLines(text);
    if (!lines) return Promise.resolve(undefined);
    const count = lines.filter(line => /^[-+*]\s+\[[^\]]\]/.test(line)).length;
    return this.run(`Pasted ${count === 1 ? "a task" : `${count} tasks`}`, async () => {
      if ("after" in where) {
        const file = this.requireFile(where.after.path);
        let line = -1;
        await this.process(file, content => {
          const result = insertAfterTask(content, where.after, lines, this.getDateFormat(), this.getSectionHeadingLevel());
          line = result.line;
          return result.content;
        });
        return { path: file.path, from: line, to: line + lines.length };
      }
      const { path, heading } = splitDestination(where.destination);
      const file = heading ? this.requireFile(path) : await this.ensureFile(path);
      let line = -1;
      await this.process(file, content => {
        const next = insertIntoDestination(content, lines, heading, this.getNewTaskPosition(), this.getSectionHeadingLevel());
        line = insertedTaskLine(content, next);
        return next;
      });
      return { path: file.path, from: line, to: line + lines.length };
    });
  }

  /** Copies each task, with its notes and subtasks, right below it. */
  duplicate(tasks: Task[]): Promise<string[]> {
    return this.run(`Duplicated ${tasksName(tasks)}`, async () => {
      const paths = [...new Set(tasks.map(task => task.path))];
      for (const path of paths) {
        await this.process(this.requireFile(path), content =>
          duplicateTaskBlocks(content, tasks.filter(task => task.path === path), this.getDateFormat(), this.getSectionHeadingLevel()));
      }
      return paths;
    });
  }

  /** Done completes a repeating task (advancing it) and cancelled skips its occurrence, as Complete and Skip do. */
  setStatus(tasks: Task[], status: TaskStatus): Promise<string[]> {
    return this.bulkChange(tasks, task => ({ ...draftForGroup(task), status, completed: isClosedStatus(status) }), {},
      `Marked ${tasksName(tasks)} as ${STATUS_LABELS[status].toLowerCase()}`);
  }

  bulkDelete(tasks: Task[]): Promise<string[]> {
    return this.bulkChange(tasks, () => undefined, { delete: true }, `Deleted ${tasksName(tasks)}`);
  }

  bulkDrop(tasks: Task[], group?: ListDropGroup, anchor?: Task, placement?: ListPlacement): Promise<string[]> {
    return this.bulkChange(tasks, task => draftForGroup(task, group), { anchor, placement }, dropLabel(tasks, group, anchor));
  }

  /** Change project frontmatter (for example Gantt dates) as an undoable action. */
  updateFrontmatter(file: TFile, change: (frontmatter: Record<string, unknown>) => void, label: string): Promise<void> {
    return this.run(label, async () => {
      await this.remember(file);
      await this.app.fileManager.processFrontMatter(file, change);
    });
  }

  /**
   * Rewrite whole notes as one undoable action (for example an import). Notes whose contents
   * the transform leaves unchanged are not written; if any note changes meanwhile, nothing is kept.
   */
  rewriteNotes(files: TFile[], transform: (content: string, file: TFile) => string, label: string): Promise<string[]> {
    return this.run(label, async () => {
      const byPath = new Map(files.map(file => [file.path, file]));
      const before = new Map<string, string>();
      const after = new Map<string, string>();
      for (const file of files) {
        const content = await this.app.vault.read(file);
        const next = transform(content, file);
        before.set(file.path, content);
        if (next !== content) after.set(file.path, next);
      }
      return this.commitChanges(byPath, before, after);
    });
  }

  lastChange(): TaskChange | undefined {
    return this.history[this.history.length - 1];
  }

  /**
   * Put every note an action touched back as it was. Refuses, before writing anything,
   * if any of those notes changed since, so an undo never discards later edits.
   */
  undo(change: TaskChange | undefined = this.lastChange()): Promise<string[]> {
    const result = this.queue.then(async () => {
      if (!change || !this.history.includes(change)) throw new Error("Nothing to undo.");
      const targets: { entry: TaskChange["files"][number]; file: TFile }[] = [];
      for (const entry of change.files) {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile) || await this.app.vault.read(file) !== entry.after) {
          throw new Error(`Can't undo: ${entry.path.replace(/\.md$/i, "")} has changed since.`);
        }
        targets.push({ entry, file });
      }
      for (const { entry, file } of targets.reverse()) {
        if (entry.before === undefined) await this.app.fileManager.trashFile(file);
        else await this.app.vault.process(file, current => {
          if (current !== entry.after) throw new Error(`Can't undo: ${entry.path.replace(/\.md$/i, "")} has changed since.`);
          return entry.before!;
        });
      }
      this.history = this.history.filter(item => item !== change);
      return change.files.map(entry => entry.path);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Run one user action: one at a time, and recorded so it can be undone as a unit. */
  private run<T>(label: string, action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const journal = new Map<string, { file: TFile; before?: string }>();
      this.journal = journal;
      try {
        const value = await action();
        await this.record(label, journal);
        return value;
      } finally { this.journal = undefined; }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async record(label: string, journal: Map<string, { file: TFile; before?: string }>): Promise<void> {
    const files: TaskChange["files"] = [];
    for (const { file, before } of journal.values()) {
      const after = await this.app.vault.read(file);
      if (after !== before) files.push({ path: file.path, before, after });
    }
    if (!files.length) return;
    const change = { label, files };
    this.history.push(change);
    if (this.history.length > UNDO_HISTORY) this.history.shift();
    this.onChange?.(change);
  }

  /** Note the file's contents before the running action first changes it. */
  private async remember(file: TFile, created = false): Promise<void> {
    if (!this.journal || this.journal.has(file.path)) return;
    this.journal.set(file.path, { file, before: created ? undefined : await this.app.vault.read(file) });
  }

  private async process(file: TFile, change: (content: string) => string): Promise<string> {
    await this.remember(file);
    return this.app.vault.process(file, change);
  }

  /** The routine note a closing draft (done or cancelled) resolves through, `true` for an inline repeat; a routine note wins. */
  private completesRecurring(task: Task, draft?: TaskDraft): TFile | true | undefined {
    if (task.completed || !draft?.completed) return undefined;
    return recurringFile(this.app, task) ?? (draft.repeat ? true : undefined);
  }

  /** With completion dates on, a draft that makes a task done records today and one that makes it anything else drops the date, unless the draft sets its own. */
  private stampCompletion(task: Task, draft: TaskDraft): TaskDraft {
    const done = draftStatus(draft) === "done";
    if (!this.getCompletionDates() || (task.status === "done") === done || draft.completedDate !== task.completedDate) return draft;
    return { ...draft, completedDate: done ? todayIso() : undefined };
  }

  /**
   * Plan and commit every change together. A recurring task whose draft completes (or cancels) it is
   * advanced and logged as completed (or cancelled), as resolveRecurring does, instead of being checked; its other
   * property changes still apply, and an explicitly changed scheduled date wins over the next instance.
   */
  bulkChange(tasks: Task[], draft: (task: Task) => TaskDraft | undefined, options: BulkTaskOptions = {}, label = `Updated ${tasksName(tasks)}`): Promise<string[]> {
    return this.run(label, () => this.bulkChangeNow(tasks, draft, options));
  }

  private async bulkChangeNow(tasks: Task[], draft: (task: Task) => TaskDraft | undefined, options: BulkTaskOptions = {}): Promise<string[]> {
    const changes = tasks.map(task => ({ task, draft: draft(task) }));
    const files = new Map<string, TFile>();
    for (const task of tasks) files.set(task.path, this.requireFile(task.path));
    if (options.anchor) files.set(options.anchor.path, this.requireFile(options.anchor.path));
    for (const change of changes) if (change.draft && !options.anchor && isMove(change.task, change.draft)) {
      const { path, heading } = splitDestination(change.draft.destination);
      if (!files.has(path)) files.set(path, heading ? this.requireFile(path) : await this.ensureFile(path));
    }
    const recurring = options.delete ? [] : changes.flatMap(change => {
      const file = this.completesRecurring(change.task, change.draft);
      return file ? [{ change, file }] : [];
    });
    for (const { file } of recurring) if (file instanceof TFile) files.set(file.path, file);
    const before = new Map(await Promise.all([...files].map(async ([path, file]) => [path, await this.app.vault.read(file)] as const)));
    const contents = new Map(before);
    const anchors = new Map<TFile, string | undefined>();
    for (const { change, file } of recurring) {
      const original = change.task;
      const draft = change.draft!;
      if (file === true) {
        const next = advanceInlineRepeat({ ...original, repeat: draft.repeat });
        change.draft = { ...draft, status: "todo", completed: false,
          scheduledDate: draft.scheduledDate === original.scheduledDate ? next.scheduledDate : draft.scheduledDate,
          deadline: draft.deadline === original.deadline ? next.deadline : draft.deadline };
        continue;
      }
      const advanced = this.advanceRecurring(contents, original, file, draftStatus(draft) === "cancelled" ? "CANCELED" : "COMPLETED");
      anchors.set(file, advanced.anchor);
      change.task = advanced.task;
      change.draft = { ...change.draft!, status: "todo", completed: false,
        scheduledDate: change.draft!.scheduledDate === original.scheduledDate ? advanced.task.scheduledDate : change.draft!.scheduledDate };
    }
    for (const change of changes) if (change.draft) change.draft = this.stampCompletion(change.task, change.draft);
    const planned = planBulkTasks(contents, changes, { ...options, dateFormat: this.getDateFormat(), position: this.getNewTaskPosition(), linkDates: this.getLinkDates(), sectionHeadingLevel: this.getSectionHeadingLevel() });
    const after = new Map<string, string>();
    for (const [path, content] of before) {
      const final = planned.get(path) ?? contents.get(path)!;
      if (final !== content) after.set(path, final);
    }
    const paths = await this.commitChanges(files, before, after);
    await this.saveRepeatAnchors(anchors, before);
    return paths;
  }

  private async commitChanges(files: Map<string, TFile>, before: Map<string, string>, after: Map<string, string>): Promise<string[]> {
    const written: string[] = [];
    try {
      for (const [path, content] of after) {
        await this.process(files.get(path)!, current => {
          if (current !== before.get(path)) throw new Error("A note changed during the bulk action. Refresh and try again.");
          return content;
        });
        written.push(path);
      }
    } catch (cause) {
      const conflicts: string[] = [];
      for (const path of written.reverse()) {
        try {
          await this.app.vault.process(files.get(path)!, current => {
            if (current !== after.get(path)) throw new Error("Note changed");
            return before.get(path)!;
          });
        } catch { conflicts.push(path); }
      }
      if (conflicts.length) throw new Error(`Bulk action interrupted. Could not restore changed notes: ${conflicts.join(", ")}. Review those notes before retrying.`);
      throw cause;
    }
    return [...after.keys()];
  }

  private requireFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Cannot find note: ${path}`);
    return file;
  }

  private async ensureFile(path: string): Promise<TFile> {
    const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error(`${normalized} is not a Markdown file.`);

    const parts = normalized.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(current);
      if (!folder) await this.app.vault.createFolder(current);
      else if (!(folder instanceof TFolder)) throw new Error(`${current} is not a folder.`);
    }
    const created = await this.app.vault.create(normalized, "");
    await this.remember(created, true);
    return created;
  }
}

function dropLabel(tasks: Task[], group?: ListDropGroup, anchor?: Task): string {
  const name = tasksName(tasks);
  if (anchor) return `Moved ${name}`;
  switch (group?.property) {
    case "defer": return group.value === "Someday" ? `Snoozed ${name} to someday` : group.value ? `Snoozed ${name}` : `Stopped snoozing ${name}`;
    case "date": case "scheduledDate": case "deadline": case "scheduledTime": case "deadlineTime": return `Rescheduled ${name}`;
    case "status": {
      if (group.value === "Open") return `Reopened ${name}`;
      const status = statusFromLabel(String(group.value ?? ""));
      if (status) return `Marked ${name} as ${STATUS_LABELS[status].toLowerCase()}`;
      break;
    }
    case "priority": return `Changed priority of ${name}`;
    case "tags": return `Changed tags of ${name}`;
  }
  return group?.destination ? `Moved ${name}` : `Updated ${name}`;
}
