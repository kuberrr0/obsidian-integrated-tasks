import { destinationString } from "./structure";
import type { Task, TaskDraft } from "./types";

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
