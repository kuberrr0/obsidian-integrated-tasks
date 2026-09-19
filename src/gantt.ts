import { addDays, localDate } from "./calendar";
import type { ProjectProperties } from "./types";

export type GanttZoom = "month" | "quarter" | "year" | "five-year";
export type ProjectDateField = "scheduledDate" | "endDate" | "deadline";
export type GanttHandle = "start" | "finish" | "end";
export const GANTT_ZOOMS: Record<GanttZoom, { days: number; width: number }> = {
  month: { days: 35, width: 32 }, quarter: { days: 91, width: 12 },
  year: { days: 366, width: 3 }, "five-year": { days: 1827, width: 0.7 }
};
export function daysBetween(start: string, end: string): number {
  const utc = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(end) - utc(start)) / 86400000);
}
export function ganttRange(project: ProjectProperties): { start: string; end: string; finishField: "deadline" | "endDate"; marker?: string } | undefined {
  const start = project.scheduledDate;
  const end = project.endDate;
  if (!start || !end || end < start) return undefined;
  return { start, end, finishField: "endDate" };
}
/** Start/end dates snap to days independently of the deadline. */
export function resizeProjectDate(project: ProjectProperties, handle: GanttHandle, delta: number): { field: ProjectDateField; value: string } {
  const range = ganttRange(project);
  if (!range) throw new Error("Set a start date and a valid end date first.");
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

/** Calendar boundaries, clipped to the buffered timeline while retaining their labels. */
export function ganttSegments(start: string, days: number, zoom: GanttZoom): Array<{ start: string; offset: number; days: number; label: string }> {
  const segments: Array<{ start: string; offset: number; days: number; label: string }> = [];
  for (let offset = 0; offset < days; offset++) {
    const iso = addDays(start, offset), date = localDate(iso);
    const boundary = zoom === "month" ? date.getDay() === 1 : zoom === "five-year" ? date.getMonth() === 0 && date.getDate() === 1 : date.getDate() === 1;
    if (offset === 0 || boundary) {
      const weekStart = localDate(addDays(iso, -((date.getDay() + 6) % 7)));
      const label = zoom === "month" ? weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : zoom === "five-year" ? String(date.getFullYear()) : date.toLocaleDateString("en-US", { month: "short" });
      segments.push({ start: iso, offset, days: 0, label });
    }
    segments[segments.length - 1].days++;
  }
  return segments;
}
