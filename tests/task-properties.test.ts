import { describe, expect, it } from "vitest";
import { TASK_PROPERTIES, matchesFilter } from "../src/task-properties";
import { groupTasks, sortTasks, taskMatchesQuery } from "../src/query";
import type { Task, TaskFilter } from "../src/types";

const task: Task = { id: "a", path: "Work.md", line: 0, endLine: 0, raw: "", indent: 0, completed: false, title: "Write report", childIds: [], priority: 2, scheduledDate: "2026-09-01", scheduledTime: "09:00", deadline: "2026-09-10", deadlineTime: "17:00", durationMinutes: 45, section: "Work" };
const filter = (property: TaskFilter["property"], operator: TaskFilter["operator"], values: string[] = []): TaskFilter => ({ property, operator, values });

describe("property filters", () => {
  it("matches several priorities and combines properties with AND", () => {
    const query = { mode: "all" as const, showCompleted: false, filters: [filter("priority", "is", ["1", "2"]), filter("duration", "between", ["30", "60"])] };
    expect(taskMatchesQuery(task, query, "Inbox.md")).toBe(true);
    expect(taskMatchesQuery({ ...task, durationMinutes: 90 }, query, "Inbox.md")).toBe(false);
    expect(taskMatchesQuery({ ...task, priority: 3 }, query, "Inbox.md")).toBe(false);
  });
  it("uses actual deadline independently of the earlier scheduled date", () => {
    expect(matchesFilter(task, filter("deadline", "between", ["2026-09-10", "2026-09-12"]))).toBe(true);
    expect(matchesFilter(task, filter("deadline", "before", ["2026-09-10"]))).toBe(false);
    expect(matchesFilter({ ...task, deadline: undefined }, filter("deadline", "missing"))).toBe(true);
    expect(matchesFilter({ ...task, deadline: undefined }, filter("deadline", "after", ["2026-09-01"]))).toBe(false);
  });
  it("supports times, numeric duration comparisons, and case-insensitive text", () => {
    expect(matchesFilter(task, filter("scheduledTime", "between", ["08:00", "09:00"]))).toBe(true);
    expect(matchesFilter(task, filter("deadlineTime", "after", ["16:00"]))).toBe(true);
    expect(matchesFilter(task, filter("duration", "before", ["100"]))).toBe(true);
    expect(matchesFilter(task, filter("title", "contains", ["REPORT"]))).toBe(true);
    expect(matchesFilter(task, filter("duration", "between", ["60", "30"]))).toBe(false);
  });
  it("lets status selection include completed tasks without escaping view scope", () => {
    const query = { mode: "inbox" as const, showCompleted: false, filters: [filter("status", "is", ["Completed"])] };
    expect(taskMatchesQuery({ ...task, completed: true }, query, "Work.md")).toBe(true);
    expect(taskMatchesQuery(task, query, "Work.md")).toBe(false);
    expect(taskMatchesQuery({ ...task, completed: true }, query, "Inbox.md")).toBe(false);
  });
  it.each(TASK_PROPERTIES)("supports presence, sorting and grouping for $label", ({ key }) => {
    expect(matchesFilter(task, filter(key, "has"))).toBe(true);
    expect(matchesFilter(task, filter(key, "missing"))).toBe(false);
    expect(sortTasks([task], key)).toEqual([task]);
    expect([...groupTasks([task], key).values()]).toEqual([[task]]);
  });
  it("sorts separate dates and numeric duration and groups missing values", () => {
    const other = { ...task, id: "b", deadline: "2026-09-09", durationMinutes: 120 };
    expect(sortTasks([task, other], "deadline").map(t => t.id)).toEqual(["b", "a"]);
    expect(sortTasks([task, other], "duration", true).map(t => t.id)).toEqual(["b", "a"]);
    expect([...groupTasks([task, { ...other, deadline: undefined }], "deadline").keys()]).toEqual(["2026-09-10", "No deadline"]);
  });
});
