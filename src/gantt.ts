import { addDays, localDate } from "./calendar";
import type { ProjectProperties } from "./types";

export type GanttZoom = "month" | "quarter" | "year" | "five-year";
export type ProjectDateField = "scheduledDate" | "endDate" | "deadline";
export type GanttHandle = "start" | "finish";
export const GANTT_ZOOMS: Record<GanttZoom, { days: number; width: number }> = {
  month: { days: 35, width: 32 }, quarter: { days: 91, width: 12 },
  year: { days: 366, width: 3 }, "five-year": { days: 1827, width: 0.7 }
};
/** How far zooming goes: pixels per day. */
export const GANTT_MIN_SCALE = 0.5;
export const GANTT_MAX_SCALE = 96;

/** The range a zoomed scale reads as (its dates labelled, and its arrows moving, as that range's are). */
export function ganttZoomFor(scale: number): GanttZoom {
  return scale >= 20 ? "month" : scale >= 6 ? "quarter" : scale >= 1.5 ? "year" : "five-year";
}

/** The Gantt opens at the start of the year, for an overview of it. */
export function ganttYearStart(today: string): string { return `${today.slice(0, 4)}-01-01`; }

/** The arrows' period, from the first day in view: a month, a quarter, a year or five years. */
export function shiftGantt(anchor: string, zoom: GanttZoom, direction: number): string {
  const date = localDate(anchor);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + direction * { month: 1, quarter: 3, year: 12, "five-year": 60 }[zoom]);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return addDays(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`, date.getDate() - 1);
}

export function ganttRange(project: ProjectProperties): { start: string; end: string } | undefined {
  const start = project.scheduledDate;
  const end = project.endDate;
  if (!start || !end || end < start) return undefined;
  return { start, end };
}
/** Start/end dates snap to days independently of the deadline. */
export function resizeProjectDate(project: ProjectProperties, handle: GanttHandle, delta: number): { field: ProjectDateField; value: string } {
  const range = ganttRange(project);
  if (!range) throw new Error("Set a start date and a valid end date first.");
  const field = handle === "start" ? "scheduledDate" : "endDate";
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

export interface GanttSegment { start: string; offset: number; days: number; label: string; year?: string }

/**
 * Calendar boundaries, clipped to the buffered timeline while retaining their labels. A year's first month (or, by
 * weeks, its first week) also names the year.
 */
export function ganttSegments(start: string, days: number, zoom: GanttZoom): GanttSegment[] {
  const segments: GanttSegment[] = [];
  let lastYear: number | undefined;
  for (let offset = 0; offset < days; offset++) {
    const iso = addDays(start, offset), date = localDate(iso);
    const boundary = zoom === "month" ? date.getDay() === 1 : zoom === "five-year" ? date.getMonth() === 0 && date.getDate() === 1 : date.getDate() === 1;
    if (offset === 0 || boundary) {
      const weekStart = localDate(addDays(iso, -((date.getDay() + 6) % 7)));
      const label = zoom === "month" ? weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : zoom === "five-year" ? String(date.getFullYear()) : date.toLocaleDateString("en-US", { month: "short" });
      const year = (zoom === "month" ? weekStart : date).getFullYear();
      const segment: GanttSegment = { start: iso, offset, days: 0, label };
      if (zoom !== "five-year" && lastYear !== undefined && year !== lastYear) segment.year = String(year);
      lastYear = year;
      segments.push(segment);
    }
    segments[segments.length - 1].days++;
  }
  return segments;
}
