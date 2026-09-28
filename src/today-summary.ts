import { actionDate, todayIso } from "./date";
import { renderProjectProgress } from "./project-progress";
import { formatDuration } from "./parser";
import { taskTimeLabel } from "./task-row-details";
import type { Task } from "./types";

export interface TodaySummary {
  /** Tasks whose action date is today, open or done (not cancelled). */
  total: number;
  done: number;
  /** Open tasks due today (or overdue) that are in progress. */
  inProgress: number;
  overdue: number;
  /** Duration of today's open tasks. */
  plannedMinutes: number;
  next?: { task: Task; time: string; minutesAway: number };
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function todaySummary(tasks: Task[], now = new Date()): TodaySummary {
  const today = todayIso(now);
  const current = now.getHours() * 60 + now.getMinutes();
  const summary: TodaySummary = { total: 0, done: 0, inProgress: 0, overdue: 0, plannedMinutes: 0 };
  for (const task of tasks) {
    const date = actionDate(task);
    if (!date || task.status === "cancelled" || date > today) continue;
    if (task.status === "doing") summary.inProgress++;
    if (date < today) { if (!task.completed) summary.overdue++; continue; }
    summary.total++;
    if (task.completed) { summary.done++; continue; }
    summary.plannedMinutes += task.durationMinutes ?? 0;
    if (task.scheduledDate !== today || !task.scheduledTime) continue;
    const minutesAway = minutesOf(task.scheduledTime) - current;
    if (minutesAway >= 0 && (!summary.next || minutesAway < summary.next.minutesAway)) summary.next = { task, time: task.scheduledTime, minutesAway };
  }
  return summary;
}

function countdown(minutes: number): string {
  if (minutes < 1) return "now";
  return `in ${minutes < 60 ? `${minutes} min` : formatDuration(minutes)}`;
}

/** Completion circle, planned time and the next timed task; `live` adds a countdown the caller keeps fresh. */
export function renderTodaySummary(parent: HTMLElement, summary: TodaySummary, live = true): HTMLElement {
  const root = parent.createDiv({ cls: "tm-today-summary" });
  // The same completion circle as projects use.
  renderProjectProgress(root, { name: "Today", path: "", openTasks: summary.total - summary.done, completedTasks: summary.done, archived: false }, false);
  const stats = root.createDiv({ cls: "tm-today-stats" });
  stats.createSpan({ cls: "tm-today-stat", text: `${summary.done} of ${summary.total} done` });
  if (summary.inProgress) stats.createSpan({ cls: "tm-today-stat is-doing", text: `${summary.inProgress} in progress` });
  if (summary.plannedMinutes) stats.createSpan({ cls: "tm-today-stat", text: `${formatDuration(summary.plannedMinutes)} planned` });
  if (summary.overdue) stats.createSpan({ cls: "tm-today-stat is-overdue", text: `${summary.overdue} overdue` });
  if (summary.next) {
    const next = stats.createSpan({ cls: "tm-today-stat tm-today-next" });
    next.setText(`Next: ${summary.next.task.title} at ${taskTimeLabel(summary.next.time)}${live ? ` · ${countdown(summary.next.minutesAway)}` : ""}`);
  }
  return root;
}
