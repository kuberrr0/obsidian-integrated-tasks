import { actionDate } from "./date";
import { destinationString } from "./structure";
import { propertyValue } from "./task-properties";
import type { Task, TaskDraft, TaskSort } from "./types";

export type ListPlacement = "before" | "after" | "child";
export interface ListDropGroup {
  property?: TaskSort;
  value?: string | number;
  destination?: string;
  scheduledDate?: string;
  deadline?: string;
}
export function taskGroupTarget(property: TaskSort, exemplar: Task): ListDropGroup {
  return {
    property, value: property === "date" ? actionDate(exemplar) : propertyValue(exemplar, property),
    destination: property === "source" ? exemplar.path : property === "section" ? destinationString(exemplar.path, exemplar.section) : undefined,
    scheduledDate: exemplar.scheduledDate, deadline: exemplar.deadline
  };
}
export function draftForGroup(task: Task, group?: ListDropGroup): TaskDraft {
  const draft: TaskDraft = { ...task, destination: destinationString(task.path, task.section) };
  if (!group) return draft;
  if (group.destination) draft.destination = group.destination;
  const value = group.value;
  switch (group.property) {
    case "date": {
      const date = value as string | undefined;
      if (!date) {
        draft.scheduledDate = draft.scheduledTime = draft.deadline = draft.deadlineTime = undefined;
      } else {
        // Action date is the earlier of schedule and deadline. Move its controlling
        // date, and advance the other only if it would keep the task in the old group.
        const original = actionDate(task);
        if (task.deadline && task.deadline === original) draft.deadline = date;
        else draft.scheduledDate = date;
        if (draft.scheduledDate && draft.scheduledDate < date) draft.scheduledDate = date;
        if (draft.deadline && draft.deadline < date) draft.deadline = date;
      }
      break;
    }
    case "scheduledDate": draft.scheduledDate = value as string | undefined; if (!value) draft.scheduledTime = undefined; break;
    case "deadline": draft.deadline = value as string | undefined; if (!value) draft.deadlineTime = undefined; break;
    case "scheduledTime": draft.scheduledTime = value as string | undefined; if (value && !draft.scheduledDate) draft.scheduledDate = group.scheduledDate; break;
    case "deadlineTime": draft.deadlineTime = value as string | undefined; if (value && !draft.deadline) draft.deadline = group.deadline; break;
    case "priority": draft.priority = value as Task["priority"]; break;
    case "duration": draft.durationMinutes = value as number | undefined; break;
    case "status": draft.completed = value === "Completed"; break;
    case "title": if (typeof value === "string") draft.title = value; break;
  }
  return draft;
}
