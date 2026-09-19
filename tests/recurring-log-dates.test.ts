import { expect, it } from "vitest";
import { type App, TFile } from "obsidian";
import { updateRecurringLogDates } from "../src/recurring-log";
import { recurringLogTokens } from "../src/task-tokens";
import { TaskStore } from "../src/task-store";

it("migrates all outcomes and mixed formats while preserving whitespace and protected text", () => {
    const source = "---\nCOMPLETED: 2026-09-19\n---\nCOMPLETED: 2026-09-19  \r\nSKIPPED: [[20.09.2026]]\r\nFAILED: 21.09.2026\r\n```\nFAILED: 2026-09-19\n```\nProse 2026-09-19\nFAILED: 2026-02-30\n";
    const result = updateRecurringLogDates(source, ["DD.MM.YYYY"], "MMM D, YYYY", true);
    expect(result).toContain("COMPLETED: [[Sep 19, 2026]]  \r\nSKIPPED: [[Sep 20, 2026]]\r\nFAILED: [[Sep 21, 2026]]");
    expect(result).toContain("---\nCOMPLETED: 2026-09-19\n---");
    expect(result).toContain("```\nFAILED: 2026-09-19\n```");
    expect(result).toContain("FAILED: 2026-02-30");
    expect(updateRecurringLogDates(result, ["MMM D, YYYY"], "MMM D, YYYY", true)).toBe(result);
    expect(updateRecurringLogDates(result, ["MMM D, YYYY"], "DD/MM/YYYY", false)).toContain("SKIPPED: 20/09/2026");
});

it("keeps migrated plain and linked dates rendered as outcome pills", () => {
    for (const date of ["Sep 19, 2026", "[[Sep 19, 2026]]"]) {
        const token = recurringLogTokens(`COMPLETED: ${date}`, "MMM D, YYYY")[0];
        expect(token.label).toBe("COMPLETED: Sep 19, 2026");
        if (date.startsWith("[[")) expect(token.display?.linkText).toBe("Sep 19, 2026");
    }
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
