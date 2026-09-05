import { describe, expect, it } from "vitest";
import { scanTasks } from "../src/parser";
import { draftForGroup, taskGroupTarget } from "../src/list-drag";
import { liveTaskBlock, placeTaskBlock, rewriteBlock } from "../src/task-block";
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
const content = "## Plan\n- [ ] Parent\n  - [ ] Child\n    Child notes\n- [ ] Other\n  - [ ] Other child\n";

describe("list task dragging", () => {
  it("reorders complete subtrees including indented notes", async () => {
    const files = { "Work.md": content };
    const tasks = scanTasks("Work.md", content);
    await setup(files).relocate(tasks[0], tasks[2], "after", draftForGroup(tasks[0]));
    expect(files["Work.md"]).toBe("## Plan\n- [ ] Other\n  - [ ] Other child\n- [ ] Parent\n  - [ ] Child\n    Child notes\n");
  });
  it("indents with children, then outdents without absorbing following siblings", async () => {
    const files = { "Work.md": content };
    const store = setup(files);
    let tasks = scanTasks("Work.md", files["Work.md"]);
    await store.relocate(tasks[0], tasks[2], "child", draftForGroup(tasks[0]));
    tasks = scanTasks("Work.md", files["Work.md"]);
    const parent = tasks.find(task => task.title === "Parent")!;
    expect(parent.indent).toBe(2);
    expect(tasks.find(task => task.title === "Child")?.indent).toBe(4);
    await store.relocate(parent, tasks[0], "after", draftForGroup(parent));
    expect(scanTasks("Work.md", files["Work.md"]).find(task => task.title === "Parent")?.parentId).toBeUndefined();
    expect(files["Work.md"]).toContain("- [ ] Other\n  - [ ] Other child\n- [ ] Parent\n  - [ ] Child\n    Child notes");
  });
  it("rejects cycles without modifying the note", async () => {
    const files = { "Work.md": content };
    const tasks = scanTasks("Work.md", content);
    await expect(setup(files).relocate(tasks[0], tasks[1], "child", draftForGroup(tasks[0]))).rejects.toThrow(/itself or its subtasks/);
    expect(files["Work.md"]).toBe(content);
  });
  it("moves across notes and applies the target property", async () => {
    const files = { "Source.md": content, "Target.md": "## Next\n- [ ] Destination p1\n" };
    const source = scanTasks("Source.md", content)[0];
    const target = scanTasks("Target.md", files["Target.md"])[0];
    await setup(files).relocate(source, target, "before", draftForGroup(source, taskGroupTarget("priority", target)));
    expect(files["Source.md"]).toBe("## Plan\n- [ ] Other\n  - [ ] Other child\n");
    expect(files["Target.md"]).toBe("## Next\n- [ ] Parent p1\n  - [ ] Child\n    Child notes\n- [ ] Destination p1\n");
  });
  it("rolls back a cross-note insertion if removing the source fails", async () => {
    const files = { "Source.md": content, "Target.md": "- [ ] Destination\n" };
    const original = { ...files };
    const source = scanTasks("Source.md", content)[0];
    const target = scanTasks("Target.md", files["Target.md"])[0];
    await expect(setup(files, true).relocate(source, target, "child", draftForGroup(source))).rejects.toThrow("Source write failed");
    expect(files).toEqual(original);
  });
  it("preserves CRLF and converts tab indentation consistently", () => {
    const text = "- [ ] A\r\n\t- [ ] Nested\r\n- [ ] B\r\n";
    const tasks = scanTasks("Work.md", text);
    const block = liveTaskBlock(text, tasks[0]);
    const changed = placeTaskBlock(text, tasks[0], tasks[2], "child", rewriteBlock(block, draftForGroup(tasks[0]), 2));
    expect(changed).toBe("- [ ] B\r\n  - [ ] A\r\n      - [ ] Nested\r\n");
  });
  it("recomputes moved block boundaries after new subtasks are added", async () => {
    const old = "- [ ] A\n- [ ] B\n";
    const tasks = scanTasks("Work.md", old);
    const files = { "Work.md": "- [ ] A\n  - [ ] New child\n- [ ] B\n" };
    await setup(files).relocate(tasks[0], tasks[1], "after", draftForGroup(tasks[0]));
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
