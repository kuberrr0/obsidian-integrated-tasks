import { describe, expect, it } from "vitest";
import { parseTaskLine, rewriteTaskLine, serializeTask, type ParsedTokenRange } from "../src/parser";
import { parseEditedTaskInput } from "../src/task-input";
import { updateTaskDateTokens } from "../src/task-date-update";
import type { TaskDraft } from "../src/types";

const reference = new Date(2026, 8, 26);
const US = "MMM D, YYYY";
const parse = (line: string, format = US) => parseTaskLine(line, reference, format);
const draftOf = (line: string, format = US): TaskDraft => ({ ...parse(line, format)!, destination: "Work.md" });

describe("defer syntax", () => {
  it.each([
    ["- [ ] Renew passport >Oct 1, 2026", "2026-10-01"],
    ["- [ ] Renew passport >[[Oct 1, 2026]]", "2026-10-01"],
    ["- [ ] Renew passport >2026-10-01", "2026-10-01"],
    ["- [ ] Renew passport >tomorrow", "2026-09-27"]
  ])("parses %s", (line, deferDate) => {
    const parsed = parse(line)!;
    expect(parsed).toMatchObject({ title: "Renew passport", deferDate });
    expect(parsed.scheduledDate).toBeUndefined();
    expect(parsed.someday).toBeUndefined();
  });

  it("parses someday case-insensitively without a date", () => {
    for (const word of ["someday", "Someday", "SOMEDAY"]) {
      const parsed = parse(`- [ ] Learn Rust >${word}`)!;
      expect(parsed).toMatchObject({ title: "Learn Rust", someday: true });
      expect(parsed.deferDate).toBeUndefined();
    }
  });

  it("reads a defer beside other metadata, never as a scheduled date", () => {
    expect(parse("- [ ] Task [[Sep 30, 2026]] 1h {Oct 5, 2026} >Oct 1, 2026 p1 #[[x]] ^id")).toMatchObject({
      title: "Task", scheduledDate: "2026-09-30", durationMinutes: 60, deadline: "2026-10-05", deferDate: "2026-10-01", priority: 1, tags: ["x"]
    });
    expect(parse("- [ ] Task >Oct 1, 2026 [[Sep 30, 2026]]")).toMatchObject({ title: "Task", scheduledDate: "2026-09-30", deferDate: "2026-10-01" });
  });

  it.each([
    ["- [ ] a > b", "a > b"],
    ["- [ ] Compare >maybe", "Compare >maybe"],
    ["- [ ] Call >tomorrow 9am", "Call >tomorrow 9am"],
    ["- [ ] Link >[[Oct 1, 2026]] 09:00", "Link >[[Oct 1, 2026]] 09:00"],
    ["- [ ] Note >[[Project]]", "Note >[[Project]]"],
    ["- [ ] Spaced > Oct 1, 2026", "Spaced >"]
  ])("keeps %s in the title", (line, title) => {
    const parsed = parse(line)!;
    expect(parsed.title).toBe(title);
    expect(parsed.deferDate).toBeUndefined();
    expect(parsed.someday).toBeUndefined();
  });

  it("consumes only one defer per line", () => {
    expect(parse("- [ ] Task >2026-10-01 >2026-10-02")).toMatchObject({ title: "Task >2026-10-01", deferDate: "2026-10-02" });
  });

  it("records the defer token range, including its prefix", () => {
    const line = "- [ ] Task >[[Oct 1, 2026]] p2";
    const ranges: ParsedTokenRange[] = [];
    parseTaskLine(line, reference, US, false, ranges);
    const range = ranges.find(item => item.kind === "defer")!;
    expect(line.slice(range.from, range.to)).toBe(">[[Oct 1, 2026]]");
  });
});

describe("defer serialization", () => {
  const base: TaskDraft = { title: "Task", completed: false, destination: "Inbox.md", indent: 0 };
  it("writes after the deadline and before priority, linked or plain", () => {
    const draft = { ...base, deadline: "2026-10-05", deferDate: "2026-10-01", priority: 2 as const, tags: ["x"] };
    expect(serializeTask(draft, US, true)).toBe("- [ ] Task {[[Oct 5, 2026]]} >[[Oct 1, 2026]] p2 #[[x]]");
    expect(serializeTask(draft, US, false)).toBe("- [ ] Task {Oct 5, 2026} >Oct 1, 2026 p2 #[[x]]");
    expect(serializeTask({ ...base, someday: true, deferDate: "2026-10-01" }, US)).toBe("- [ ] Task >someday");
  });

  it.each([true, false])("round-trips through the parser (linkDates %s)", linkDates => {
    for (const format of [US, "YYYY-MM-DD", "DD/MM/YYYY"]) {
      const dated = parseTaskLine(serializeTask({ ...base, deferDate: "2026-10-01", scheduledDate: "2026-09-30" }, format, linkDates), reference, format)!;
      expect(dated).toMatchObject({ title: "Task", deferDate: "2026-10-01", scheduledDate: "2026-09-30" });
      const someday = parseTaskLine(serializeTask({ ...base, someday: true }, format, linkDates), reference, format)!;
      expect(someday).toMatchObject({ title: "Task", someday: true });
      expect(someday.deferDate).toBeUndefined();
    }
  });
});

describe("defer in-place rewrites", () => {
  it.each([
    ["adds a defer in canonical order, keeping destination and block ID", "\t- [ ] Task {Oct 5, 2026} p1 ~[[Work#Plan]] ^id", { deferDate: "2026-10-01" }, "\t- [ ] Task {Oct 5, 2026} >[[Oct 1, 2026]] p1 ~[[Work#Plan]] ^id"],
    ["changes only the defer token", "- [ ] Task  >Oct 1, 2026  p2 ^id", { deferDate: "2026-10-03" }, "- [ ] Task  >[[Oct 3, 2026]]  p2 ^id"],
    ["clears the defer token", "- [ ] Task [[Sep 30, 2026]] >Oct 1, 2026 p2 ~[[Work]] ^id", { deferDate: undefined }, "- [ ] Task [[Sep 30, 2026]] p2 ~[[Work]] ^id"],
    ["switches a date to someday", "- [ ] Task >[[Oct 1, 2026]] ^id", { deferDate: undefined, someday: true }, "- [ ] Task >someday ^id"],
    ["switches someday to a date", "- [ ] Task >Someday #[[x]]", { deferDate: "2026-10-01", someday: undefined }, "- [ ] Task >[[Oct 1, 2026]] #[[x]]"],
    ["keeps an unchanged defer byte for byte", "- [ ] Task >2026-10-01 p2", { priority: 1 }, "- [ ] Task >2026-10-01 p1"],
    ["keeps a natural-language defer that resolves to the same date", "- [ ] Task >tomorrow", { title: "Task" }, "- [ ] Task >tomorrow"]
  ])("%s", (_name, raw, patch, expected) => {
    expect(rewriteTaskLine(raw, { ...draftOf(raw), ...patch } as TaskDraft, US, true, reference)).toBe(expected);
  });

  it("round-trips a rewritten defer", () => {
    const raw = "- [ ] Task p1 ^id";
    const next = rewriteTaskLine(raw, { ...draftOf(raw), deferDate: "2026-11-02" }, US, false, reference);
    expect(parse(next)).toMatchObject({ title: "Task", deferDate: "2026-11-02", priority: 1 });
  });
});

describe("defer in edits and migrations", () => {
  it("never reads a typed defer as a scheduled date in the task editor", () => {
    const parsed = parseEditedTaskInput("Renew passport >tomorrow", "Renew passport", reference, US)!;
    expect(parsed).toMatchObject({ title: "Renew passport", deferDate: "2026-09-27" });
    expect(parsed.scheduledDate).toBeUndefined();
  });

  it("migrates defer dates to a new date format", () => {
    expect(updateTaskDateTokens("- [ ] Task >[[2026-10-01]] p1\n- [ ] Later >someday", ["YYYY-MM-DD"], US, true))
      .toBe("- [ ] Task >[[Oct 1, 2026]] p1\n- [ ] Later >someday");
  });
});
