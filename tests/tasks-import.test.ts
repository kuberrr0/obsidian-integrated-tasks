import { describe, expect, it } from "vitest";
import { parseTaskLine } from "../src/parser";
import { convertTasksLine, convertTasksNote, skipLabel, type TasksImportOptions } from "../src/tasks-import";

const options: TasksImportOptions = { dateFormat: "MMM D, YYYY", linkDates: false, convertTags: true, dropCreatedDates: true, reference: new Date(2026, 8, 27) };
const convert = (line: string, overrides: Partial<TasksImportOptions> = {}) => convertTasksLine(line, { ...options, ...overrides });

describe("Tasks plugin import", () => {
  it("converts emoji dates, priority, recurrence and tags", () => {
    const result = convert("- [ ] Pay rent ⏫ 🔁 every month ⏳ 2026-09-28 📅 2026-10-01 🛫 2026-09-25 ➕ 2026-09-01 #home");
    expect(result.line).toBe("- [ ] Pay rent Sep 28, 2026 {Oct 1, 2026} every month >Sep 25, 2026 p1 #[[home]]");
    expect(parseTaskLine(result.line, options.reference, options.dateFormat)).toMatchObject({
      title: "Pay rent", scheduledDate: "2026-09-28", deadline: "2026-10-01", deferDate: "2026-09-25", priority: 1, repeat: "every month", tags: ["home"]
    });
  });

  it("converts done dates, keeps block IDs and indentation, and maps priorities", () => {
    expect(convert("    - [x] Filed taxes 🔽 ✅ 2026-09-20 ^taxes").line).toBe("    - [x] Filed taxes p3 ✓Sep 20, 2026 ^taxes");
    expect(convert("- [ ] A 🔺").line).toBe("- [ ] A p1");
    expect(convert("- [ ] B 🔼").line).toBe("- [ ] B p2");
    expect(convert("- [ ] C ⏬").line).toBe("- [ ] C p3");
  });

  it("links dates when the vault links dates", () => {
    expect(convert("- [ ] Call 📅 2026-10-01", { linkDates: true }).line).toBe("- [ ] Call {[[Oct 1, 2026]]}");
  });

  it("reads Dataview-style fields", () => {
    expect(convert("- [ ] Plan [due:: 2026-10-01] [scheduled:: 2026-09-28] (priority:: high) [repeat:: every week when done]").line)
      .toBe("- [ ] Plan Sep 28, 2026 {Oct 1, 2026} every week p1");
  });

  it("says when a repeat “when done” becomes a fixed schedule", () => {
    expect(convert("- [ ] Water plants 🔁 every week when done ⏳ 2026-09-28")).toMatchObject({ line: "- [ ] Water plants Sep 28, 2026 every week", skips: ["whenDone"] });
    expect(convert("- [ ] Plan [repeat:: every week when done]").skips).toEqual(["whenDone"]);
    expect(convert("- [ ] Water plants 🔁 every week").skips).toEqual([]);
    expect(skipLabel("whenDone", 2)).toBe("2 repeat rules with “when done” converted to a fixed schedule.");
  });

  it("removes the global filter tag, optionally keeps #tags and created dates", () => {
    expect(convert("- [ ] #task Buy milk #errands", { globalFilter: "#task" }).line).toBe("- [ ] Buy milk #[[errands]]");
    expect(convert("- [ ] Buy milk #errands 📅 2026-10-01", { convertTags: false }).line).toBe("- [ ] Buy milk #errands {Oct 1, 2026}");
    expect(convert("- [ ] Idea ➕ 2026-09-01 ⏳ 2026-09-28", { dropCreatedDates: false }).line).toBe("- [ ] Idea ➕2026-09-01 Sep 28, 2026");
    expect(convert("- [ ] Idea ⏳ 2026-09-28 ➕ 2026-09-01", { dropCreatedDates: false }).line).toBe("- [ ] Idea ➕2026-09-01 Sep 28, 2026");
    expect(convert("- [x] Dropped ❌ 2026-09-02 📅 2026-10-01").line).toBe("- [x] Dropped ❌2026-09-02 {Oct 1, 2026}");
  });

  it("turns * and + checklists into - so the plugin sees them", () => {
    expect(convert("* [ ] Star task").line).toBe("- [ ] Star task");
    expect(convert("  + [x] Plus task").line).toBe("  - [x] Plus task");
  });

  it("keeps what it can't convert, and reports it", () => {
    expect(convert("- [ ] Stand-up 🔁 every weekday ⏳ 2026-09-28")).toEqual({ line: "- [ ] Stand-up 🔁 every weekday Sep 28, 2026", changed: true, skips: ["repeat"] });
    expect(convert("- [!] Important 📅 2026-10-01")).toEqual({ line: "- [!] Important 📅 2026-10-01", changed: false, skips: ["status"] });
    expect(convert("1. [ ] Numbered 📅 2026-10-01").changed).toBe(false);
    expect(convert("- [ ] Blocked ⛔ abc123 📅 2026-10-01").skips).toEqual(["dependency"]);
  });

  it("converts in-progress, waiting and cancelled tasks, keeping their status", () => {
    expect(convert("- [/] In progress 📅 2026-10-01")).toEqual({ line: "- [/] In progress {Oct 1, 2026}", changed: true, skips: [] });
    expect(convert("- [?] Waiting ⏳ 2026-09-28")).toEqual({ line: "- [?] Waiting Sep 28, 2026", changed: true, skips: [] });
    expect(convert("- [-] Dropped 📅 2026-10-01 ❌ 2026-09-20")).toEqual({ line: "- [-] Dropped ❌2026-09-20 {Oct 1, 2026}", changed: true, skips: ["cancelled"] });
  });

  it("leaves lines without Tasks syntax, prose #tags off, and C# alone", () => {
    expect(convert("- [ ] Plain task Sep 28, 2026").changed).toBe(false);
    expect(convert("Notes about #meetings").changed).toBe(false);
    expect(convert("- [ ] Learn C# 📅 2026-10-01").line).toBe("- [ ] Learn C# {Oct 1, 2026}");
  });

  it("converts a note but not frontmatter or code blocks, including tasks queries", () => {
    const note = "---\ntags: [x]\n---\n- [ ] One 📅 2026-10-01\n```tasks\nnot done\ndue before tomorrow\n```\n```md\n- [ ] Example 📅 2026-10-01\n```\n- [ ] Two ⏳ 2026-09-28\r\n";
    const result = convertTasksNote(note.replace(/\r/g, ""), options, 5);
    expect(result.converted).toBe(2);
    expect(result.content).toBe("---\ntags: [x]\n---\n- [ ] One {Oct 1, 2026}\n```tasks\nnot done\ndue before tomorrow\n```\n```md\n- [ ] Example 📅 2026-10-01\n```\n- [ ] Two Sep 28, 2026\n");
    expect(result.examples).toEqual([{ before: "- [ ] One 📅 2026-10-01", after: "- [ ] One {Oct 1, 2026}" }, { before: "- [ ] Two ⏳ 2026-09-28", after: "- [ ] Two Sep 28, 2026" }]);
    expect(convertTasksNote("- [ ] A 📅 2026-10-01\r\n- [ ] B\r\n", options).content).toBe("- [ ] A {Oct 1, 2026}\r\n- [ ] B\r\n");
  });
});
