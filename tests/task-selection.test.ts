import { describe, expect, it } from "vitest";
import { TaskSelection } from "../src/task-selection";
import { scanTasks } from "../src/parser";
const tasks = scanTasks("Work.md", "- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D");
const ids = (selection: TaskSelection, visible = tasks) => selection.tasks(visible).map(task => task.title);

describe("task block selection", () => {
  it("replaces on click and adds on Mod-click without toggling selected tasks off", () => {
    const selection = new TaskSelection();
    selection.click(tasks[0], tasks);
    selection.click(tasks[2], tasks, false, true);
    selection.click(tasks[0], tasks, false, true);
    expect(ids(selection)).toEqual(["A", "C"]);
    selection.click(tasks[1], tasks);
    expect(ids(selection)).toEqual(["B"]);
  });
  it("selects forward and backward ranges from the last plain/Mod click", () => {
    const selection = new TaskSelection();
    selection.click(tasks[2], tasks);
    selection.click(tasks[0], tasks, true);
    expect(ids(selection)).toEqual(["A", "B", "C"]);
    selection.click(tasks[3], tasks, true);
    expect(ids(selection)).toEqual(["C", "D"]);
  });
  it("uses displayed order rather than note order and supports additive ranges", () => {
    const visible = [tasks[3], tasks[1], tasks[0], tasks[2]];
    const selection = new TaskSelection();
    selection.click(tasks[3], visible);
    selection.click(tasks[0], visible, false, true);
    selection.click(tasks[2], visible, true, true);
    expect(ids(selection, visible)).toEqual(["D", "A", "C"]);
  });
  it("drops hidden or changed tasks and cannot reuse a stale range anchor", () => {
    const selection = new TaskSelection();
    selection.click(tasks[0], tasks);
    selection.click(tasks[2], tasks, false, true);
    const visible = [tasks[0], { ...tasks[2], raw: "- [ ] Changed" }, tasks[3]];
    selection.retain(visible);
    expect(ids(selection, visible)).toEqual(["A"]);
    selection.retain([tasks[3]]);
    selection.click(tasks[3], [tasks[3]], true);
    expect(ids(selection)).toEqual(["D"]);
    selection.clear();
    expect(ids(selection)).toEqual([]);
  });
});
