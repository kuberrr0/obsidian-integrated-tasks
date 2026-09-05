import { describe, expect, it } from "vitest";
import { addDays, calendarDate, calendarDays, rescheduledDraft, resizedRange, selectionPreset, shiftCalendar } from "../src/calendar";
import type { Task } from "../src/types";
const task: Task = { id: "a", title: "Write", path: "Work.md", section: "Next", line: 0, endLine: 0, raw: "", indent: 2, completed: false, childIds: [], priority: 1, durationMinutes: 45, scheduledDate: "2026-09-01", scheduledTime: "09:00", deadline: "2026-09-10", deadlineTime: "17:00" };
describe("calendar scheduling", () => {
  it("uses scheduled dates first and deadlines as a fallback", () => {
    expect(calendarDate(task)).toBe("2026-09-01");
    expect(calendarDate({ ...task, scheduledDate: undefined })).toBe("2026-09-10");
    expect(calendarDate({ ...task, scheduledDate: undefined, deadline: undefined })).toBeUndefined();
  });
  it("creates forward and reverse selections with inclusive 15-minute slots", () => {
    const expected = { scheduledDate: "2026-09-05", scheduledTime: "09:00", durationMinutes: 60 };
    expect(selectionPreset("2026-09-05", 36, 39)).toEqual(expected);
    expect(selectionPreset("2026-09-05", 39, 36)).toEqual(expected);
    expect(selectionPreset("2026-09-05", 95, 95)).toEqual({ scheduledDate: "2026-09-05", scheduledTime: "23:45", durationMinutes: 15 });
  });
  it("changes schedule without changing deadline, duration, priority, hierarchy or source", () => {
    const draft = rescheduledDraft(task, "2026-10-01", "12:30");
    expect(draft).toMatchObject({ scheduledDate: "2026-10-01", scheduledTime: "12:30", deadline: task.deadline, deadlineTime: task.deadlineTime, durationMinutes: 45, priority: 1, indent: 2, destination: "Work.md#Next" });
    expect(rescheduledDraft(task, "2026-10-01").scheduledTime).toBe("09:00");
    expect(task.scheduledDate).toBe("2026-09-01");
  });
  it("clamps month/year navigation at short months and leap years", () => {
    expect(shiftCalendar("2027-01-31", "month", 1)).toBe("2027-02-28");
    expect(shiftCalendar("2028-02-29", "year", 1)).toBe("2029-02-28");
    expect(shiftCalendar("2026-12-30", "week", 1)).toBe("2027-01-06");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("renders Monday-start weeks and complete six-week month grids", () => {
    expect(calendarDays("2026-09-05", "week")).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    const days = calendarDays("2028-02-10", "month");
    expect(days).toHaveLength(42);
    expect(days).toContain("2028-02-29");
  });
});


describe("calendar resizing", () => {
  it("moves the start while keeping the end fixed", () => {
    expect(resizedRange(540, 600, "start", 510)).toEqual({ start: 510, duration: 90 });
    expect(resizedRange(540, 600, "start", 570)).toEqual({ start: 570, duration: 30 });
  });
  it("moves the end while keeping the start fixed and snaps to 15 minutes", () => {
    expect(resizedRange(540, 600, "end", 628)).toEqual({ start: 540, duration: 90 });
    expect(resizedRange(540, 600, "end", 570)).toEqual({ start: 540, duration: 30 });
  });
  it("prevents crossing boundaries and clamps to the current day", () => {
    expect(resizedRange(540, 600, "start", 700)).toEqual({ start: 585, duration: 15 });
    expect(resizedRange(540, 600, "end", 500)).toEqual({ start: 540, duration: 15 });
    expect(resizedRange(30, 90, "start", -30)).toEqual({ start: 0, duration: 90 });
    expect(resizedRange(1380, 1440, "end", 1500)).toEqual({ start: 1380, duration: 60 });
  });
});
