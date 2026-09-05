import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskStore } from "../src/task-store";
import { scanTasks } from "../src/parser";

function setup(content: string, position: "top" | "bottom" = "top") {
  const file = Object.assign(new TFile(), { path: "Project.md" });
  let text = content;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    read: async () => text,
    process: async (_file: TFile, update: (content: string) => string) => { text = update(text); }
  } } as unknown as App;
  return { store: new TaskStore(app, () => "YYYY-MM-DD", () => position), read: () => text };
}
const draft = { title: "New", completed: false, indent: 0, destination: "Project.md#Plan" };

describe("task destination writes", () => {
  it("creates at the beginning of a selected section", async () => {
    const { store, read } = setup("## Plan\n- [ ] Old\n");
    await store.create(draft);
    expect(read()).toBe("## Plan\n- [ ] New\n- [ ] Old\n");
  });

  it("moves a task and its children to another section in one note", async () => {
    const content = "## Plan\n- [ ] Existing\n## Later\n- [ ] Parent\n  - [ ] Child\n";
    const { store, read } = setup(content);
    const task = scanTasks("Project.md", content)[1];
    await store.update(task, draft);
    expect(read()).toBe("## Plan\n- [ ] New\n  - [ ] Child\n- [ ] Existing\n## Later\n");
  });

  it("preserves position when editing within the same section", async () => {
    const content = "## Plan\n- [ ] Old\n- [ ] Edit me\n";
    const { store, read } = setup(content);
    await store.update(scanTasks("Project.md", content)[1], draft);
    expect(read()).toBe("## Plan\n- [ ] Old\n- [ ] New\n");
  });

  it("leaves the original intact if the destination heading is missing", async () => {
    const content = "## Later\n- [ ] Original\n";
    const { store, read } = setup(content);
    await expect(store.update(scanTasks("Project.md", content)[0], draft)).rejects.toThrow(/Cannot find heading/);
    expect(read()).toBe(content);
  });
});


it("applies the bottom setting to both creation and destination moves", async () => {
  const content = "## Plan\nIntroduction\n- [ ] Old\n  - [ ] Child\n## Later\n- [ ] Move me\n  - [ ] Moved child\n";
  const { store, read } = setup(content, "bottom");
  await store.create(draft);
  expect(read()).toContain("  - [ ] Child\n- [ ] New\n## Later");
  const task = scanTasks("Project.md", read()).find((task) => task.title === "Move me")!;
  await store.update(task, { ...draft, title: "Moved" });
  expect(read()).toBe("## Plan\nIntroduction\n- [ ] Old\n  - [ ] Child\n- [ ] New\n- [ ] Moved\n  - [ ] Moved child\n## Later\n");
});

describe("task deletion", () => {
  it("deletes a task and its subtree while keeping other tasks and headings", async () => {
    const content = "## Plan\n- [ ] Parent\n  - [ ] Child\n    Child notes\n- [ ] Keep\n";
    const { store, read } = setup(content);
    await store.delete(scanTasks("Project.md", content)[0]);
    expect(read()).toBe("## Plan\n- [ ] Keep\n");
  });
  it("deletes only the selected child and preserves its parent and sibling", async () => {
    const content = "- [ ] Parent\n  - [ ] Remove\n  - [ ] Keep\n";
    const { store, read } = setup(content);
    await store.delete(scanTasks("Project.md", content)[1]);
    expect(read()).toBe("- [ ] Parent\n  - [ ] Keep\n");
  });
  it("refuses to delete a task whose text changed", async () => {
    const task = scanTasks("Project.md", "- [ ] Original\n")[0];
    const { store, read } = setup("- [ ] Edited\n");
    await expect(store.delete(task)).rejects.toThrow(/changed/);
    expect(read()).toBe("- [ ] Edited\n");
  });
});
