import { expect, it } from "vitest";
import { type App, TFile } from "obsidian";
import { updateRecurringLogDates } from "../src/recurring-log";
import { TaskStore } from "../src/task-store";

it("migrates both outcomes and mixed formats while preserving whitespace and protected text", () => {
    const source = "---\nCOMPLETED: 2026-09-19\n---\nCOMPLETED: 2026-09-19  \r\nCANCELED: [[20.09.2026]]\r\nCANCELED: 21.09.2026\r\nSKIPPED: 22.09.2026\r\n```\nCANCELED: 2026-09-19\n```\nProse 2026-09-19\nCANCELED: 2026-02-30\n";
    const result = updateRecurringLogDates(source, ["DD.MM.YYYY"], "MMM D, YYYY", true);
    expect(result).toContain("COMPLETED: [[Sep 19, 2026]]  \r\nCANCELED: [[Sep 20, 2026]]\r\nCANCELED: [[Sep 21, 2026]]");
    // SKIPPED is not a log entry, so its date is left alone.
    expect(result).toContain("SKIPPED: 22.09.2026");
    expect(result).toContain("---\nCOMPLETED: 2026-09-19\n---");
    expect(result).toContain("```\nCANCELED: 2026-09-19\n```");
    expect(result).toContain("CANCELED: 2026-02-30");
    expect(updateRecurringLogDates(result, ["MMM D, YYYY"], "MMM D, YYYY", true)).toBe(result);
    expect(updateRecurringLogDates(result, ["MMM D, YYYY"], "DD/MM/YYYY", false)).toContain("CANCELED: 20/09/2026");
});

it("settings migration updates history only in tagged recurring notes", async () => {
    const files = ["Habit.md", "Other.md"].map(path => Object.assign(new TFile(), { path }));
    const texts = new Map(files.map(file => [file.path, "COMPLETED: 2026-09-19\n- [ ] Task 2026-09-20\n"]));
    const app = { metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: { tags: file.path === "Habit.md" ? "recurring-task" : "other" } }) }, vault: {
        getMarkdownFiles: () => files, read: async (file: TFile) => texts.get(file.path)!,
        process: async (file: TFile, fn: (text: string) => string) => texts.set(file.path, fn(texts.get(file.path)!))
    } } as unknown as App;
    const store = new TaskStore(app, () => "DD.MM.YYYY", () => "top", () => true);
    await store.updateDates(["YYYY-MM-DD"]);
    expect(texts.get("Habit.md")).toBe("COMPLETED: [[19.09.2026]]\n- [ ] Task [[20.09.2026]]\n");
    expect(texts.get("Other.md")).toBe("COMPLETED: 2026-09-19\n- [ ] Task [[20.09.2026]]\n");
});
