import { actionDate, todayIso } from "./date";
import type { Task, TaskQuery } from "./types";

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

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const leftDate = actionDate(left) ?? "9999-12-31";
    const rightDate = actionDate(right) ?? "9999-12-31";
    return (
      leftDate.localeCompare(rightDate) ||
      (left.priority ?? 4) - (right.priority ?? 4) ||
      left.path.localeCompare(right.path) ||
      left.line - right.line
    );
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
