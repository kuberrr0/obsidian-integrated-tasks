import { groupTasks } from "./query";
import { taskGroupTarget, type ListDropGroup } from "./list-drag";
import { STATUS_LABELS, TASK_STATUSES } from "./task-status";
import type { Task, TaskGrouping } from "./types";

const deferRank = (title: string): number => title === "Not hidden" ? 2 : title === "Someday" ? 1 : 0;

export interface KanbanColumn { title: string; tasks: Task[]; target?: ListDropGroup }
export function kanbanColumns(tasks: Task[], grouping: TaskGrouping): KanbanColumn[] {
  if (grouping === "none") return [{ title: "Tasks", tasks }];
  const property = grouping === "default" ? "section" : grouping;
  const groups = groupTasks(tasks, property);
  if (property === "status") return TASK_STATUSES.map(status => STATUS_LABELS[status])
    .map(title => ({ title, tasks: groups.get(title) ?? [], target: { property, value: title } }));
  if (property === "priority") return [1, 2, 3, undefined].map(value => {
    const title = value ? `P${value}` : "No priority";
    return { title, tasks: groups.get(title) ?? [], target: { property, value } };
  });
  // Dates ascending, then Someday, then tasks without a defer; independent of the list sort.
  if (property === "defer") return [...groups].sort(([a], [b]) => deferRank(a) - deferRank(b) || a.localeCompare(b))
    .map(([title, tasks]) => ({ title, tasks, target: { property, value: title === "Not hidden" ? undefined : title } }));
  return [...groups].map(([title, tasks]) => ({ title, tasks, target: taskGroupTarget(property, tasks[0]) }));
}
