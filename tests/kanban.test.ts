import { describe, expect, it } from "vitest";
import { kanbanColumns } from "../src/kanban";
import { draftForGroup } from "../src/list-drag";
import { scanTasks } from "../src/parser";

const tasks = scanTasks("Work.md", "- [ ] Open task p2\n- [x] Done task p1\n- [ ] Scheduled [[2027-03-28]]\n");
describe("Kanban columns", () => {
  it("defaults to open and completed and retains empty drop targets", () => {
    expect(kanbanColumns([], "default").map(column => column.title)).toEqual(["Open", "Completed"]);
    const columns = kanbanColumns(tasks, "default");
    expect(columns.map(column => column.tasks.length)).toEqual([2, 1]);
    expect(draftForGroup(tasks[0], columns[1].target).completed).toBe(true);
    expect(draftForGroup(tasks[1], columns[0].target).completed).toBe(false);
  });
  it("keeps all priorities available even when empty", () => {
    const columns = kanbanColumns(tasks, "priority");
    expect(columns.map(column => column.title)).toEqual(["P1", "P2", "P3", "No priority"]);
    expect(draftForGroup(tasks[0], columns[2].target).priority).toBe(3);
    expect(draftForGroup(tasks[0], columns[3].target).priority).toBeUndefined();
  });
  it("uses the actual date value for column drops and preserves selected ordering", () => {
    const columns = kanbanColumns(tasks, "scheduledDate");
    expect(columns[0].tasks).toEqual(tasks.slice(0, 2));
    expect(draftForGroup(tasks[0], columns[1].target).scheduledDate).toBe("2027-03-28");
  });
  it("supports one ungrouped column and source-note destinations", () => {
    expect(kanbanColumns(tasks, "none")).toEqual([{ title: "Tasks", tasks }]);
    expect(kanbanColumns(tasks, "source")[0].target?.destination).toBe("Work.md");
  });
});
