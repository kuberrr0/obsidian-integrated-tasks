import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskStore, withTaskTag } from "../src/task-store";
import { parseTaskTreeInput } from "../src/task-input";
import { scanTasks } from "../src/parser";
import { setTagFormat } from "../src/task-tags";

function setup(content: string, taskTag = "task") {
  const file = Object.assign(new TFile(), { path: "Project.md" });
  let text = content;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    read: async () => text,
    process: async (_file: TFile, update: (content: string) => string) => { text = update(text); }
  } } as unknown as App;
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "bottom", () => false, () => 1, () => false, () => ({ placement: "keep", section: "" }), () => taskTag);
  return { store, read: () => text };
}

beforeEach(() => setTagFormat("hash"));
afterEach(() => setTagFormat("wikilink"));

describe("the task tag on new tasks", () => {
  it("is added to a new task, once", async () => {
    const { store, read } = setup("");
    await store.create({ title: "Buy milk", completed: false, indent: 0, destination: "Project.md", tags: ["errand"] });
    await store.create({ title: "Call", completed: false, indent: 0, destination: "Project.md", tags: ["Task/Phone"] });
    expect(read()).toBe("- [ ] Buy milk #errand #task\n- [ ] Call #Task/Phone\n");
  });

  it("is added to each task in a batch, but not to its notes", async () => {
    const { store, read } = setup("");
    await store.create(parseTaskTreeInput("Trip\n  - [ ] Pack\n  - a note\n  - [ ] Book #task", "Project.md", new Date(), "YYYY-MM-DD", false));
    expect(read()).toBe("- [ ] Trip #task\n  - [ ] Pack #task\n  - a note\n  - [ ] Book #task\n");
  });

  it("is added to new subtasks, in the tag format", async () => {
    setTagFormat("wikilink");
    const { store, read } = setup("- [ ] Parent #[[task]]\n");
    await store.addSubtask(scanTasks("Project.md", read())[0], { title: "Child" });
    expect(read()).toBe("- [ ] Parent #[[task]]\n    - [ ] Child #[[task]]\n");
  });

  it("is not added without a task tag", async () => {
    const { store, read } = setup("", "");
    await store.create({ title: "Plain", completed: false, indent: 0, destination: "Project.md" });
    expect(read()).toBe("- [ ] Plain\n");
    const draft = { title: "Same", additionalLines: ["  - [ ] Sub"] };
    expect(withTaskTag(draft, "")).toBe(draft);
  });
});
