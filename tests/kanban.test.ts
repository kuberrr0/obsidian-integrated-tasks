import { describe, expect, it } from "vitest";
import { kanbanColumns } from "../src/kanban";
import { draftForGroup } from "../src/list-drag";
import { scanTasks } from "../src/parser";

const tasks = scanTasks("Work.md", "- [ ] Open task p2\n- [x] Done task p1\n- [ ] Scheduled [[2027-03-28]]\n");
describe("Kanban columns", () => {
  it("defaults to sections from note headings", () => {
    const sectionTasks = scanTasks("Work.md", "- [ ] Unsectioned\n# Planning\n- [ ] Plan\n- [x] Planned\n# Doing\n- [ ] Build\n");
    const columns = kanbanColumns(sectionTasks, "default");
    expect(columns.map(column => column.title)).toEqual(["No section", "Planning", "Doing"]);
    expect(columns.map(column => column.tasks.length)).toEqual([1, 2, 1]);
    expect(columns).toEqual(kanbanColumns(sectionTasks, "section"));
    expect(draftForGroup(sectionTasks[0], columns[1].target).destination).toBe("Work.md#Planning");
  });
  it("retains empty drop targets when grouped by status", () => {
    expect(kanbanColumns([], "status").map(column => column.title)).toEqual(["To do", "In progress", "Waiting", "Done", "Cancelled"]);
    const columns = kanbanColumns(tasks, "status");
    expect(columns.map(column => column.tasks.length)).toEqual([2, 0, 0, 1, 0]);
    expect(draftForGroup(tasks[0], columns[3].target)).toMatchObject({ status: "done", completed: true });
    expect(draftForGroup(tasks[1], columns[0].target)).toMatchObject({ status: "todo", completed: false });
    expect(draftForGroup(tasks[0], columns[1].target)).toMatchObject({ status: "doing", completed: false });
    expect(draftForGroup(tasks[0], columns[4].target)).toMatchObject({ status: "cancelled", completed: true });
  });
  it("shows every status in its own column, in table order", () => {
    const mixed = scanTasks("Work.md", "- [-] Dropped\n- [?] Blocked\n- [/] Doing\n- [X] Done\n- [ ] Next\n");
    expect(kanbanColumns(mixed, "status").map(column => column.tasks.map(task => task.title))).toEqual([["Next"], ["Doing"], ["Blocked"], ["Done"], ["Dropped"]]);
  });
  it("keeps all priorities available even when empty", () => {
    const columns = kanbanColumns(tasks, "priority");
    expect(columns.map(column => column.title)).toEqual(["P1", "P2", "P3", "No priority"]);
    expect(draftForGroup(tasks[0], columns[2].target).priority).toBe(3);
    expect(draftForGroup(tasks[0], columns[3].target).priority).toBeUndefined();
  });
  it("uses the actual date value for column drops and puts undated tasks last, in selected order", () => {
    const columns = kanbanColumns(tasks, "scheduledDate");
    expect(columns.map(column => column.title)).toEqual(["2027-03-28", "No scheduled date"]);
    expect(columns[1].tasks).toEqual(tasks.slice(0, 2));
    expect(draftForGroup(tasks[0], columns[0].target).scheduledDate).toBe("2027-03-28");
  });
  it("supports one ungrouped column and source-note destinations", () => {
    expect(kanbanColumns(tasks, "none")).toEqual([{ title: "Tasks", tasks }]);
    expect(kanbanColumns(tasks, "source")[0].target?.destination).toBe("Work.md");
  });
});
