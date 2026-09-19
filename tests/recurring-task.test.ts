import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { type App, TFile } from "obsidian";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), parseYaml: (text: string) => parse(text) }));
import { advanceRecurringTask, nextRepeatDate, repeatRules } from "../src/recurring-task";
import { scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";

it.each([
    [["every saturday", "every tuesday"], "2026-09-19", "2026-09-22"],
    [["every monday"], "2026-09-19", "2026-09-21"],
    [["every week"], "2026-09-19", "2026-09-26"],
    [["every other week"], "2026-09-19", "2026-10-03"],
    [["every third monday"], "2026-09-21", "2026-10-12"],
    [["every month"], "2026-01-31", "2026-02-28"],
    [["every year"], "2024-02-29", "2025-02-28"],
    [["every day"], "2026-12-31", "2027-01-01"]
])("resolves %s after %s", (rules, date, expected) => {
    expect(nextRepeatDate(rules as string[], date as string)).toBe(expected);
});

it.each([
    [["saturday", "tuesday"], "2026-09-19", "2026-09-22"],
    [["monday"], "2026-09-21", "2026-09-28"],
    [["2 days"], "2026-09-19", "2026-09-21"],
    [["5 days"], "2026-09-19", "2026-09-24"],
    [["week"], "2026-09-19", "2026-09-26"],
    [["month"], "2026-01-31", "2026-02-28"],
    [["year"], "2024-02-29", "2025-02-28"],
    [["other week"], "2026-09-19", "2026-10-03"],
    [["third monday"], "2026-09-21", "2026-10-12"],
    [["  2   DAYS  "], "2026-12-31", "2027-01-02"],
    [["5 days", "every tuesday"], "2026-09-19", "2026-09-22"]
])("accepts shorthand %s", (rules, date, expected) => {
    expect(nextRepeatDate(rules as string[], date as string)).toBe(expected);
});

it.each(["0 days", "-2 days", "2.5 days", "every", "weeks later"])("rejects invalid shorthand %s", rule => {
    expect(() => nextRepeatDate([rule], "2026-09-19")).toThrow();
});

it("rejects invalid rules rather than silently ignoring them", () => {
    expect(() => nextRepeatDate(["every tuesday", "sometimes"], "2026-09-19")).toThrow("Unsupported");
    expect(() => nextRepeatDate(["every 0 days"], "2026-09-19")).toThrow("Invalid");
    expect(() => repeatRules("---\nrepeat: []\n---\n")).toThrow();
    expect(repeatRules("---\nrepeat: every week\n---\n")).toEqual(["every week"]);
});

it.each(["2026-09-19", "[[2026-09-19]]", "19/09/2026", "[[19/09/2026]]"])("preserves everything except the date: %s", date => {
    const content = `# Plan\r\n    - [ ] [[Habit|Alias]]  ${date} 09:30  30m {2026-09-30} p1 #[[work]]\r\n        - Description\r\n        - [ ] Child\r\n`;
    const task = scanTasks("Project.md", content, new Date(), "DD/MM/YYYY")[0];
    const replacement = date.replace("2026-09-19", "2026-09-22").replace("19/09/2026", "22/09/2026");
    expect(advanceRecurringTask(content, task, "2026-09-22", "DD/MM/YYYY")).toBe(content.replace(date, replacement));
});

function setup(source = "- [ ] [[Habit]] 2026-09-19\n", sameFile = false, dateFormat = "YYYY-MM-DD", linkDates = false) {
    const habit = Object.assign(new TFile(), { path: "Habit.md" });
    const project = sameFile ? habit : Object.assign(new TFile(), { path: "Project.md" });
    const definition = "---\ntags: recurring-task\nrepeat:\n  - every saturday\n  - every tuesday\n---\n\nCOMPLETED: 2026-09-15\n";
    const texts = new Map([[habit.path, definition], [project.path, sameFile ? definition + source : source]]);
    const files = new Map([[habit.path, habit], [project.path, project]]);
    const process = vi.fn(async (file: TFile, update: (text: string) => string) => { texts.set(file.path, update(texts.get(file.path)!)); });
    const app = { metadataCache: {
        getFirstLinkpathDest: (link: string) => link === "Habit" ? habit : null,
        getFileCache: () => ({ frontmatter: { tags: "recurring-task" } })
    }, vault: { getAbstractFileByPath: (path: string) => files.get(path), read: async (file: TFile) => texts.get(file.path)!, process } } as unknown as App;
    return { store: new TaskStore(app, () => dateFormat, () => "top", () => linkDates), texts, process, task: scanTasks(project.path, texts.get(project.path)!)[0], project, habit };
}

describe("recurring task transactions", () => {
    it.each(["COMPLETED", "SKIPPED", "FAILED"] as const)("logs %s and keeps the next instance unchecked", async outcome => {
        const { store, task, texts } = setup();
        await store.resolveRecurring(task, outcome);
        expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22\n");
        expect(texts.get("Habit.md")).toContain(`COMPLETED: 2026-09-15\n${outcome}: 2026-09-19\n`);
    });
    it("handles the checklist and definition in the same file", async () => {
        const { store, task, texts } = setup(undefined, true);
        await store.resolveRecurring(task, "SKIPPED");
        expect(texts.get("Habit.md")).toContain("- [ ] [[Habit]] 2026-09-22\nSKIPPED: 2026-09-19\n");
    });
    it("treats checking the task in a task view as completion", async () => {
        const { store, task, texts } = setup();
        await store.toggle(task, true);
        expect(texts.get("Habit.md")).toContain("COMPLETED: 2026-09-19");
        expect(texts.get("Project.md")).toContain("[ ] [[Habit]] 2026-09-22");
    });
    it("rolls back the log if the checklist write fails", async () => {
        const { store, task, texts, process } = setup();
        const before = new Map(texts);
        process.mockImplementationOnce(async (file, update) => { texts.set(file.path, update(texts.get(file.path)!)); })
            .mockImplementationOnce(async () => { throw new Error("write failed"); });
        await expect(store.resolveRecurring(task, "FAILED")).rejects.toThrow("write failed");
        expect(texts).toEqual(before);
    });
    it("refuses stale tasks and repeated actions without logging", async () => {
        const { store, task, texts } = setup();
        await store.resolveRecurring(task, "COMPLETED");
        const before = new Map(texts);
        await expect(store.resolveRecurring(task, "COMPLETED")).rejects.toThrow("changed");
        expect(texts).toEqual(before);
    });
});


it.each(["COMPLETED", "SKIPPED", "FAILED"] as const)("writes %s using the configured format and link setting", async outcome => {
    for (const linked of [false, true]) {
        const { store, task, texts } = setup(undefined, false, "MMM D, YYYY", linked);
        await store.resolveRecurring(task, outcome);
        expect(texts.get("Habit.md")).toContain(`${outcome}: ${linked ? "[[Sep 19, 2026]]" : "Sep 19, 2026"}\n`);
        expect(texts.get("Project.md")).toBe("- [ ] [[Habit]] 2026-09-22\n");
    }
});
