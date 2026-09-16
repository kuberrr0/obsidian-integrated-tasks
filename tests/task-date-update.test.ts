import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { updateTaskDateTokens } from "../src/task-date-update";
import { TaskStore } from "../src/task-store";

const update = (text: string, links = false) => updateTaskDateTokens(text, ["DD.MM.YYYY"], "YYYY/MM/DD", links);

describe("task date migration", () => {
  it("converts both dates, mixed source formats, times, completed tasks and subtasks without reserializing", () => {
    const source = "- [X]  Keep [[Some note]]  08.09.2026 09:00  2h {[[2026-09-10]] 17:30} p2 #[[Work]]  \r\n\t- [ ] Child [[09.09.2026]]\r\n";
    expect(update(source)).toBe("- [X]  Keep [[Some note]]  2026/09/08 09:00  2h {2026/09/10 17:30} p2 #[[Work]]  \r\n\t- [ ] Child 2026/09/09\r\n");
    expect(update(source, true)).toContain("[[2026/09/08]] 09:00  2h {[[2026/09/10]] 17:30}");
  });

  it("leaves non-task text, descriptions, code, frontmatter and unrecognized dates intact", () => {
    const source = "---\n- [ ] YAML [[08.09.2026]]\n---\nText [[08.09.2026]]\n```md\n- [ ] Example [[08.09.2026]]\n```\n- [ ] Task [[Not a date]]\n  - Description 08.09.2026\n- [ ] Invalid {31.02.2026}\n";
    expect(update(source)).toBe(source);
  });

  it("uses the previous format for ambiguous dates and is idempotent after migration", () => {
    const result = updateTaskDateTokens("- [ ] Task 03/04/2026", ["DD/MM/YYYY", "MM/DD/YYYY"], "MM/DD/YYYY", false);
    expect(result).toBe("- [ ] Task 04/03/2026");
    expect(updateTaskDateTokens(result, ["MM/DD/YYYY"], "MM/DD/YYYY", false)).toBe(result);
  });

  it("updates only changed vault files and rolls back earlier writes on failure", async () => {
    const files = ["A.md", "B.md", "Unchanged.md"].map(path => Object.assign(new TFile(), { path }));
    const contents = new Map([["A.md", "- [ ] A 08.09.2026"], ["B.md", "- [x] B {09.09.2026}"], ["Unchanged.md", "Prose"]]);
    const original = new Map(contents);
    let fail = true;
    const process = vi.fn(async (file: TFile, transform: (text: string) => string) => {
      if (file.path === "B.md" && fail) throw new Error("Write failed");
      contents.set(file.path, transform(contents.get(file.path)!));
    });
    const app = { vault: { getMarkdownFiles: () => files, read: async (file: TFile) => contents.get(file.path)!, process } } as unknown as App;
    const store = new TaskStore(app, () => "YYYY/MM/DD", () => "top", () => true);
    await expect(store.updateDates(["DD.MM.YYYY"])).rejects.toThrow("Write failed");
    expect(contents).toEqual(original);
    fail = false;
    expect(await store.updateDates(["DD.MM.YYYY"])).toEqual(["A.md", "B.md"]);
    expect(contents.get("B.md")).toBe("- [x] B {[[2026/09/09]]}");
    expect(process.mock.calls.every(([file]) => file.path !== "Unchanged.md")).toBe(true);
    expect(await store.updateDates(["YYYY/MM/DD"])).toEqual([]);
  });
});
