import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import * as parser from "../src/parser";
import { TaskStore } from "../src/task-store";

function setup(files: Record<string, string>, level = 1) {
  const records = Object.fromEntries(Object.keys(files).map(path => [path, Object.assign(new TFile(), { path })]));
  const app = { vault: {
    getAbstractFileByPath: (path: string) => records[path],
    read: async (file: TFile) => files[file.path],
    process: async (file: TFile, update: (content: string) => string) => { files[file.path] = update(files[file.path]); }
  } } as unknown as App;
  return new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => true, () => level);
}

const bigNote = (count: number): string => ["# Plan", ...Array.from({ length: count }, (_, i) => `- [ ] Task number ${i} [[2026-09-${String(1 + i % 28).padStart(2, "0")}]] p${1 + i % 3}`), "# Later", ""].join("\n");

describe("bulk operations parse each note once", () => {
  it("scans a 10,000-task note once for a 200-task bulk edit, quickly", async () => {
    const files = { "Big.md": bigNote(10_000) };
    const selected = parser.scanTasks("Big.md", files["Big.md"]).filter((_, i) => i % 50 === 0);
    expect(selected).toHaveLength(200);
    const scan = vi.spyOn(parser, "scanTasks");
    const start = performance.now();
    await setup(files).bulkUpdate(selected, { priority: 3, durationMinutes: 30 });
    const elapsed = performance.now() - start;
    expect(scan).toHaveBeenCalledOnce();
    scan.mockRestore();
    expect(elapsed).toBeLessThan(1000);
    const after = parser.scanTasks("Big.md", files["Big.md"]);
    expect(after.filter(task => task.priority === 3 && task.durationMinutes === 30)).toHaveLength(200);
    expect(after[50].raw).toBe("- [ ] Task number 50 [[2026-09-23]] 30m p3");
  });

  it("scans once per note for a 200-task move within the note", async () => {
    const files = { "Big.md": bigNote(2_000) };
    const selected = parser.scanTasks("Big.md", files["Big.md"]).filter((_, i) => i % 10 === 0);
    const scan = vi.spyOn(parser, "scanTasks");
    await setup(files).bulkUpdate(selected, { destination: "Big.md#Later" });
    expect(scan).toHaveBeenCalledOnce();
    scan.mockRestore();
    const moved = parser.scanTasks("Big.md", files["Big.md"]).filter(task => task.section === "Later");
    expect(moved).toHaveLength(200);
  });

  it("passes the configured section level to the write-time scan", async () => {
    const content = "## Mon\n- [ ] Water\n## Tue\n- [ ] Water\n";
    const files = { "W.md": content };
    const tuesday = parser.scanTasks("W.md", content, new Date(), "YYYY-MM-DD", 2)[1];
    files["W.md"] = "x\ny\n" + content;
    await setup(files, 2).bulkDelete([tuesday]);
    expect(files["W.md"]).toBe("x\ny\n## Mon\n- [ ] Water\n## Tue\n");
  });
});

describe("subtree ends from the task tree", () => {
  it("stops a task's range at an interrupting paragraph", () => {
    const [a, b] = parser.scanTasks("W.md", "- [ ] A\nParagraph\n  - [ ] B");
    expect(a.endLine).toBe(0);
    expect(b.parentId).toBeUndefined();
    const [root] = parser.scanTasks("W.md", "- [ ] A\n  - [ ] B\n    - [ ] C\n  - note\n- [ ] D");
    expect(root.endLine).toBe(2);
  });

  it("deletes and moves such a task", async () => {
    const content = "- [ ] A\nParagraph\n  - [ ] B\n";
    const files = { "W.md": content };
    await setup(files).delete(parser.scanTasks("W.md", content)[0]);
    expect(files["W.md"]).toBe("Paragraph\n  - [ ] B\n");
    files["W.md"] = content + "- [ ] C\n";
    const [a, , c] = parser.scanTasks("W.md", files["W.md"]);
    await setup(files).bulkDrop([a], undefined, c, "after");
    expect(files["W.md"]).toBe("Paragraph\n  - [ ] B\n- [ ] C\n- [ ] A\n");
  });
});
