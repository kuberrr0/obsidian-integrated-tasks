import { matchesFilter, propertyValue, propertyLabel } from "./task-properties";
import { actionDate, todayIso } from "./date";
import type { Task, TaskQuery, TaskSort, TaskGrouping } from "./types";

export function taskMatchesQuery(task: Task, query: TaskQuery, inboxPath: string, now = new Date()): boolean {
  if (query.filters?.some(filter => !matchesFilter(task, filter))) return false;
  if (!query.showCompleted && !query.filters?.some(filter => filter.property === "status") && task.completed) return false;
  if (query.sourcePath && task.path !== query.sourcePath) return false;
  if (query.projectPath && task.path !== query.projectPath) return false;
  if (query.priority && task.priority !== query.priority) return false;
  if (query.search && !`${task.title}\n${task.description ?? ""}`.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) return false;

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

/** Date-only tasks precede timed tasks on the same day in ascending order. */
function dateTimeValue(date?: string, time?: string): string | undefined {
  return date ? `${date}T${time ?? ""}` : undefined;
}

function sortValue(task: Task, sort: TaskSort): string | number | undefined {
  const scheduled = dateTimeValue(task.scheduledDate, task.scheduledTime);
  const deadline = dateTimeValue(task.deadline, task.deadlineTime);
  if (sort === "scheduledDate" || sort === "scheduledTime") return scheduled;
  if (sort === "deadline" || sort === "deadlineTime") return deadline;
  if (sort === "date") return scheduled && deadline ? (scheduled < deadline ? scheduled : deadline) : scheduled ?? deadline ?? "9999-12-31";
  return propertyValue(task, sort);
}

export function sortTasks(tasks: Task[], sort: TaskSort = "date", descending = false): Task[] {
  return [...tasks].sort((left, right) => {
    const leftValue = sortValue(left, sort);
    const rightValue = sortValue(right, sort);
    if (leftValue === undefined || leftValue === "") return rightValue === undefined || rightValue === "" ? 0 : 1;
    if (rightValue === undefined || rightValue === "") return -1;
    const comparison = (typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue)))
      || (sort === "source" ? left.line - right.line : sort === "date" ? (left.priority ?? 4) - (right.priority ?? 4) : 0);
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
    const value = grouping === "date" ? actionDate(task) : propertyValue(task, grouping);
    const key = value === undefined || value === "" ? `No ${grouping === "date" ? "date" : grouping === "scheduledDate" ? "scheduled date" : grouping === "scheduledTime" ? "scheduled time" : grouping === "deadlineTime" ? "deadline time" : grouping}`
      : grouping === "date" ? String(value) : propertyLabel(grouping, value);
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
