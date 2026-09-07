import { describe, expect, it } from "vitest";
import { groupByActionDate, groupTasks, orderTaskTree, sortTasks, taskMatchesQuery } from "../src/query";
import type { Task } from "../src/types";

const now = new Date(2026, 8, 4, 12, 0, 0);

function task(overrides: Partial<Task>): Task {
  return {
    id: "Project.md:0",
    path: "Project.md",
    line: 0,
    endLine: 0,
    raw: "- [ ] Task",
    indent: 0,
    completed: false,
    title: "Task",
    childIds: [],
    ...overrides
  };
}

describe("task queries", () => {
  it("puts overdue and today tasks in Today", () => {
    expect(taskMatchesQuery(task({ scheduledDate: "2026-09-03" }), { mode: "today", showCompleted: false }, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(task({ scheduledDate: "2026-09-04" }), { mode: "today", showCompleted: false }, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(task({ scheduledDate: "2026-09-05" }), { mode: "today", showCompleted: false }, "Inbox.md", now)).toBe(false);
  });

  it("uses the earlier of scheduled date and deadline without duplication", () => {
    const atRisk = task({ scheduledDate: "2026-09-10", deadline: "2026-09-04" });
    expect(taskMatchesQuery(atRisk, { mode: "today", showCompleted: false }, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(atRisk, { mode: "upcoming", showCompleted: false }, "Inbox.md", now)).toBe(false);
  });

  it("places deadline-only tasks into date views", () => {
    const deadlineOnly = task({ deadline: "2026-09-05" });
    expect(taskMatchesQuery(deadlineOnly, { mode: "upcoming", showCompleted: false }, "Inbox.md", now)).toBe(true);
  });

  it("keeps undated tasks out of date views", () => {
    const undated = task({});
    expect(taskMatchesQuery(undated, { mode: "today", showCompleted: false }, "Inbox.md", now)).toBe(false);
    expect(taskMatchesQuery(undated, { mode: "upcoming", showCompleted: false }, "Inbox.md", now)).toBe(false);
    expect(taskMatchesQuery(undated, { mode: "all", showCompleted: false }, "Inbox.md", now)).toBe(true);
  });

  it("uses physical note membership for Inbox and Projects", () => {
    const inboxTask = task({ path: "Inbox.md" });
    expect(taskMatchesQuery(inboxTask, { mode: "inbox", showCompleted: false }, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(inboxTask, { mode: "project", projectPath: "Project.md", showCompleted: false }, "Inbox.md", now)).toBe(false);
  });

  it("hides completed tasks unless requested", () => {
    const completed = task({ completed: true });
    expect(taskMatchesQuery(completed, { mode: "all", showCompleted: false }, "Inbox.md", now)).toBe(false);
    expect(taskMatchesQuery(completed, { mode: "all", showCompleted: true }, "Inbox.md", now)).toBe(true);
  });

  it("groups future tasks by their earliest actionable date", () => {
    const groups = groupByActionDate([
      task({ id: "a", scheduledDate: "2026-09-08" }),
      task({ id: "b", scheduledDate: "2026-09-10", deadline: "2026-09-08" }),
      task({ id: "c", scheduledDate: "2026-09-09" })
    ]);
    expect([...groups.keys()]).toEqual(["2026-09-08", "2026-09-09"]);
    expect(groups.get("2026-09-08")).toHaveLength(2);
  });
});

describe("shared task view controls", () => {
  it.each(["inbox", "today", "upcoming", "all", "project"] as const)("combines search and filters with the %s scope", (mode) => {
    const candidate = task({ path: "Inbox.md", title: "Write proposal", priority: 2, scheduledDate: mode === "upcoming" ? "2026-09-06" : "2026-09-04" });
    const query = { mode, projectPath: mode === "project" ? "Inbox.md" : undefined, showCompleted: false, search: "PROPOSAL", priority: 2 as const, dateFilter: "dated" as const };
    expect(taskMatchesQuery(candidate, query, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(candidate, { ...query, search: "missing" }, "Inbox.md", now)).toBe(false);
    expect(taskMatchesQuery(candidate, { ...query, priority: 1 }, "Inbox.md", now)).toBe(false);
    expect(taskMatchesQuery(candidate, { ...query, sourcePath: "Other.md" }, "Inbox.md", now)).toBe(false);
  });

  it("scopes an ordinary page without project metadata", () => {
    const query = { mode: "project" as const, projectPath: "Notes.md", showCompleted: false };
    expect(taskMatchesQuery(task({ path: "Notes.md" }), query, "Inbox.md", now)).toBe(true);
    expect(taskMatchesQuery(task({ path: "Other.md" }), query, "Inbox.md", now)).toBe(false);
  });

  const tasks = [
    task({ id: "a", title: "Zulu", priority: 1, durationMinutes: 60, line: 2, scheduledDate: "2026-09-06" }),
    task({ id: "b", title: "Alpha", priority: 3, durationMinutes: 15, line: 0, scheduledDate: "2026-09-05" })
  ];
  it.each([["date", ["b", "a"]], ["priority", ["a", "b"]], ["title", ["b", "a"]], ["source", ["b", "a"]], ["duration", ["b", "a"]]] as const)("sorts by %s in either direction", (sort, expected) => {
    expect(sortTasks(tasks, sort).map((item) => item.id)).toEqual(expected);
    expect(sortTasks(tasks, sort, true).map((item) => item.id)).toEqual([...expected].reverse());
    expect(tasks.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("includes undated and unprioritized tasks in groups without re-sorting", () => {
    const ordered = [...tasks, task({ id: "c", completed: true })];
    expect([...groupTasks(ordered, "date").keys()]).toEqual(["2026-09-06", "2026-09-05", "No date"]);
    expect([...groupTasks(ordered, "priority").keys()]).toEqual(["P1", "P3", "No priority"]);
    expect(groupTasks(ordered, "source").get("Project.md")).toEqual(ordered);
    expect(groupTasks(ordered, "status").get("Completed")?.map((item) => item.id)).toEqual(["c"]);
  });

  it("keeps children after visible parents and promotes children whose parents are filtered out", () => {
    const parent = task({ id: "parent", title: "Zulu" });
    const child = task({ id: "child", parentId: "parent", title: "Alpha" });
    const sibling = task({ id: "sibling", title: "Beta" });
    expect(orderTaskTree(sortTasks([parent, child, sibling], "title")).map((item) => item.id)).toEqual(["sibling", "parent", "child"]);
    expect(orderTaskTree([child, sibling])).toEqual([child, sibling]);
  });
});


it("searches description text case-insensitively", () => {
  const described = task({ title: "Plan", description: "- Review the release budget" });
  expect(taskMatchesQuery(described, { mode: "all", showCompleted: false, search: "BUDGET" }, "Inbox.md", now)).toBe(true);
  expect(taskMatchesQuery(described, { mode: "all", showCompleted: false, search: "missing" }, "Inbox.md", now)).toBe(false);
});


describe("date and time sorting", () => {
  it.each(["scheduledDate", "scheduledTime", "deadline", "deadlineTime", "date"] as const)("sorts %s by date first and then time in both directions", sort => {
    const values = [
      task({ id: "late", line: 0, priority: 1, scheduledDate: "2026-09-07", scheduledTime: "15:00", deadline: "2026-09-07", deadlineTime: "15:00" }),
      task({ id: "tomorrow", line: 1, scheduledDate: "2026-09-08", scheduledTime: "01:00", deadline: "2026-09-08", deadlineTime: "01:00" }),
      task({ id: "early", line: 2, priority: 3, scheduledDate: "2026-09-07", scheduledTime: "09:00", deadline: "2026-09-07", deadlineTime: "09:00" }),
      task({ id: "all-day", line: 3, scheduledDate: "2026-09-07", deadline: "2026-09-07" })
    ];
    const expected = ["all-day", "early", "late", "tomorrow"];
    expect(sortTasks(values, sort).map(task => task.id)).toEqual(expected);
    expect(sortTasks(values, sort, true).map(task => task.id)).toEqual([...expected].reverse());
  });
  it("uses only the time belonging to the selected date property", () => {
    const values = [
      task({ id: "scheduled-first", scheduledDate: "2026-09-07", scheduledTime: "08:00", deadline: "2026-09-07", deadlineTime: "16:00" }),
      task({ id: "deadline-first", scheduledDate: "2026-09-07", scheduledTime: "10:00", deadline: "2026-09-07", deadlineTime: "07:00" })
    ];
    expect(sortTasks(values, "scheduledDate").map(task => task.id)).toEqual(["scheduled-first", "deadline-first"]);
    expect(sortTasks(values, "deadline").map(task => task.id)).toEqual(["deadline-first", "scheduled-first"]);
    expect(sortTasks(values, "date").map(task => task.id)).toEqual(["deadline-first", "scheduled-first"]);
  });
  it("uses the earlier date's time for action sorting and groups by day", () => {
    const values = [
      task({ id: "later", scheduledDate: "2026-09-07", scheduledTime: "15:00", deadline: "2026-09-08", deadlineTime: "01:00" }),
      task({ id: "earlier", scheduledDate: "2026-09-09", scheduledTime: "23:00", deadline: "2026-09-07", deadlineTime: "09:00" })
    ];
    expect([...groupByActionDate(values).entries()].map(([date, tasks]) => [date, tasks.map(task => task.id)])).toEqual([["2026-09-07", ["earlier", "later"]]]);
  });
  it.each(["scheduledDate", "deadline"] as const)("keeps missing %s values last in both directions", sort => {
    const values = [task({ id: "missing" }), task({ id: "dated", [sort]: "2026-09-07" })];
    expect(sortTasks(values, sort).map(task => task.id)).toEqual(["dated", "missing"]);
    expect(sortTasks(values, sort, true).map(task => task.id)).toEqual(["dated", "missing"]);
  });
});
