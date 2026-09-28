import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { type App, TFile } from "obsidian";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), parseYaml: (text: string) => parse(text) }));
import { advanceInlineRepeat, isRepeatingTask } from "../src/recurring-task";
import { scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";
import type { Task } from "../src/types";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 27, 12)); });
afterEach(() => { vi.useRealTimers(); });

function setup(source: string, options: { completionDates?: boolean } = {}) {
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
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => false, () => 1, () => options.completionDates ?? false);
  return { app, store, texts, tasks: (): Task[] => scanTasks(project.path, texts.get(project.path)!) };
}

describe("advancing inline repeats", () => {
  it("moves the schedule to the next occurrence and the deadline by the same days, keeping times", () => {
    expect(advanceInlineRepeat({ repeat: "every week", scheduledDate: "2026-09-28", deadline: "2026-09-30" })).toEqual({ scheduledDate: "2026-10-05", deadline: "2026-10-07" });
    expect(advanceInlineRepeat({ repeat: "every monday" }, "2026-09-27")).toEqual({ scheduledDate: "2026-09-28", deadline: undefined });
    expect(advanceInlineRepeat({ repeat: "every month", scheduledDate: "2026-01-31", deadline: "2026-02-02" })).toEqual({ scheduledDate: "2026-02-28", deadline: "2026-03-02" });
    // Only a deadline: repeat from it, without adding a schedule.
    expect(advanceInlineRepeat({ repeat: "every month", deadline: "2026-10-01" })).toEqual({ scheduledDate: undefined, deadline: "2026-11-01" });
  });
});

describe("completing an inline repeat from the store", () => {
  it("advances the dates in place instead of checking it, and undoes as one action", async () => {
    const source = "- [ ] Water plants 2026-09-28 10:00 every week 15m {2026-09-30 18:00} ^w1\n";
    const { store, texts, tasks } = setup(source);
    await store.toggle(tasks()[0], true);
    expect(texts.get("Project.md")).toBe("- [ ] Water plants 2026-10-05 10:00 every week 15m {2026-10-07 18:00} ^w1\n");
    expect(texts.get("Habit.md")).not.toContain("COMPLETED");
    expect(store.lastChange()?.label).toBe("Completed “Water plants”");
    await store.undo();
    expect(texts.get("Project.md")).toBe(source);
  });

  it("schedules an unscheduled repeat from today", async () => {
    const { store, texts, tasks } = setup("- [ ] Stretch every day\n");
    await store.toggle(tasks()[0], true);
    expect(texts.get("Project.md")).toBe("- [ ] Stretch 2026-09-28 every day\n");
  });

  it("advances on Skip and Fail too, with no log", async () => {
    const { store, texts, tasks } = setup("- [ ] Review every 2 weeks 2026-09-20\n- [ ] Review 2026-09-20 every 2 weeks\n");
    await store.resolveRecurring(tasks()[1], "SKIPPED");
    expect(texts.get("Project.md")).toBe("- [ ] Review every 2 weeks 2026-09-20\n- [ ] Review 2026-10-04 every 2 weeks\n");
    await store.resolveRecurring(tasks()[1], "FAILED");
    expect(texts.get("Project.md")).toContain("- [ ] Review 2026-10-18 every 2 weeks\n");
    expect(texts.get("Habit.md")).not.toMatch(/SKIPPED|FAILED/);
  });

  it("advances on a status drop and a bulk completion, and checks ordinary tasks", async () => {
    const { store, texts, tasks } = setup("- [ ] Water 2026-09-28 every week\n- [ ] Plain\n");
    await store.bulkDrop(tasks(), { property: "status", value: "Completed" });
    expect(texts.get("Project.md")).toBe("- [ ] Water 2026-10-05 every week\n- [x] Plain\n");
    await store.bulkUpdate([tasks()[0]], { completed: true, priority: 1 });
    expect(texts.get("Project.md")).toBe("- [ ] Water 2026-10-12 every week p1\n- [x] Plain\n");
  });

  it("routes an editor save that completes the task the same way, keeping an explicit reschedule", async () => {
    const { store, texts, tasks } = setup("- [ ] Water 2026-09-28 every week {2026-09-29}\n");
    const [task] = tasks();
    await store.update(task, { ...task, completed: true, destination: "Project.md" });
    expect(texts.get("Project.md")).toBe("- [ ] Water 2026-10-05 every week {2026-10-06}\n");
    const [next] = tasks();
    await store.update(next, { ...next, completed: true, scheduledDate: "2026-11-01", destination: "Project.md" });
    expect(texts.get("Project.md")).toBe("- [ ] Water 2026-11-01 every week {2026-10-13}\n");
  });

  it("lets a routine note win over an inline repeat", async () => {
    const { app, store, texts, tasks } = setup("- [ ] [[Habit]] 2026-09-19 every day\n");
    expect(isRepeatingTask(app, tasks()[0])).toBe(true);
    await store.toggle(tasks()[0], true);
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22 every day\n");
    expect(texts.get("Habit.md")).toContain("COMPLETED: 2026-09-19\n");
  });

  it("identifies repeating tasks without throwing", () => {
    const { app } = setup("");
    const task = (line: string) => scanTasks("Project.md", line)[0];
    expect(isRepeatingTask(app, task("- [ ] Water every week"))).toBe(true);
    expect(isRepeatingTask(app, task("- [ ] [[Habit]] 2026-09-19"))).toBe(true);
    expect(isRepeatingTask(app, task("- [ ] Plain 2026-09-19"))).toBe(false);
  });

  it("never stamps a completion date on a repeat", async () => {
    const { store, texts, tasks } = setup("- [ ] Water 2026-09-28 every week\n", { completionDates: true });
    await store.toggle(tasks()[0], true);
    await store.bulkDrop(tasks(), { property: "status", value: "Completed" });
    expect(texts.get("Project.md")).toBe("- [ ] Water 2026-10-12 every week\n");
  });
});
