import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { type App, TFile } from "obsidian";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), parseYaml: (text: string) => parse(text) }));
import { scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";
import type { Task } from "../src/types";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 27, 12)); });
afterEach(() => { vi.useRealTimers(); });

function setup(source: string, completionDates = false) {
  const habit = Object.assign(new TFile(), { path: "Habit.md" });
  const project = Object.assign(new TFile(), { path: "Project.md" });
  const texts = new Map([[habit.path, "---\ntags: recurring-task\nrepeat: every tuesday\n---\n"], [project.path, source]]);
  const files = new Map([[habit.path, habit], [project.path, project]]);
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (link: string) => link === "Habit" ? habit : null,
      getFileCache: (file: TFile) => file === habit ? { frontmatter: { tags: "recurring-task" } } : {}
    },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      read: async (file: TFile) => texts.get(file.path)!,
      process: async (file: TFile, update: (text: string) => string) => { texts.set(file.path, update(texts.get(file.path)!)); }
    },
    fileManager: { processFrontMatter: vi.fn() }
  } as unknown as App;
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => false, () => 1, () => completionDates);
  return { store, text: () => texts.get(project.path)!, log: () => texts.get(habit.path)!, tasks: (): Task[] => scanTasks(project.path, texts.get(project.path)!) };
}

describe("setting a task's status", () => {
  it("changes only the checkbox, as one undoable action per call", async () => {
    const { store, text, tasks } = setup("- [ ] Draft p1 ^d\n- [ ] Review\n");
    await store.setStatus([tasks()[0]], "doing");
    expect(text()).toBe("- [/] Draft p1 ^d\n- [ ] Review\n");
    expect(store.lastChange()?.label).toBe("Marked “Draft” as in progress");
    await store.setStatus(tasks(), "waiting");
    expect(text()).toBe("- [?] Draft p1 ^d\n- [?] Review\n");
    expect(store.lastChange()?.label).toBe("Marked 2 tasks as waiting");
    await store.setStatus(tasks(), "cancelled");
    expect(text()).toBe("- [-] Draft p1 ^d\n- [-] Review\n");
    await store.undo();
    expect(text()).toBe("- [?] Draft p1 ^d\n- [?] Review\n");
    await store.setStatus([tasks()[1]], "todo");
    expect(text()).toBe("- [?] Draft p1 ^d\n- [ ] Review\n");
  });

  it("completes a repeating task by advancing it, and cancels one by skipping the occurrence", async () => {
    const { store, text, log, tasks } = setup("- [/] [[Habit]] 2026-09-19\n- [?] Water plants 2026-09-20 every week\n");
    await store.setStatus([tasks()[0]], "done");
    expect(text()).toBe("- [ ] [[Habit]] 2026-09-22\n- [?] Water plants 2026-09-20 every week\n");
    expect(log()).toContain("COMPLETED: 2026-09-19\n");
    await store.setStatus([tasks()[0]], "cancelled");
    expect(text()).toBe("- [ ] [[Habit]] 2026-09-29\n- [?] Water plants 2026-09-20 every week\n");
    expect(log()).toContain("SKIPPED: 2026-09-22\n");
    await store.setStatus([tasks()[1]], "cancelled");
    expect(text()).toBe("- [ ] [[Habit]] 2026-09-29\n- [ ] Water plants 2026-09-27 every week\n");
    await store.undo();
    expect(text()).toBe("- [ ] [[Habit]] 2026-09-29\n- [?] Water plants 2026-09-20 every week\n");
  });

  it("resets an in-progress repeating task when it is checked off", async () => {
    const { store, text, tasks } = setup("- [/] [[Habit]] 2026-09-19\n- [?] Water plants 2026-09-20 every week\n");
    await store.toggle(tasks()[0], true);
    await store.toggle(tasks()[1], true);
    expect(text()).toBe("- [ ] [[Habit]] 2026-09-22\n- [ ] Water plants 2026-09-27 every week\n");
  });

  it("drops onto status columns, keeping a status other than open or closed", async () => {
    const { store, text, tasks } = setup("- [ ] A\n- [x] B\n");
    await store.bulkDrop([tasks()[0]], { property: "status", value: "In progress" });
    expect(text()).toBe("- [/] A\n- [x] B\n");
    expect(store.lastChange()?.label).toBe("Marked “A” as in progress");
    await store.bulkDrop([tasks()[1]], { property: "status", value: "Cancelled" });
    expect(text()).toBe("- [/] A\n- [-] B\n");
    await store.bulkDrop(tasks(), { property: "status", value: "Open" });
    expect(text()).toBe("- [/] A\n- [ ] B\n");
  });

  it("sets statuses from the bulk editor", async () => {
    const { store, text, tasks } = setup("- [ ] A\n- [x] B\n");
    await store.bulkUpdate(tasks(), { status: "waiting", priority: 2 });
    expect(text()).toBe("- [?] A p2\n- [?] B p2\n");
  });

  it("keeps an in-progress task in progress when an editor save doesn't check it", async () => {
    const { store, text, tasks } = setup("- [/] Draft\n");
    const [task] = tasks();
    await store.update(task, { ...task, priority: 1, destination: "Project.md" });
    expect(text()).toBe("- [/] Draft p1\n");
  });
});

describe("completion dates and statuses", () => {
  it("stamps only tasks that become done, and removes the date when a done task is cancelled", async () => {
    const { store, text, tasks } = setup("- [/] A\n- [ ] B\n", true);
    await store.setStatus([tasks()[0]], "done");
    await store.setStatus([tasks()[1]], "cancelled");
    expect(text()).toBe("- [x] A ✓2026-09-27\n- [-] B\n");
    await store.setStatus([tasks()[0]], "cancelled");
    expect(text()).toBe("- [-] A\n- [-] B\n");
    await store.setStatus([tasks()[1]], "done");
    expect(text()).toBe("- [-] A\n- [x] B ✓2026-09-27\n");
    await store.toggle(tasks()[0], false);
    expect(text()).toBe("- [ ] A\n- [x] B ✓2026-09-27\n");
  });
});
