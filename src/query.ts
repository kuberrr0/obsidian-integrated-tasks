import { actionDate, todayIso } from "./date";
import type { Task, TaskQuery, TaskSort, TaskGrouping } from "./types";

export function taskMatchesQuery(task: Task, query: TaskQuery, inboxPath: string, now = new Date()): boolean {
  if (!query.showCompleted && task.completed) return false;
  if (query.sourcePath && task.path !== query.sourcePath) return false;
  if (query.projectPath && task.path !== query.projectPath) return false;
  if (query.priority && task.priority !== query.priority) return false;
  if (query.search && !task.title.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) return false;

  const today = todayIso(now);
  const date = actionDate(task);
  if (query.dateFilter === "dated" && !date) return false;
  if (query.dateFilter === "undated" && date) return false;
  if (query.dateFilter === "overdue" && (!date || date >= today)) return false;
  switch (query.mode) {
    case "inbox":
      return task.path === inboxPath;
    case "today":
      return Boolean(date && date <= today);
    case "upcoming":
      return Boolean(date && date > today);
    case "project":
      return task.path === query.projectPath;
    case "projects":
      return false;
    case "all":
      return true;
  }
}

export function sortTasks(tasks: Task[], sort: TaskSort = "date", descending = false): Task[] {
  return [...tasks].sort((left, right) => {
    const leftDate = actionDate(left) ?? "9999-12-31";
    const rightDate = actionDate(right) ?? "9999-12-31";
    const comparison = sort === "priority" ? (left.priority ?? 4) - (right.priority ?? 4)
      : sort === "title" ? left.title.localeCompare(right.title)
      : sort === "source" ? left.path.localeCompare(right.path) || left.line - right.line
      : sort === "duration" ? (left.durationMinutes ?? Number.MAX_SAFE_INTEGER) - (right.durationMinutes ?? Number.MAX_SAFE_INTEGER)
      : leftDate.localeCompare(rightDate) || (left.priority ?? 4) - (right.priority ?? 4);
    return comparison * (descending ? -1 : 1) || left.path.localeCompare(right.path) || left.line - right.line;
  });
}

export function groupByActionDate(tasks: Task[]): Map<string, Task[]> {
  const groups = new Map<string, Task[]>();
  for (const task of sortTasks(tasks)) {
    const date = actionDate(task);
    if (!date) continue;
    const group = groups.get(date) ?? [];
    group.push(task);
    groups.set(date, group);
  }
  return groups;
}

/** Group an already sorted list, keeping its selected order within each group. */
export function groupTasks(tasks: Task[], grouping: Exclude<TaskGrouping, "default" | "none">): Map<string, Task[]> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = grouping === "date" ? actionDate(task) ?? "No date"
      : grouping === "priority" ? task.priority ? `P${task.priority}` : "No priority"
      : grouping === "status" ? task.completed ? "Completed" : "Open"
      : task.path;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return groups;
}

/** Keep visible children next to their parent while sorting sibling tasks. */
export function orderTaskTree(tasks: Task[]): Task[] {
  const visibleIds = new Set(tasks.map((task) => task.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    if (task.parentId && visibleIds.has(task.parentId)) {
      const siblings = children.get(task.parentId) ?? [];
      siblings.push(task);
      children.set(task.parentId, siblings);
    } else roots.push(task);
  }
  const result: Task[] = [];
  const append = (task: Task): void => {
    result.push(task);
    for (const child of children.get(task.id) ?? []) append(child);
  };
  for (const root of roots) append(root);
  return result;
}
