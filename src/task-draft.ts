import { destinationString } from "./structure";
import { parseEditedTaskInput } from "./task-input";
import type { ParsedTaskMetadata, Task, TaskDraft } from "./types";

/** A draft that saves the task unchanged; its description is left as is. */
export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    scheduledDate: task.scheduledDate,
    scheduledTime: task.scheduledTime,
    deadline: task.deadline,
    deadlineTime: task.deadlineTime,
    deferDate: task.deferDate,
    someday: task.someday,
    repeat: task.repeat,
    completedDate: task.completedDate,
    durationMinutes: task.durationMinutes,
    priority: task.priority,
    tags: task.tags,
    status: task.status,
    completed: task.completed,
    destination: destinationString(task.path, task.section),
    indent: task.indent
  };
}

/** Properties a typed title can set; anything it does not mention keeps the task's value. */
const TYPED: Array<keyof ParsedTaskMetadata> = ["scheduledDate", "scheduledTime", "deadline", "deadlineTime", "deferDate", "someday", "repeat", "durationMinutes", "priority"];

/**
 * A task retitled with `text`, where properties typed into it apply as in the task editor:
 * "Call Sam tomorrow 3pm p1 #[[Calls]]" sets the date, time and priority and adds the tag.
 * Natural-language dates count only in what was newly typed, so a title that already reads
 * "Plan for tomorrow" keeps its words. `~[[Note]]` moves the task unless `move` is off.
 */
export function draftFromTitle(task: Task, text: string, reference = new Date(), dateFormat?: string, move = true): TaskDraft {
  const draft = draftFromTask(task);
  const parsed = parseEditedTaskInput(text.trim(), task.title, reference, dateFormat);
  if (!parsed) return { ...draft, title: text.trim() || task.title };
  const next: TaskDraft = { ...draft, title: parsed.title.trim() || task.title };
  const values = next as unknown as Record<string, unknown>;
  for (const key of TYPED) if (parsed[key] !== undefined) values[key] = parsed[key];
  if (parsed.tags?.length) next.tags = [...new Set([...(draft.tags ?? []), ...parsed.tags])];
  if (move && parsed.destination) next.destination = parsed.destination;
  return next;
}

/** True when saving `draft` would change nothing about `task`'s line. */
export function draftMatchesTask(task: Task, draft: TaskDraft): boolean {
  const base = draftFromTask(task);
  return draft.title === base.title && draft.destination === base.destination
    && TYPED.every(key => draft[key] === base[key]) && (draft.tags ?? []).join("\n") === (base.tags ?? []).join("\n");
}
