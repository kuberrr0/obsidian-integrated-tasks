import { describe, expect, it } from "vitest";
import { daysBetween, ganttDateAt, ganttSelection, ganttRange, resizeProjectDate } from "../src/gantt";
import { parseProjectProperties, updateProjectDate, updateProjectDates } from "../src/project-properties";
const project = { scheduledDate: "2026-09-06", endDate: "2026-09-09", deadline: "2026-09-10" };
describe("project Gantt", () => {
  it("spans start to deadline and marks the independent end date", () => {
    expect(ganttRange(project)).toEqual({ start: project.scheduledDate, end: project.deadline, finishField: "deadline", marker: project.endDate });
    expect(ganttRange({ ...project, endDate: undefined })).toEqual({ start: project.scheduledDate, end: project.deadline, finishField: "deadline" });
  });
  it("falls back to end date only when there is no deadline", () => {
    expect(ganttRange({ ...project, deadline: undefined })).toEqual({ start: project.scheduledDate, end: project.endDate, finishField: "endDate" });
  });
  it("does not invent ranges for missing or reversed dates", () => {
    expect(ganttRange({ deadline: "2026-09-10" })).toBeUndefined();
    expect(ganttRange({ scheduledDate: "2026-09-10" })).toBeUndefined();
    expect(ganttRange({ ...project, deadline: "2026-09-01" })).toBeUndefined();
  });
  it("edits the correct property for each handle", () => {
    expect(resizeProjectDate(project, "start", -2)).toEqual({ field: "scheduledDate", value: "2026-09-04" });
    expect(resizeProjectDate(project, "finish", 2)).toEqual({ field: "deadline", value: "2026-09-12" });
    expect(resizeProjectDate({ ...project, deadline: undefined }, "finish", 2)).toEqual({ field: "endDate", value: "2026-09-11" });
    expect(resizeProjectDate(project, "end", 3)).toEqual({ field: "endDate", value: "2026-09-12" });
    expect(project.deadline).toBe("2026-09-10");
  });
  it("prevents crossing start/end boundaries while allowing end dates after deadlines", () => {
    expect(resizeProjectDate(project, "start", 20).value).toBe("2026-09-09");
    expect(resizeProjectDate(project, "finish", -20).value).toBe("2026-09-06");
    expect(resizeProjectDate(project, "end", -20).value).toBe("2026-09-06");
    expect(resizeProjectDate(project, "end", 5).value).toBe("2026-09-14");
  });
  it("counts local calendar days across daylight-saving and leap-year boundaries", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});
describe("project date writes", () => {
  it("preserves aliases, linked-date formatting and unrelated fields", () => {
    const properties = { "Start-Date": ["[[06/09/2026|Start]]"], end_date: "2026-09-09", Deadline: "2026-09-10", tags: ["project"], owner: "Me" };
    const expected = parseProjectProperties(properties, "DD/MM/YYYY");
    updateProjectDate(properties, "scheduledDate", "2026-09-07", expected, "DD/MM/YYYY");
    expect(properties).toEqual({ "Start-Date": ["[[07/09/2026|Start]]"], end_date: "2026-09-09", Deadline: "2026-09-10", tags: ["project"], owner: "Me" });
  });
  it("updates end date independently from deadline", () => {
    const properties = { date: "2026-09-06", "end date": "2026-09-09", deadline: "2026-09-10" };
    updateProjectDate(properties, "endDate", "2026-09-12", project);
    expect(properties).toEqual({ date: "2026-09-06", "end date": "2026-09-12", deadline: "2026-09-10" });
  });
  it("rejects stale edits without changing properties", () => {
    const properties = { date: "2026-09-07", "end date": "2026-09-09", deadline: "2026-09-10" };
    expect(() => updateProjectDate(properties, "deadline", "2026-09-12", project)).toThrow(/changed/);
    expect(properties.deadline).toBe("2026-09-10");
  });
});


describe("Gantt date creation", () => {
  it("maps clicked pixels to dates and clamps to the visible period", () => {
    expect(ganttDateAt("2026-09-04", 64 * 6 + 20, 64, 14)).toBe("2026-09-10");
    expect(ganttDateAt("2026-09-04", -10, 64, 14)).toBe("2026-09-04");
    expect(ganttDateAt("2026-09-04", 2000, 64, 14)).toBe("2026-09-17");
  });
  it("supports forward, reverse and single-day selections", () => {
    const range = { scheduledDate: "2026-09-06", endDate: "2026-09-10" };
    expect(ganttSelection("2026-09-06", "2026-09-10")).toEqual(range);
    expect(ganttSelection("2026-09-10", "2026-09-06")).toEqual(range);
    expect(ganttSelection("2026-09-06", "2026-09-06")).toEqual({ scheduledDate: "2026-09-06", endDate: "2026-09-06" });
  });
  it("creates start and end dates atomically, preserving unrelated properties", () => {
    const properties = { tags: ["project"], parent: "[[Parent]]", date: null, "end date": null };
    updateProjectDates(properties, ganttSelection("2026-09-06", "2026-09-10"), {});
    expect(properties).toEqual({ tags: ["project"], parent: "[[Parent]]", date: "2026-09-06", "end date": "2026-09-10" });
  });
  it("adds an end marker without changing the deadline or start", () => {
    const properties = { date: "2026-09-06", deadline: "2026-09-13" };
    updateProjectDates(properties, { endDate: "2026-09-10" }, parseProjectProperties(properties));
    expect(properties).toEqual({ date: "2026-09-06", deadline: "2026-09-13", "end date": "2026-09-10" });
  });
  it("does not partially apply invalid range updates or overwrite concurrent edits", () => {
    const properties = { tags: ["project"] };
    expect(() => updateProjectDates(properties, { scheduledDate: "2026-09-06", endDate: "bad" }, {})).toThrow();
    expect(properties).toEqual({ tags: ["project"] });
    expect(() => updateProjectDates({ date: "2026-09-05" }, { scheduledDate: "2026-09-06", endDate: "2026-09-10" }, {})).toThrow(/changed/);
  });
});
