import { afterEach, describe, expect, it, vi } from "vitest";
import { scanTasks } from "../src/parser";
import { groupTasks, isDeferred, sortTasks, taskMatchesQuery } from "../src/query";
import { draftForGroup, type ListDropGroup } from "../src/list-drag";
import { planBulkTasks } from "../src/bulk-tasks";
import { kanbanColumns } from "../src/kanban";
import { propertyValue, TASK_PROPERTIES } from "../src/task-properties";
import type { Task, TaskQuery } from "../src/types";

const reference = new Date(2026, 8, 26, 12);
const note = [
  "- [ ] Plain today [[2026-09-26]]",
  "- [ ] Hidden today [[2026-09-26]] >2026-10-01",
  "- [ ] Someday today [[2026-09-26]] >someday",
  "- [ ] Hidden upcoming [[2026-09-30]] >2026-09-28",
  "- [ ] Past defer [[2026-09-26]] >2026-09-20",
  "- [ ] Undated hidden >2026-10-05"
].join("\n");
const inbox = (): Task[] => scanTasks("Inbox.md", note, reference);
const titles = (tasks: Task[], query: TaskQuery, now = reference): string[] =>
  tasks.filter(task => taskMatchesQuery(task, query, "Inbox.md", now)).map(task => task.title);

afterEach(() => vi.useRealTimers());

describe("isDeferred", () => {
  it("hides someday and future dates, not today or the past", () => {
    expect(isDeferred({ someday: true }, "2026-09-26")).toBe(true);
    expect(isDeferred({ deferDate: "2026-09-27" }, "2026-09-26")).toBe(true);
    expect(isDeferred({ deferDate: "2026-09-26" }, "2026-09-26")).toBe(false);
    expect(isDeferred({ deferDate: "2026-09-20" }, "2026-09-26")).toBe(false);
    expect(isDeferred({}, "2026-09-26")).toBe(false);
  });
  it("defaults to the current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 8));
    expect(isDeferred({ deferDate: "2026-10-01" })).toBe(false);
    expect(isDeferred({ deferDate: "2026-10-02" })).toBe(true);
  });
});

describe("hiding deferred tasks", () => {
  it("hides them from Inbox, Today and Upcoming", () => {
    expect(titles(inbox(), { mode: "inbox", showCompleted: false })).toEqual(["Plain today", "Past defer"]);
    expect(titles(inbox(), { mode: "today", showCompleted: false })).toEqual(["Plain today", "Past defer"]);
    expect(titles(inbox(), { mode: "upcoming", showCompleted: false })).toEqual([]);
  });
  it("keeps them in All, projects, tags, smart lists and the dashboard", () => {
    for (const mode of ["all", "tags", "smartLists", "dashboard"] as const) {
      expect(titles(inbox(), { mode, showCompleted: false })).toHaveLength(6);
    }
    expect(titles(inbox(), { mode: "project", projectPath: "Inbox.md", showCompleted: false })).toHaveLength(6);
  });
  it("shows them again on the defer date without any write", () => {
    const onDeferDate = new Date(2026, 8, 28, 9);
    expect(titles(inbox(), { mode: "upcoming", showCompleted: false }, onDeferDate)).toEqual(["Hidden upcoming"]);
    expect(titles(inbox(), { mode: "today", showCompleted: false }, new Date(2026, 9, 1, 9))).toContain("Hidden today");
    expect(titles(inbox(), { mode: "today", showCompleted: false }, new Date(2026, 9, 1, 9))).not.toContain("Someday today");
  });
  it("shows them when the query explicitly filters on the defer", () => {
    const filters = [{ property: "defer" as const, operator: "has" as const, values: [] }];
    expect(titles(inbox(), { mode: "today", showCompleted: false, filters })).toEqual(["Hidden today", "Someday today", "Past defer"]);
    expect(titles(inbox(), { mode: "inbox", showCompleted: false, filters: [{ property: "defer", operator: "is", values: ["Someday"] }] })).toEqual(["Someday today"]);
  });
});

describe("defer as a property", () => {
  it("is listed as Hidden until after the deadline time", () => {
    const keys = TASK_PROPERTIES.map(property => property.key);
    expect(keys.indexOf("defer")).toBe(keys.indexOf("deadlineTime") + 1);
    expect(TASK_PROPERTIES.find(property => property.key === "defer")).toMatchObject({ label: "Hidden until", kind: "date" });
  });
  it("sorts dates, then Someday, then tasks without a defer, and labels groups", () => {
    const tasks = inbox();
    expect(propertyValue(tasks[2], "defer")).toBe("Someday");
    expect(propertyValue(tasks[1], "defer")).toBe("2026-10-01");
    const sorted = sortTasks(tasks, "defer");
    expect(sorted.map(task => propertyValue(task, "defer"))).toEqual(["2026-09-20", "2026-09-28", "2026-10-01", "2026-10-05", "Someday", undefined]);
    expect([...groupTasks(sorted, "defer").keys()]).toEqual(["2026-09-20", "2026-09-28", "2026-10-01", "2026-10-05", "Someday", "Not hidden"]);
  });
  it("orders kanban columns by date, then Someday, then Not hidden, with drop targets", () => {
    const columns = kanbanColumns(inbox(), "defer");
    expect(columns.map(column => column.title)).toEqual(["2026-09-20", "2026-09-28", "2026-10-01", "2026-10-05", "Someday", "Not hidden"]);
    expect(columns[4].target).toEqual({ property: "defer", value: "Someday" });
    expect(columns[5].target).toEqual({ property: "defer", value: undefined });
    expect(draftForGroup(inbox()[0], columns[1].target)).toMatchObject({ deferDate: "2026-09-28" });
  });
});

describe("defer drop targets", () => {
  const [plain, dated, someday] = inbox();
  it.each([
    ["a date", plain, "2026-10-10", { deferDate: "2026-10-10", someday: undefined }],
    ["a date over someday", someday, "2026-10-10", { deferDate: "2026-10-10", someday: undefined }],
    ["Someday", dated, "Someday", { deferDate: undefined, someday: true }],
    ["nothing", dated, undefined, { deferDate: undefined, someday: undefined }],
    ["an empty value", someday, "", { deferDate: undefined, someday: undefined }]
  ])("drops onto %s", (_name, task, value, expected) => {
    const draft = draftForGroup(task, { property: "defer", value });
    expect({ deferDate: draft.deferDate, someday: draft.someday }).toEqual(expected);
    expect(draft.scheduledDate).toBe(task.scheduledDate);
  });
  it("keeps the defer on untouched drafts", () => {
    expect(draftForGroup(dated)).toMatchObject({ deferDate: "2026-10-01" });
    expect(draftForGroup(someday)).toMatchObject({ someday: true });
  });

  it("writes through the bulk planner in place", () => {
    const content = "# Plan\n- [ ] Write ~[[Work#Later]] p2 ^abc\n  - detail\n- [ ] Read >2026-10-01\n- [ ] Rest >someday #[[home]]\n";
    const tasks = scanTasks("Work.md", content, reference);
    const drop = (group: ListDropGroup) => tasks.map(task => ({ task, draft: draftForGroup(task, group) }));
    expect(planBulkTasks(new Map([["Work.md", content]]), drop({ property: "defer", value: "2026-10-03" })).get("Work.md"))
      .toBe("# Plan\n- [ ] Write >[[2026-10-03]] ~[[Work#Later]] p2 ^abc\n  - detail\n- [ ] Read >[[2026-10-03]]\n- [ ] Rest >[[2026-10-03]] #[[home]]\n");
    expect(planBulkTasks(new Map([["Work.md", content]]), drop({ property: "defer", value: "Someday" }), { linkDates: false }).get("Work.md"))
      .toBe("# Plan\n- [ ] Write >someday ~[[Work#Later]] p2 ^abc\n  - detail\n- [ ] Read >someday\n- [ ] Rest >someday #[[home]]\n");
    expect(planBulkTasks(new Map([["Work.md", content]]), drop({ property: "defer", value: undefined })).get("Work.md"))
      .toBe("# Plan\n- [ ] Write ~[[Work#Later]] p2 ^abc\n  - detail\n- [ ] Read\n- [ ] Rest #[[home]]\n");
  });

  it("applies a bulk patch spread over each draft", () => {
    const content = "- [ ] Read >2026-10-01 p1\n- [ ] Rest\n";
    const tasks = scanTasks("Work.md", content, reference);
    const patch = { deferDate: undefined, someday: true };
    expect(planBulkTasks(new Map([["Work.md", content]]), tasks.map(task => ({ task, draft: { ...draftForGroup(task), ...patch } }))).get("Work.md"))
      .toBe("- [ ] Read >someday p1\n- [ ] Rest >someday\n");
  });
});
