import { describe, expect, it } from "vitest";
import { scanTasks } from "../src/parser";
import { draftForGroup, taskGroupTarget } from "../src/list-drag";
import { planBulkTasks } from "../src/bulk-tasks";
import { actionDate } from "../src/date";
import { TaskStore } from "../src/task-store";
import { TFile, type App } from "obsidian";

function setup(files: Record<string, string>, failSource = false) {
  const records = Object.fromEntries(Object.keys(files).map(path => [path, Object.assign(new TFile(), { path })]));
  const app = { vault: {
    getAbstractFileByPath: (path: string) => records[path],
    read: async (file: TFile) => files[file.path],
    process: async (file: TFile, update: (content: string) => string) => {
      if (failSource && file.path === "Source.md") throw new Error("Source write failed");
      files[file.path] = update(files[file.path]);
    }
  } } as unknown as App;
  return new TaskStore(app, () => "YYYY-MM-DD");
}
const content = "# Plan\n- [ ] Parent\n  - [ ] Child\n    Child notes\n- [ ] Other\n  - [ ] Other child\n";

describe("list task dragging", () => {
  it("reorders complete subtrees including indented notes", async () => {
    const files = { "Work.md": content };
    const tasks = scanTasks("Work.md", content);
    await setup(files).bulkDrop([tasks[0]], undefined, tasks[2], "after");
    expect(files["Work.md"]).toBe("# Plan\n- [ ] Other\n  - [ ] Other child\n- [ ] Parent\n  - [ ] Child\n    Child notes\n");
  });
  it("indents with children, then outdents without absorbing following siblings", async () => {
    const files = { "Work.md": content };
    const store = setup(files);
    let tasks = scanTasks("Work.md", files["Work.md"]);
    await store.bulkDrop([tasks[0]], undefined, tasks[2], "child");
    tasks = scanTasks("Work.md", files["Work.md"]);
    const parent = tasks.find(task => task.title === "Parent")!;
    // In line with Other's own subtask, so it is Other's child rather than Other child's.
    expect(parent.indent).toBe(2);
    expect(parent.parentId).toBe(tasks.find(task => task.title === "Other")!.id);
    expect(tasks.find(task => task.title === "Child")?.indent).toBe(4);
    await store.bulkDrop([parent], undefined, tasks[0], "after");
    expect(scanTasks("Work.md", files["Work.md"]).find(task => task.title === "Parent")?.parentId).toBeUndefined();
    expect(files["Work.md"]).toContain("- [ ] Other\n  - [ ] Other child\n- [ ] Parent\n  - [ ] Child\n    Child notes");
  });
  it("rejects cycles without modifying the note", async () => {
    const files = { "Work.md": content };
    const tasks = scanTasks("Work.md", content);
    await expect(setup(files).bulkDrop([tasks[0]], undefined, tasks[1], "child")).rejects.toThrow(/themselves or their subtasks/);
    expect(files["Work.md"]).toBe(content);
  });
  it("moves across notes and applies the target property", async () => {
    const files = { "Source.md": content, "Target.md": "# Next\n- [ ] Destination p1\n" };
    const source = scanTasks("Source.md", content)[0];
    const target = scanTasks("Target.md", files["Target.md"])[0];
    await setup(files).bulkDrop([source], taskGroupTarget("priority", target), target, "before");
    expect(files["Source.md"]).toBe("# Plan\n- [ ] Other\n  - [ ] Other child\n");
    expect(files["Target.md"]).toBe("# Next\n- [ ] Parent p1\n  - [ ] Child\n    Child notes\n- [ ] Destination p1\n");
  });
  it("rolls back a cross-note insertion if removing the source fails", async () => {
    const files = { "Source.md": content, "Target.md": "- [ ] Destination\n" };
    const original = { ...files };
    const source = scanTasks("Source.md", content)[0];
    const target = scanTasks("Target.md", files["Target.md"])[0];
    await expect(setup(files, true).bulkDrop([source], undefined, target, "child")).rejects.toThrow("Source write failed");
    expect(files).toEqual(original);
  });
  it("preserves CRLF and converts tab indentation consistently", () => {
    const text = "- [ ] A\r\n\t- [ ] Nested\r\n- [ ] B\r\n";
    const tasks = scanTasks("Work.md", text);
    const changed = planBulkTasks(new Map([["Work.md", text]]), [{ task: tasks[0], draft: draftForGroup(tasks[0]) }], { anchor: tasks[2], placement: "child" });
    expect(changed.get("Work.md")).toBe("- [ ] B\r\n    - [ ] A\r\n        - [ ] Nested\r\n");
  });
  it("nests a task at the indentation of the anchor's other subtasks", () => {
    const text = "- [ ] A\n  - [ ] A1\n- [ ] X\n";
    const tasks = scanTasks("Work.md", text);
    const changed = planBulkTasks(new Map([["Work.md", text]]), [{ task: tasks[2], draft: draftForGroup(tasks[2]) }], { anchor: tasks[0], placement: "child" });
    expect(changed.get("Work.md")).toBe("- [ ] A\n  - [ ] A1\n  - [ ] X\n");
    expect(scanTasks("Work.md", changed.get("Work.md")!)[2].parentId).toBe("Work.md:0");
  });
  it("recomputes moved block boundaries after new subtasks are added", async () => {
    const old = "- [ ] A\n- [ ] B\n";
    const tasks = scanTasks("Work.md", old);
    const files = { "Work.md": "- [ ] A\n  - [ ] New child\n- [ ] B\n" };
    await setup(files).bulkDrop([tasks[0]], undefined, tasks[1], "after");
    expect(files["Work.md"]).toBe("- [ ] B\n- [ ] A\n  - [ ] New child\n");
  });
});

describe("group property drops", () => {
  const task = scanTasks("Work.md", "- [ ] Task [[2026-09-05]] 09:00 {[[2026-09-06]]} 45m p2")[0];
  it("lands in the requested action-date group even when both dates are earlier", () => {
    const draft = draftForGroup(task, { property: "date", value: "2026-09-10" });
    expect(actionDate(draft)).toBe("2026-09-10");
    expect(draft.durationMinutes).toBe(45);
    expect(draft.priority).toBe(2);
  });
  it("changes scheduled date independently of deadline and clears related time when removed", () => {
    const draft = draftForGroup(task, { property: "scheduledDate", value: "2026-09-10" });
    expect(draft.deadline).toBe(task.deadline);
    expect(draft.scheduledDate).toBe("2026-09-10");
    expect(draftForGroup(task, { property: "scheduledDate" }).scheduledTime).toBeUndefined();
    expect(actionDate(draftForGroup(task, { property: "date" }))).toBeUndefined();
  });
  it("supports status, duration, missing priority, and destinations", () => {
    expect(draftForGroup(task, { property: "status", value: "Completed" }).completed).toBe(true);
    expect(draftForGroup(task, { property: "duration", value: 90 }).durationMinutes).toBe(90);
    expect(draftForGroup(task, { property: "priority" }).priority).toBeUndefined();
    expect(draftForGroup(task, { destination: "Other.md#Later" }).destination).toBe("Other.md#Later");
  });
});

it("treats notes and sections as places in notes, and property values as not", async () => {
  const { isStructuralGroup } = await import("../src/list-drag");
  expect(isStructuralGroup({ destination: "A.md#Plan" })).toBe(true);
  expect(isStructuralGroup({ property: "section", value: "Plan", destination: "A.md#Plan" })).toBe(true);
  expect(isStructuralGroup({ property: "source", value: "A.md", destination: "A.md" })).toBe(true);
  expect(isStructuralGroup({ property: "priority", value: 1 })).toBe(false);
  expect(isStructuralGroup({ property: "date", value: "2026-09-29" })).toBe(false);
});
