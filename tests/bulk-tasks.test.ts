import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskStore } from "../src/task-store";
import { scanTasks } from "../src/parser";
import { draftForGroup } from "../src/list-drag";
import { planBulkTasks } from "../src/bulk-tasks";

function setup(files: Record<string, string>, fail?: (path: string, count: number) => void) {
  const records = Object.fromEntries(Object.keys(files).map(path => [path, Object.assign(new TFile(), { path })]));
  let count = 0;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => records[path],
    read: async (file: TFile) => files[file.path],
    process: async (file: TFile, change: (text: string) => string) => {
      fail?.(file.path, ++count);
      files[file.path] = change(files[file.path]);
    }
  } } as unknown as App;
  return new TaskStore(app, () => "YYYY-MM-DD");
}
const content = "## Plan\n- [ ] Parent [[2026-09-07]] 09:00 1h p1\n  - Parent notes\n  - [ ] Child 30m p2\n    - Child notes\n  - [ ] Unselected 45m p3\n- [ ] Other 15m\n- [ ] Last\n## Later\n";
const originalTasks = () => scanTasks("Work.md", content);

describe("bulk properties and deletion", () => {
  it("updates only selected properties on every explicit selection, including selected children", async () => {
    const files = { "Work.md": content };
    const tasks = originalTasks();
    await setup(files).bulkUpdate([tasks[0], tasks[1]], { priority: 3, durationMinutes: undefined });
    const changed = scanTasks("Work.md", files["Work.md"]);
    expect(changed[0]).toMatchObject({ priority: 3, scheduledDate: "2026-09-07", scheduledTime: "09:00", description: "- Parent notes" });
    expect(changed[1]).toMatchObject({ priority: 3, description: "- Child notes" });
    expect(changed[0].durationMinutes).toBeUndefined();
    expect(changed[1].durationMinutes).toBeUndefined();
    expect(changed[2].raw).toBe(tasks[2].raw);
    expect(changed[3].raw).toBe(tasks[3].raw);
  });
  it("does not rewrite any notes when no properties changed", async () => {
    const files = { "Work.md": content };
    await setup(files, () => { throw new Error("Should not write"); }).bulkUpdate(originalTasks(), {});
    expect(files["Work.md"]).toBe(content);
  });
  it("deletes overlapping parent/child selections exactly once and keeps other blocks", async () => {
    const files = { "Work.md": content };
    const tasks = originalTasks();
    await setup(files).bulkDelete([tasks[1], tasks[0], tasks[3]]);
    expect(files["Work.md"]).toBe("## Plan\n- [ ] Last\n## Later\n");
  });
  it("moves selected parents and children together, applying properties to both", async () => {
    const files = { "Work.md": content, "Target.md": "## Next\n- [ ] Existing\n" };
    const tasks = originalTasks();
    await setup(files).bulkUpdate([tasks[0], tasks[1], tasks[3]], { destination: "Target.md#Next", priority: 2 });
    const moved = scanTasks("Target.md", files["Target.md"]);
    expect(moved.map(task => task.title)).toEqual(["Parent", "Child", "Unselected", "Other", "Existing"]);
    expect(moved[1].parentId).toBe(moved[0].id);
    expect(moved[0].priority).toBe(2);
    expect(moved[1].priority).toBe(2);
    expect(moved[2].priority).toBe(3);
    expect(moved[3].priority).toBe(2);
    expect(files["Work.md"]).toBe("## Plan\n- [ ] Last\n## Later\n");
  });
  it("validates all selected tasks and destination headings before writing", async () => {
    const files = { "Work.md": content, "Target.md": "- [ ] Existing\n" };
    const original = { ...files };
    await expect(setup(files).bulkUpdate(originalTasks(), { destination: "Target.md#Missing" })).rejects.toThrow(/Cannot find heading/);
    expect(files).toEqual(original);
    const selected = originalTasks();
    selected[1] = { ...selected[1], raw: "- [ ] Stale" };
    await expect(setup(files).bulkDelete(selected)).rejects.toThrow(/changed/);
    expect(files).toEqual(original);
  });
});

describe("bulk dragging", () => {
  it.each(["before", "after", "child"] as const)("moves nonadjacent blocks %s an anchor in their selected order", async placement => {
    const text = "- [ ] A\n  - Detail\n- [ ] B\n- [ ] C\n- [ ] D\n";
    const files = { "Work.md": text };
    const [a, b, c] = scanTasks("Work.md", text);
    await setup(files).bulkDrop([c, a], undefined, b, placement);
    const moved = scanTasks("Work.md", files["Work.md"]);
    expect(moved.map(task => task.title)).toEqual(placement === "before" ? ["C", "A", "B", "D"] : ["B", "C", "A", "D"]);
    expect(moved.find(task => task.title === "A")!.description).toBe("- Detail");
    if (placement === "child") for (const title of ["C", "A"]) expect(moved.find(task => task.title === title)!.parentId).toBe(moved[0].id);
  });
  it("supports a selected parent subtree, cross-file sources and target group properties", async () => {
    const files = { "Work.md": content, "Second.md": "- [ ] External\n", "Target.md": "- [ ] Anchor\n" };
    const parent = originalTasks()[0];
    const external = scanTasks("Second.md", files["Second.md"])[0];
    const anchor = scanTasks("Target.md", files["Target.md"])[0];
    await setup(files).bulkDrop([external, parent, originalTasks()[1]], { property: "priority", value: 2 }, anchor, "child");
    const tasks = scanTasks("Target.md", files["Target.md"]);
    expect(tasks.map(task => task.title)).toEqual(["Anchor", "External", "Parent", "Child", "Unselected"]);
    expect(tasks[2].indent).toBe(2);
    expect(tasks[3].indent).toBe(4);
    expect(tasks[1].priority).toBe(2);
    expect(tasks[3].priority).toBe(2);
    expect(tasks[4].priority).toBe(3);
    expect(files["Second.md"]).toBe("");
  });
  it("applies Kanban status drops to every selected task without moving other tasks", async () => {
    const files = { "Work.md": content };
    const tasks = originalTasks();
    await setup(files).bulkDrop([tasks[0], tasks[1], tasks[3]], { property: "status", value: "Completed" });
    expect(scanTasks("Work.md", files["Work.md"]).map(task => task.completed)).toEqual([true, true, false, true, false]);
  });
  it("rejects dropping into any selected task or its descendants without writing", async () => {
    const files = { "Work.md": content };
    const tasks = originalTasks();
    await expect(setup(files).bulkDrop([tasks[3], tasks[0]], undefined, tasks[1], "child")).rejects.toThrow(/themselves or their subtasks/);
    expect(files["Work.md"]).toBe(content);
  });
  it("preserves CRLF, tabs, blank lines and description text", () => {
    const text = "- [ ] A\r\n\t- Detail\r\n\r\n\t- [ ] Child\r\n- [ ] B\r\n- [ ] C\r\n";
    const tasks = scanTasks("Work.md", text);
    const result = planBulkTasks(new Map([["Work.md", text]]), [tasks[0], tasks[3]].map(task => ({ task, draft: draftForGroup(task) })), { anchor: tasks[2], placement: "after" });
    expect(result.get("Work.md")).toBe("- [ ] B\r\n- [ ] A\r\n    - Detail\r\n\r\n    - [ ] Child\r\n- [ ] C\r\n");
  });
});

describe("bulk write recovery", () => {
  it("restores earlier note writes if a later write fails", async () => {
    const files = { "Work.md": content, "Second.md": "- [ ] Another\n" };
    const original = { ...files };
    const selected = [originalTasks()[0], scanTasks("Second.md", files["Second.md"])[0]];
    await expect(setup(files, (_path, count) => { if (count === 2) throw new Error("Write failed"); }).bulkDelete(selected)).rejects.toThrow("Write failed");
    expect(files).toEqual(original);
  });
  it("does not overwrite an external edit during rollback and reports the affected file", async () => {
    const files = { "Work.md": content, "Second.md": "- [ ] Another\n" };
    const selected = [originalTasks()[0], scanTasks("Second.md", files["Second.md"])[0]];
    await expect(setup(files, (_path, count) => {
      if (count === 2) { files["Work.md"] = "External edit"; throw new Error("Write failed"); }
    }).bulkDelete(selected)).rejects.toThrow(/Could not restore changed notes: Work.md/);
    expect(files["Work.md"]).toBe("External edit");
    expect(files["Second.md"]).toBe("- [ ] Another\n");
  });
  it("refuses a source changed since planning", async () => {
    const files = { "Work.md": content };
    await expect(setup(files, () => { files["Work.md"] = "External edit"; }).bulkDelete(originalTasks())).rejects.toThrow(/note changed during the bulk action/);
    expect(files["Work.md"]).toBe("External edit");
  });
});
