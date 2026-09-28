import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn() }));
import { scanTasks } from "../src/parser";
import { matchesFilter, propertyValue } from "../src/task-properties";
import { groupTasks, sortTasks, taskMatchesQuery } from "../src/query";
import { parseTaskQuery } from "../src/task-query";
import { todaySummary } from "../src/today-summary";
import { bulkPropertyPatch, bulkPropertyValues, bulkInlineText, commonBulkValues } from "../src/bulk-task-editor";
import { taskTagSummaries } from "../src/task-tags";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS, type TaskFilter } from "../src/types";

const tasks = scanTasks("A.md", "- [ ] Todo #[[t]]\n- [/] Doing #[[t]]\n- [?] Waiting\n- [x] Done #[[t]]\n- [-] Cancelled #[[t]]");
const titles = (filter: TaskFilter) => tasks.filter(task => matchesFilter(task, filter)).map(task => task.title);
const status = (operator: TaskFilter["operator"], ...values: string[]): TaskFilter => ({ property: "status", operator, values });

describe("status as a property", () => {
  it("labels, sorts and groups statuses in table order", () => {
    expect(tasks.map(task => propertyValue(task, "status"))).toEqual(["To do", "In progress", "Waiting", "Done", "Cancelled"]);
    expect(sortTasks([...tasks].reverse(), "status").map(task => task.title)).toEqual(["Todo", "Doing", "Waiting", "Done", "Cancelled"]);
    expect([...groupTasks(tasks, "status").keys()]).toEqual(["To do", "In progress", "Waiting", "Done", "Cancelled"]);
  });

  it("filters by status, reading older smart lists' Open and Completed", () => {
    expect(titles(status("is", "In progress", "Waiting"))).toEqual(["Doing", "Waiting"]);
    expect(titles(status("is", "Open"))).toEqual(["Todo", "Doing", "Waiting"]);
    expect(titles(status("is", "Completed"))).toEqual(["Done"]);
    expect(titles(status("is", "Done"))).toEqual(["Done"]);
    expect(titles(status("isNot", "Open", "Cancelled"))).toEqual(["Done"]);
    expect(titles(status("has"))).toHaveLength(5);
  });

  it("hides cancelled tasks with completed ones, unless a status filter asks for them", () => {
    const query = { mode: "all" as const, showCompleted: false };
    expect(tasks.filter(task => taskMatchesQuery(task, query, "Inbox.md")).map(task => task.title)).toEqual(["Todo", "Doing", "Waiting"]);
    expect(tasks.filter(task => taskMatchesQuery(task, { ...query, filters: [status("is", "Cancelled")] }, "Inbox.md")).map(task => task.title)).toEqual(["Cancelled"]);
  });

  it("reads status words in task queries", () => {
    const context = { sourcePath: "A.md", dateFormat: "YYYY-MM-DD", smartLists: [], resolveNote: () => undefined };
    const values = (value: string) => parseTaskQuery(`status: ${value}`, context).query.filters![0]?.values;
    expect(["open", "to do", "todo", "in progress", "doing", "waiting", "done", "completed", "cancelled", "closed"].map(values)).toEqual([
      ["Open"], ["To do"], ["To do"], ["In progress"], ["In progress"], ["Waiting"], ["Done"], ["Done"], ["Cancelled"], ["Done", "Cancelled"]]);
    expect(values("in progress, waiting")).toEqual(["In progress", "Waiting"]);
    expect(parseTaskQuery("status: started soon", context).errors[0]).toMatch(/Status is open, to do, in progress, waiting, done or cancelled/);
  });
});

describe("counting statuses", () => {
  it("counts in-progress tasks today and leaves cancelled ones out of the total", () => {
    const now = new Date(2026, 8, 27, 14);
    const today = scanTasks("A.md", ["- [x] Done 2026-09-27", "- [-] Dropped 2026-09-27", "- [/] Doing 2026-09-27", "- [/] Late 2026-09-20", "- [/] Later 2026-09-30", "- [ ] Plan 2026-09-27"].join("\n"), now);
    expect(todaySummary(today, now)).toMatchObject({ total: 3, done: 1, inProgress: 2, overdue: 1 });
  });

  it("excludes cancelled tasks from tag and project progress", async () => {
    expect(taskTagSummaries(tasks)).toEqual([{ name: "t", openTasks: 2, completedTasks: 1 }]);
    const file = Object.assign(new TFile(), { path: "Project.md", extension: "md" });
    const app = {
      vault: { getMarkdownFiles: () => [file], getAbstractFileByPath: () => file, cachedRead: async () => "- [/] A\n- [?] B\n- [x] C\n- [-] D\n", on: () => ({}), offref: () => {} },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ["project"] } }), on: () => ({}) }
    } as unknown as App;
    const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
    await index.initialize();
    expect(index.projects()[0]).toMatchObject({ openTasks: 2, completedTasks: 1 });
  });
});

describe("bulk status field", () => {
  it("accepts the five labels, and leaves statuses alone when empty", () => {
    expect(bulkPropertyPatch({ status: "In progress" }, "YYYY-MM-DD")).toEqual({ status: "doing" });
    expect(bulkPropertyPatch({ status: "cancelled" }, "YYYY-MM-DD")).toEqual({ status: "cancelled" });
    expect(bulkPropertyPatch({ status: "" }, "YYYY-MM-DD")).toEqual({});
    expect(() => bulkPropertyPatch({ status: "Someday" }, "YYYY-MM-DD")).toThrow(/status/);
  });

  it("reports a shared status without writing it into the inline properties", () => {
    const [doing] = tasks.slice(1);
    expect(bulkPropertyValues(doing, "YYYY-MM-DD").status).toBe("In progress");
    expect(commonBulkValues([doing, doing], "YYYY-MM-DD").status).toBe("In progress");
    expect(commonBulkValues(tasks, "YYYY-MM-DD").status).toBeUndefined();
    expect(bulkInlineText(commonBulkValues([doing], "YYYY-MM-DD"), "YYYY-MM-DD")).toBe("#[[t]] ~[[A]]");
  });
});
