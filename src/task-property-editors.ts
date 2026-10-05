import { Notice } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { BulkTaskPatch } from "./bulk-tasks";
import { addDays } from "./calendar";
import { openChoicePopover, PRIORITY_CHOICES, projectChoices, repeatChoices, REPEAT_INPUT, type Choice, type ChoiceInput } from "./choice-popover";
import { formatDate, parseDateExpression, todayIso } from "./date";
import { nextWeek, openDatePopover } from "./date-popover";
import type { TaskEditorProperty } from "./task-editor";
import { openTagsPopover } from "./task-menu";
import { STATUS_ICONS, STATUS_LABELS, TASK_STATUSES } from "./task-status";
import type { Task, TaskStatus } from "./types";

/** What the property popovers write through: a task view, or the Task Details sidebar beside a note. */
export interface PropertyEditorHost {
  readonly plugin: TaskManagerPlugin;
  /** A task by id as it now reads, a new task not yet written included. */
  liveTask(id: string): Task | undefined;
  /** Writes a change to tasks; `keep` keeps them selected (`moveTo` where they moved), `false` when they are gone. */
  updateTasks(tasks: Task[], patch: BulkTaskPatch | ((task: Task) => BulkTaskPatch), failure?: string, keep?: { moveTo?: string } | false): Promise<void>;
  /** Sets the tasks' status; `task` is the one the status was chosen from. */
  setStatus(task: Task, status: TaskStatus, tasks: Task[]): void;
  /** The note a task is in, or for a new task the note it will go to. */
  pathOf(task: Task): string;
}

/**
 * The popovers that edit task properties, for one task or several at once: a date (with its time and duration),
 * priority, project, tags, repeat, snooze and status. A task view's rows, menu and keys open them, and so does the
 * Task Details sidebar.
 */
export class TaskPropertyEditors {
  constructor(private readonly host: PropertyEditorHost) {}

  private get plugin(): TaskManagerPlugin { return this.host.plugin; }

  /** The popover for `property` beside `anchor`: dates, times and durations, priority, tags, repeat or snooze. False for anything else. */
  open(tasks: Task[], property: TaskEditorProperty, anchor: HTMLElement): boolean {
    if (!tasks.length) return false;
    if (this.date(tasks, property, anchor)) return true;
    if (property === "tags") this.tags(tasks, anchor);
    else if (property === "repeat") this.repeat(tasks, anchor);
    else if (property === "defer") this.snooze(tasks, anchor);
    else return false;
    return true;
  }

  /**
   * The date popover for a schedule (with its time and duration) or a deadline (with its time), or the priority list,
   * saving to every task given. Returns false for properties it does not edit.
   */
  date(tasks: Task[], property: TaskEditorProperty, anchor: HTMLElement, beside = false, saved?: () => void): boolean {
    if (property === "priority") return this.priority(tasks, anchor, beside);
    const kind = property === "deadline" ? "deadline" : property === "scheduledDate" || property === "durationMinutes" ? "scheduled" : undefined;
    const first = tasks[0];
    if (!kind || !first) return false;
    openDatePopover({
      anchor, kind, beside, dateFormat: this.plugin.dateFormat(),
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
        void this.host.updateTasks(tasks, patch);
      }
    });
    return true;
  }

  priority(tasks: Task[], anchor: HTMLElement, beside = false): boolean {
    const first = tasks[0];
    if (!first) return false;
    const shared = tasks.every(task => task.priority === first.priority);
    openChoicePopover({
      // P, which opens the list, moves on to the next priority; Enter or a click sets it.
      anchor, beside, label: "Priority", choices: PRIORITY_CHOICES, cycleKey: "p", selected: shared ? String(first.priority ?? "") : undefined,
      choose: value => {
        const priority = value ? Number(value) as Task["priority"] : undefined;
        const changed = tasks.filter(task => task.priority !== priority);
        if (changed.length) void this.host.updateTasks(changed, { priority });
      }
    });
    return true;
  }

  /** Inbox and the active projects; choosing one moves the tasks (with their subtasks) there. */
  project(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
    const pathOf = (task: Task): string => this.host.pathOf(task);
    const current = tasks.every(task => pathOf(task) === pathOf(tasks[0])) ? pathOf(tasks[0]) : undefined;
    const move = (path: string): void => {
      done?.();
      const moving = tasks.filter(task => pathOf(task) !== path);
      if (moving.length) void this.host.updateTasks(moving, { destination: path }, "Could not move the task.", { moveTo: path });
    };
    openChoicePopover({
      anchor, beside, label: "Move to project", choices: this.projectChoices(current), selected: current,
      input: this.projectSearch(path => move(path)), choose: move
    });
  }

  /** Searches the projects; typed text that names none can become a new project, which `use` then receives. */
  projectSearch(use: (path: string) => void): ChoiceInput {
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
  projectChoices(current?: string): Choice[] {
    return projectChoices(this.plugin.index.projects(), this.plugin.settings.inboxPath, current);
  }

  /**
   * Tags on the tasks (checked, or a dash when only some have one), then the vault's other tags. Each change
   * writes at once, one after another, to the tasks as they then read.
   */
  tags(tasks: Task[], anchor: HTMLElement, beside = false): void {
    const ids = tasks.map(task => task.id);
    const counts = new Map<string, number>();
    for (const task of tasks) for (const tag of task.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const own = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, state: count === tasks.length ? "all" as const : "some" as const }));
    const others = this.plugin.index.tagSummaries().map(tag => tag.name).filter(name => !counts.has(name)).map(name => ({ name, state: "none" as const }));
    let queue = Promise.resolve();
    const change = (next: (tags: string[]) => string[]): void => {
      queue = queue.then(() => {
        const current = ids.map(id => this.host.liveTask(id)).filter((task): task is Task => Boolean(task));
        const changed = current.filter(task => next(task.tags ?? []).join("\n") !== (task.tags ?? []).join("\n"));
        return changed.length ? this.host.updateTasks(changed, task => ({ tags: next(task.tags ?? []) })) : undefined;
      });
    };
    openTagsPopover({
      anchor, beside, tags: [...own, ...others],
      toggle: (tag, on) => change(tags => on ? [...new Set([...tags, tag])] : tags.filter(item => item !== tag)),
      add: added => change(tags => [...new Set([...tags, ...added])])
    });
  }

  repeat(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
    const current = tasks.every(task => task.repeat === tasks[0].repeat) ? tasks[0].repeat ?? "" : undefined;
    openChoicePopover({
      anchor, beside, label: "Repeat", choices: repeatChoices(current), selected: current, input: REPEAT_INPUT,
      choose: value => {
        done?.();
        const repeat = value || undefined;
        const changed = tasks.filter(task => task.repeat !== repeat);
        if (changed.length) void this.host.updateTasks(changed, { repeat });
      }
    });
  }

  /** Snoozing hides a task from Inbox, Today and Upcoming until the date (see isDeferred). */
  snooze(tasks: Task[], anchor: HTMLElement, beside = false, done?: () => void): void {
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
        void this.host.updateTasks(tasks, patch);
      }
    });
  }

  status(task: Task, tasks: Task[], anchor: HTMLElement, done?: () => void, beside = true): void {
    const current = tasks.every(item => item.status === tasks[0].status) ? tasks[0].status : undefined;
    openChoicePopover({
      // S, which opens the list, moves on to the next status; Enter or a click sets it.
      anchor, beside, label: "Status", selected: current, cycleKey: "s",
      choices: TASK_STATUSES.map(status => ({ value: status, label: STATUS_LABELS[status], icon: STATUS_ICONS[status] })),
      choose: value => { done?.(); this.host.setStatus(task, value as TaskStatus, tasks); }
    });
  }
}
