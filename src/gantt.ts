import { addDays } from "./calendar";
import type { ProjectProperties } from "./types";

export type GanttZoom = "week" | "month" | "quarter";
export type ProjectDateField = "scheduledDate" | "endDate" | "deadline";
export type GanttHandle = "start" | "finish" | "end";
export const GANTT_ZOOMS: Record<GanttZoom, { days: number; width: number }> = {
  week: { days: 14, width: 64 }, month: { days: 35, width: 32 }, quarter: { days: 91, width: 18 }
};
export function daysBetween(start: string, end: string): number {
  const utc = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(end) - utc(start)) / 86400000);
}
export function ganttRange(project: ProjectProperties): { start: string; end: string; finishField: "deadline" | "endDate"; marker?: string } | undefined {
  const start = project.scheduledDate;
  const end = project.deadline ?? project.endDate;
  if (!start || !end || end < start) return undefined;
  return { start, end, finishField: project.deadline ? "deadline" : "endDate", ...(project.deadline && project.endDate ? { marker: project.endDate } : {}) };
}
/** Dates snap to days; an end marker may be later than the deadline. */
export function resizeProjectDate(project: ProjectProperties, handle: GanttHandle, delta: number): { field: ProjectDateField; value: string } {
  const range = ganttRange(project);
  if (!range) throw new Error("Set a start date and a valid end date or deadline first.");
  const field = handle === "start" ? "scheduledDate" : handle === "end" ? "endDate" : range.finishField;
  const original = project[field];
  if (!original) throw new Error("This project has no end date to move.");
  let value = addDays(original, Math.round(delta));
  if (field === "scheduledDate") {
    const limit = project.endDate && project.endDate < range.end ? project.endDate : range.end;
    if (value > limit) value = limit;
  } else if (value < range.start) value = range.start;
  return { field, value };
}


export function ganttDateAt(anchor: string, offset: number, dayWidth: number, days: number): string {
  return addDays(anchor, Math.max(0, Math.min(days - 1, Math.floor(offset / dayWidth))));
}
export function ganttSelection(first: string, last: string): { scheduledDate: string; endDate: string } {
  return first <= last ? { scheduledDate: first, endDate: last } : { scheduledDate: last, endDate: first };
}
