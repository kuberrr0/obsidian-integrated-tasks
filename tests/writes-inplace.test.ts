import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { parseTaskLine, rewriteTaskLine, scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";
import { rescheduledDraft } from "../src/calendar";
import { draftForGroup } from "../src/list-drag";
import type { Task, TaskDraft } from "../src/types";

const reference = new Date(2026, 8, 26);
const draftOf = (line: string, format?: string): TaskDraft => ({ ...parseTaskLine(line, reference, format)!, destination: "Work.md" });

function setup(files: Record<string, string>, format = "YYYY-MM-DD") {
  const records = Object.fromEntries(Object.keys(files).map(path => [path, Object.assign(new TFile(), { path })]));
  const app = { vault: {
    getAbstractFileByPath: (path: string) => records[path],
    read: async (file: TFile) => files[file.path],
    process: async (file: TFile, update: (content: string) => string) => { files[file.path] = update(files[file.path]); }
  } } as unknown as App;
  return new TaskStore(app, () => format);
}

describe("block IDs", () => {
  it("parses metadata before a trailing block ID and keeps the ID out of the title", () => {
    expect(parseTaskLine("- [ ] X [[Sep 30, 2026]] ^abc", reference, "MMM D, YYYY")).toMatchObject({ title: "X", scheduledDate: "2026-09-30" });
    expect(parseTaskLine("- [ ] Write report ^abc123", reference)).toMatchObject({ title: "Write report" });
    expect(parseTaskLine("- [ ] ^only", reference)?.title).toBe("^only");
  });

  it("adds new metadata before the block ID", () => {
    const raw = "- [ ] Write report ^abc123";
    expect(rewriteTaskLine(raw, { ...draftOf(raw), scheduledDate: "2026-10-01" }, "MMM D, YYYY")).toBe("- [ ] Write report [[Oct 1, 2026]] ^abc123");
  });
});

describe("in-place task line rewrites", () => {
  it.each([
    ["changes one token and keeps tabs, destination and block ID", "\t- [ ] Task ~[[Work#Plan]] p2 ^id", { priority: 1 }, "\t- [ ] Task ~[[Work#Plan]] p1 ^id"],
    ["adds tokens in canonical order around existing ones", "- [ ] Task [[2026-09-20]] ~[[Work]]", { deadline: "2026-09-25", tags: ["x"] }, "- [ ] Task [[2026-09-20]] {[[2026-09-25]]} #[[x]] ~[[Work]]"],
    ["removes a token without touching other spacing", "- [ ] Task  [[2026-09-20]] 1h p2 ^id", { durationMinutes: undefined }, "- [ ] Task  [[2026-09-20]] p2 ^id"],
    ["replaces the title only when it changed", "- [ ] Old  title [[2026-09-20]] ^id", { title: "New" }, "- [ ] New [[2026-09-20]] ^id"],
    ["keeps inline fields in an unchanged title", "- [ ] Call [owner:: Sam] p2", { priority: 1 }, "- [ ] Call [owner:: Sam] p1"],
    ["keeps an untouched line byte for byte", "-  [X]   Mixed   spacing  p1  ", {}, "-  [X]   Mixed   spacing  p1  "],
    ["toggles the checkbox only", "- [ ] Done [[2026-09-20]] ^id", { completed: true }, "- [x] Done [[2026-09-20]] ^id"],
    ["keeps user tag order when the set is unchanged", "- [ ] T #[[b]] #[[a]]", { tags: ["a", "b"] }, "- [ ] T #[[b]] #[[a]]"],
    ["rewrites tags in place when they change", "- [ ] T #[[a]] ~[[Work]] ^id", { tags: ["a", "c"] }, "- [ ] T #[[a]] #[[c]] ~[[Work]] ^id"],
    ["reformats a changed date with a time", "- [ ] T 2026-09-20 p1", { scheduledDate: "2026-09-21", scheduledTime: "09:30" }, "- [ ] T [[2026-09-21]] 09:30 p1"]
  ])("%s", (_name, raw, patch, expected) => {
    expect(rewriteTaskLine(raw, { ...draftOf(raw), ...patch } as TaskDraft)).toBe(expected);
  });

  it("uses spaces only when the indent width changes", () => {
    const raw = "\t- [ ] Child p1";
    expect(rewriteTaskLine(raw, { ...draftOf(raw), indent: 4 })).toBe(raw);
    expect(rewriteTaskLine(raw, { ...draftOf(raw), indent: 2 })).toBe("  - [ ] Child p1");
  });
});

describe("destination tokens and block IDs survive every write path", () => {
  const note = "# Plan\n\t- [ ] Write report ~[[Other#Later]] p2 ^abc123\n\t\t- detail\n- [ ] Next\n";
  const task = (files: Record<string, string>): Task => scanTasks("Work.md", files["Work.md"])[0];
  const expectKept = (files: Record<string, string>, line: string): void => {
    expect(files["Work.md"]).toBe(`# Plan\n\t- [ ] Write report ${line} ^abc123\n\t\t- detail\n- [ ] Next\n`);
  };

  it("single update (calendar reschedule)", async () => {
    const files = { "Work.md": note };
    await setup(files).update(task(files), rescheduledDraft(task(files), "2026-10-01"));
    expectKept(files, "[[2026-10-01]] ~[[Other#Later]] p2");
  });
  it("bulk property edit", async () => {
    const files = { "Work.md": note };
    await setup(files).bulkUpdate([task(files)], { priority: 1 });
    expectKept(files, "~[[Other#Later]] p1");
  });
  it("bulk calendar reschedule", async () => {
    const files = { "Work.md": note };
    await setup(files).bulkChange([task(files)], original => rescheduledDraft(original, "2026-10-02", "08:00"));
    expectKept(files, "[[2026-10-02]] 08:00 ~[[Other#Later]] p2");
  });
  it("status drop", async () => {
    const files = { "Work.md": note };
    await setup(files).bulkDrop([task(files)], { property: "status", value: "Completed" });
    expect(files["Work.md"]).toContain("\t- [x] Write report ~[[Other#Later]] p2 ^abc123\n\t\t- detail\n");
  });
  it("description edit", async () => {
    const files = { "Work.md": note };
    await setup(files).update(task(files), { ...draftForGroup(task(files)), description: "changed" });
    expect(files["Work.md"]).toContain("\t- [ ] Write report ~[[Other#Later]] p2 ^abc123\n");
  });
  it("reorder drop at the same depth keeps tabs", async () => {
    const files = { "Work.md": "# Plan\n- [ ] Write report ~[[Other]] ^abc123\n\t- [ ] Child ^kid\n- [ ] Next\n" };
    const [first, , next] = scanTasks("Work.md", files["Work.md"]);
    await setup(files).bulkDrop([first], undefined, next, "after");
    expect(files["Work.md"]).toBe("# Plan\n- [ ] Next\n- [ ] Write report ~[[Other]] ^abc123\n\t- [ ] Child ^kid\n");
  });
});
