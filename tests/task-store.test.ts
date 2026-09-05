import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskStore } from "../src/task-store";
import { scanTasks } from "../src/parser";

function setup(content: string) {
  const file = Object.assign(new TFile(), { path: "Project.md" });
  let text = content;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    read: async () => text,
    process: async (_file: TFile, update: (content: string) => string) => { text = update(text); }
  } } as unknown as App;
  return { store: new TaskStore(app, () => "YYYY-MM-DD"), read: () => text };
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
