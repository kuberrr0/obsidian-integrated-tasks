import { formatLocalDate } from "./date";
import { destinationString } from "./structure";
import type { Task, TaskDraft } from "./types";

export type CalendarScope = "day" | "four-day" | "week" | "month" | "year";
export type CalendarPreset = Pick<TaskDraft, "scheduledDate" | "scheduledTime" | "durationMinutes">;
export const SLOT_MINUTES = 15;

export function localDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
export function addDays(iso: string, days: number): string {
  const date = localDate(iso);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}
/** Calendar days from `start` to `end`, the same across daylight-saving changes. */
export function daysBetween(start: string, end: string): number {
  const utc = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(end) - utc(start)) / 86400000);
}
export function calendarDate(task: Task): string | undefined { return task.scheduledDate ?? task.deadline; }
export function calendarTime(task: Task): string | undefined { return task.scheduledDate ? task.scheduledTime : task.deadlineTime; }
export function timeMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
export function minuteTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function selectionPreset(date: string, first: number, last: number): CalendarPreset {
  const start = Math.max(0, Math.min(95, Math.min(first, last))) * SLOT_MINUTES;
  const end = (Math.max(0, Math.min(95, Math.max(first, last))) + 1) * SLOT_MINUTES;
  return { scheduledDate: date, scheduledTime: minuteTime(start), durationMinutes: end - start };
}
export function calendarDays(anchor: string, scope: "week" | "month"): string[] {
  const date = localDate(anchor);
  if (scope === "month") date.setDate(1);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  const start = formatLocalDate(date);
  return Array.from({ length: scope === "week" ? 7 : 42 }, (_, index) => addDays(start, index));
}
export function shiftCalendar(anchor: string, scope: CalendarScope, direction: number): string {
  if (scope === "four-day") return addDays(anchor, direction * 4);
  if (scope === "day" || scope === "week") return addDays(anchor, direction * (scope === "week" ? 7 : 1));
  const date = localDate(anchor);
  const day = date.getDate();
  date.setDate(1);
  if (scope === "month") date.setMonth(date.getMonth() + direction);
  else date.setFullYear(date.getFullYear() + direction);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return formatLocalDate(date);
}
/** `task` moved to `date`: at `time`, keeping its own without one, or with none when `time` is null (an all-day row). */
export function rescheduledDraft(task: Task, date: string, time?: string | null): TaskDraft {
  return { ...task, scheduledDate: date, scheduledTime: time === null ? undefined : time ?? task.scheduledTime,
    destination: destinationString(task.path, task.section) };
}

/**
 * Side-by-side columns for a day's timed tasks, given in order of start: tasks that overlap, directly or through
 * another, share the width between them; a task that overlaps none takes all of it.
 */
export function overlapColumns(ranges: Array<{ begin: number; end: number }>): Array<{ column: number; columns: number }> {
  const placed: Array<{ column: number; columns: number }> = [];
  let cluster: Array<{ column: number; columns: number }> = [];
  let ends: number[] = [];
  let clusterEnd = -Infinity;
  const close = (): void => { for (const item of cluster) item.columns = ends.length; };
  for (const { begin, end } of ranges) {
    if (begin >= clusterEnd) { close(); cluster = []; ends = []; }
    let column = ends.findIndex(value => value <= begin);
    if (column < 0) column = ends.length;
    ends[column] = end;
    clusterEnd = cluster.length ? Math.max(clusterEnd, end) : end;
    const item = { column, columns: 1 };
    cluster.push(item);
    placed.push(item);
  }
  close();
  return placed;
}

/** Resize one boundary, keeping the opposite boundary fixed within the day. */
export function resizedRange(begin: number, end: number, edge: "start" | "end", target: number): { start: number; duration: number } {
  const snapped = Math.round(target / SLOT_MINUTES) * SLOT_MINUTES;
  const start = edge === "start" ? Math.max(0, Math.min(end - SLOT_MINUTES, snapped)) : begin;
  const finish = edge === "end" ? Math.min(1440, Math.max(begin + SLOT_MINUTES, snapped)) : end;
  return { start, duration: finish - start };
}
