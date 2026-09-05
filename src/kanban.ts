import { groupTasks } from "./query";
import { taskGroupTarget, type ListDropGroup } from "./list-drag";
import type { Task, TaskGrouping } from "./types";

export interface KanbanColumn { title: string; tasks: Task[]; target?: ListDropGroup }
export function kanbanColumns(tasks: Task[], grouping: TaskGrouping): KanbanColumn[] {
  if (grouping === "none") return [{ title: "Tasks", tasks }];
  const property = grouping === "default" ? "status" : grouping;
  const groups = groupTasks(tasks, property);
  if (property === "status") return ["Open", "Completed"].map(title => ({ title, tasks: groups.get(title) ?? [], target: { property, value: title } }));
  if (property === "priority") return [1, 2, 3, undefined].map(value => {
    const title = value ? `P${value}` : "No priority";
    return { title, tasks: groups.get(title) ?? [], target: { property, value } };
  });
  return [...groups].map(([title, tasks]) => ({ title, tasks, target: taskGroupTarget(property, tasks[0]) }));
}
