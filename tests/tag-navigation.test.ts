import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Setting: class {} }));
import { taskTagSummaries } from "../src/task-tags";
import { taskMatchesQuery } from "../src/query";
import { scanTasks } from "../src/parser";
import { projectNotePath } from "../src/project-creator";

const tasks = scanTasks("Work.md", "- [ ] First #[[client notes]] #[[work]]\n- [x] Second #[[work]]\n- [ ] Third #[[home]]");
it("lists tags with distinct open and completed task counts", () => {
  expect(taskTagSummaries([...tasks, { ...tasks[0], tags: ["client notes", "client notes"] }])).toEqual([
    { name: "client notes", openTasks: 2, completedTasks: 0 },
    { name: "home", openTasks: 1, completedTasks: 0 },
    { name: "work", openTasks: 1, completedTasks: 1 }
  ]);
});
it("scopes tag pages exactly and retains completion and search filters", () => {
  const query = { mode: "tags" as const, tag: "work", showCompleted: false };
  expect(tasks.filter(task => taskMatchesQuery(task, query, "Inbox.md"))).toEqual([tasks[0]]);
  expect(tasks.filter(task => taskMatchesQuery(task, { ...query, showCompleted: true }, "Inbox.md"))).toEqual(tasks.slice(0, 2));
  expect(taskMatchesQuery(tasks[0], { ...query, tag: "client" }, "Inbox.md")).toBe(false);
  expect(taskMatchesQuery(tasks[0], { ...query, search: "nonmatching" }, "Inbox.md")).toBe(false);
});
it("normalizes project filenames and prevents paths or invalid names", () => {
  expect(projectNotePath(" New project.md ")).toBe("New project.md");
  for (const name of ["", "..", "../Work", "Folder/Work", "A\\B", "A#B", "[Project]"]) expect(() => projectNotePath(name)).toThrow();
});
