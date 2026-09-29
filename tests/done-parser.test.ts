import { describe, expect, it } from "vitest";
import { parseTaskLine, rewriteTaskLine, serializeTask, withCompletedDate, type ParsedTokenRange } from "../src/parser";
import { updateTaskDateTokens } from "../src/task-date-update";

const reference = new Date(2026, 8, 27, 12);
const parse = (line: string, format = "YYYY-MM-DD") => parseTaskLine(line, reference, format)!;

describe("completion date parsing", () => {
  it("reads ✓ followed by the configured format, a date link or ISO", () => {
    expect(parse("- [x] Pay rent ✓Sep 27, 2026", "MMM D, YYYY")).toMatchObject({ title: "Pay rent", completed: true, completedDate: "2026-09-27" });
    expect(parse("- [x] Pay rent ✓[[Sep 27, 2026]]", "MMM D, YYYY")).toMatchObject({ title: "Pay rent", completedDate: "2026-09-27" });
    expect(parse("- [x] Pay rent ✓2026-09-27", "MMM D, YYYY")).toMatchObject({ title: "Pay rent", completedDate: "2026-09-27" });
  });

  it("reads the Tasks plugin's ✅ form", () => {
    expect(parse("- [x] Pay rent ✅ 2026-09-27")).toMatchObject({ title: "Pay rent", completedDate: "2026-09-27" });
  });

  it("sits after tags, before the destination and block ID, and records its range", () => {
    const line = "- [x] Pay rent 2026-09-26 p1 #[[home]] ✓2026-09-27 ~[[Bills]] ^r1";
    const ranges: ParsedTokenRange[] = [];
    expect(parseTaskLine(line, reference, "YYYY-MM-DD", false, ranges)).toMatchObject({ title: "Pay rent", scheduledDate: "2026-09-26", priority: 1, tags: ["home"], completedDate: "2026-09-27", destination: "Bills.md" });
    const range = ranges.find(item => item.kind === "completedDate")!;
    expect(line.slice(range.from, range.to)).toBe("✓2026-09-27");
  });

  it("leaves text that is not a completion date in the title", () => {
    for (const line of ["- [x] Tick ✓ done", "- [x] Tick ✓soon", "- [x] Tick ✓2026-09-27 10:00", "- [x] Tick ✅ tomorrow"]) {
      expect(parse(line).completedDate).toBeUndefined();
      expect(parse(line).title).toBe(line.slice(6));
    }
  });
});

describe("completion date writing", () => {
  it("serialises the ✓ form last, after tags", () => {
    const line = serializeTask({ title: "Pay rent", completed: true, completedDate: "2026-09-27", priority: 1, tags: ["home"], destination: "", indent: 0 }, "MMM D, YYYY", false);
    expect(line).toBe("- [x] Pay rent p1 #[[home]] ✓Sep 27, 2026");
    expect(serializeTask({ title: "Pay", completed: true, completedDate: "2026-09-27", destination: "", indent: 0 }, "YYYY-MM-DD", true)).toBe("- [x] Pay ✓[[2026-09-27]]");
  });

  it("adds, replaces and removes the token in place, writing ✓ even over ✅", () => {
    const raw = "- [ ] Pay rent p1 #[[home]] ~[[Bills]] ^r1";
    const task = { ...parse(raw), destination: "Bills.md" };
    const done = rewriteTaskLine(raw, { ...task, completed: true, completedDate: "2026-09-27" }, "YYYY-MM-DD", false);
    expect(done).toBe("- [x] Pay rent p1 #[[home]] ✓2026-09-27 ~[[Bills]] ^r1");
    expect(rewriteTaskLine(done, { ...task, completed: false }, "YYYY-MM-DD", false)).toBe(raw);
    expect(withCompletedDate("- [x] Pay ✅ 2026-09-20", "2026-09-27", "MMM D, YYYY", false)).toBe("- [x] Pay ✓Sep 27, 2026");
    expect(withCompletedDate("- [x] Pay ✅ 2026-09-20", "2026-09-20", "YYYY-MM-DD", false)).toBe("- [x] Pay ✅ 2026-09-20");
    expect(withCompletedDate("- [x] Pay ✓2026-09-20 #[[a]]", undefined, "YYYY-MM-DD", false)).toBe("- [x] Pay #[[a]]");
  });

  it("follows date format updates, leaving the Tasks form alone", () => {
    expect(updateTaskDateTokens("- [x] A ✓2026-09-27\n- [x] B ✅ 2026-09-27\n", ["YYYY-MM-DD"], "MMM D, YYYY", true))
      .toBe("- [x] A ✓[[Sep 27, 2026]]\n- [x] B ✅ 2026-09-27\n");
  });

});
