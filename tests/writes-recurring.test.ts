import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { type App, TFile } from "obsidian";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), parseYaml: (text: string) => parse(text) }));
import { nextRepeatDate, recurringFile, repeatAnchor } from "../src/recurring-task";
import { scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";
import type { Task } from "../src/types";

function setup(source: string, repeat = "every tuesday", anchor?: string) {
  const habit = Object.assign(new TFile(), { path: "Habit.md" });
  const project = Object.assign(new TFile(), { path: "Project.md" });
  const definition = `---\ntags: recurring-task\nrepeat: ${repeat}\n${anchor ? `repeat-anchor: ${anchor}\n` : ""}---\n`;
  const texts = new Map([[habit.path, definition], [project.path, source]]);
  const files = new Map([[habit.path, habit], [project.path, project]]);
  const processFrontMatter = vi.fn(async (file: TFile, update: (frontmatter: Record<string, unknown>) => void) => {
    const text = texts.get(file.path)!;
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text)!;
    const frontmatter = parse(match[1]) as Record<string, unknown>;
    update(frontmatter);
    texts.set(file.path, `---\n${stringify(frontmatter)}---\n${text.slice(match[0].length)}`);
  });
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
    fileManager: { processFrontMatter }
  } as unknown as App;
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => false);
  return { store, texts, processFrontMatter, tasks: (): Task[] => scanTasks(project.path, texts.get(project.path)!) };
}

describe("completing recurring tasks through bulk paths", () => {
  it("advances and logs on a Kanban status drop instead of checking the box", async () => {
    const { store, texts, tasks } = setup("- [ ] [[Habit]] 2026-09-19\n- [ ] Plain\n");
    const resolve = vi.spyOn(store, "resolveRecurring");
    const paths = await store.bulkDrop(tasks(), { property: "status", value: "Completed" });
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22\n- [x] Plain\n");
    expect(texts.get("Habit.md")).toContain("COMPLETED: 2026-09-19\n");
    expect(paths.sort()).toEqual(["Habit.md", "Project.md"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("applies the other bulk edits while completing", async () => {
    const { store, texts, tasks } = setup("- [ ] [[Habit]] 2026-09-19 ^h1\n");
    await store.bulkUpdate(tasks(), { completed: true, priority: 1 });
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22 p1 ^h1\n");
    expect(texts.get("Habit.md")).toContain("COMPLETED: 2026-09-19\n");
  });

  it("routes an editor save that completes the task the same way", async () => {
    const { store, texts, tasks } = setup("- [ ] [[Habit]] 2026-09-19\n");
    const [task] = tasks();
    await store.update(task, { ...task, completed: true, destination: "Project.md" });
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22\n");
    expect(texts.get("Habit.md")).toContain("COMPLETED: 2026-09-19\n");
  });

  it("refuses a recurring task without a scheduled date before writing anything", async () => {
    const { store, texts, tasks } = setup("- [ ] [[Habit]]\n- [ ] Plain\n");
    const before = new Map(texts);
    await expect(store.bulkDrop(tasks(), { property: "status", value: "Completed" })).rejects.toThrow(/scheduled date/);
    expect(texts).toEqual(before);
  });
});

describe("month and year anchors", () => {
  const run = (rule: string, start: string, steps: number): string[] => {
    let date = start;
    let stored: string | undefined;
    const dates: string[] = [];
    for (let step = 0; step < steps; step++) {
      stored = repeatAnchor([rule], date, stored);
      date = nextRepeatDate([rule], date, stored);
      dates.push(date);
    }
    return dates;
  };

  it("keeps the 31st across six months", () => {
    expect(run("every month", "2026-01-31", 6)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"]);
  });

  it("returns to Feb 29 in leap years", () => {
    expect(run("every year", "2028-02-29", 8)).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29", "2033-02-28", "2034-02-28", "2035-02-28", "2036-02-29"]);
  });

  it("resets the anchor after a manual reschedule", () => {
    expect(repeatAnchor(["every month"], "2026-03-15", "2026-01-31")).toBe("2026-03-15");
    expect(nextRepeatDate(["every month"], "2026-03-15", "2026-01-31")).toBe("2026-04-15");
    expect(repeatAnchor(["every year"], "2029-03-01", "2028-02-29")).toBe("2029-03-01");
    expect(repeatAnchor(["every week"], "2026-03-15", "2026-01-31")).toBeUndefined();
    expect(nextRepeatDate(["every other month"], "2026-02-28", "2026-01-31")).toBe("2026-04-30");
  });

  it("persists the anchor in frontmatter and uses it on the next completion", async () => {
    const { store, texts, tasks, processFrontMatter } = setup("- [ ] [[Habit]] 2026-01-31\n", "every month");
    await store.toggle(tasks()[0], true);
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-02-28\n");
    expect(texts.get("Habit.md")).toContain("repeat-anchor: 2026-01-31");
    await store.bulkDrop(tasks(), { property: "status", value: "Completed" });
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-03-31\n");
    expect(processFrontMatter).toHaveBeenCalledOnce();
    expect(texts.get("Habit.md")).toMatch(/COMPLETED: 2026-01-31\nCOMPLETED: 2026-02-28\n$/);
  });

  it("replaces a stale anchor after a manual reschedule", async () => {
    const { store, texts, tasks } = setup("- [ ] [[Habit]] 2026-03-15\n", "every month", "2026-01-31");
    await store.resolveRecurring(tasks()[0], "SKIPPED");
    expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-04-15\n");
    expect(texts.get("Habit.md")).toContain("repeat-anchor: 2026-03-15");
  });
});

describe("no regex lookbehind", () => {
  const owned = ["task-store", "bulk-tasks", "task-block", "markdown", "parser", "structure", "list-drag", "recurring-task",
    "recurring-log", "task-description", "task-date-update", "calendar"];
  it.each(owned)("src/%s.ts has none", name => {
    expect(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8")).not.toMatch(/\(\?<[!=]/);
  });

  it("still ignores embeds and finds adjacent links", () => {
    const { store } = setup("");
    const app = (store as unknown as { app: App }).app;
    const task = (title: string) => ({ title, path: "Project.md" }) as Task;
    expect(recurringFile(app, task("See ![[Habit]]"))).toBeUndefined();
    expect(recurringFile(app, task("![[Habit]]"))).toBeUndefined();
    expect(recurringFile(app, task("[[Habit]]"))?.path).toBe("Habit.md");
    expect(recurringFile(app, task("[[Other]][[Habit]]"))?.path).toBe("Habit.md");
    expect(recurringFile(app, task("`[[Habit]]` code"))).toBeUndefined();
  });
});
