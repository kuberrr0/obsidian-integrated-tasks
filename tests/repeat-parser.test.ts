import { describe, expect, it } from "vitest";
import { parseRepeatInput, parseRepeatRule, parseTaskInput, parseTaskLine, repeatLabel, repeatRuleList, rewriteTaskLine, serializeTask, type ParsedTokenRange } from "../src/parser";
import { noteDateChanges } from "../src/note-date-input";
import { parseEditedTaskInput } from "../src/task-input";
import type { TaskDraft } from "../src/types";

const reference = new Date(2026, 8, 27, 12);
const parse = (line: string, format = "YYYY-MM-DD") => parseTaskLine(line, reference, format)!;

describe("inline repeat parsing", () => {
  it("reads a trailing rule between the schedule and duration", () => {
    const ranges: ParsedTokenRange[] = [];
    const line = "- [ ] Water plants Sep 28, 2026 every week 15m";
    const task = parseTaskLine(line, reference, "MMM D, YYYY", false, ranges)!;
    expect(task).toMatchObject({ title: "Water plants", scheduledDate: "2026-09-28", repeat: "every week", durationMinutes: 15 });
    const range = ranges.find(item => item.kind === "repeat")!;
    expect(line.slice(range.from, range.to)).toBe("every week");
  });

  it.each([
    ["every day", "every day"], ["every week", "every week"], ["Every Other Week", "every other week"], ["every 2 weeks", "every 2 weeks"],
    ["every 3rd month", "every 3rd month"], ["every month", "every month"], ["every  year", "every year"], ["every Monday", "every monday"],
    ["every sundays", "every sundays"], ["EVERY FRIDAY", "every friday"]
  ])("normalises %s", (rule, normalised) => {
    expect(parse(`- [ ] Task ${rule}`)).toMatchObject({ title: "Task", repeat: normalised });
    expect(parseRepeatRule(rule)).toBe(normalised);
  });

  it("reads a whole trailing rule after prose as the repeat", () => {
    expect(parse("- [ ] Meet every Monday")).toMatchObject({ title: "Meet", repeat: "every monday" });
    expect(parse("- [ ] Meet every Monday p1 #[[team]]")).toMatchObject({ title: "Meet", repeat: "every monday", priority: 1, tags: ["team"] });
  });

  it("leaves prose that is not a rule in the title", () => {
    for (const line of ["- [ ] Smile every time", "- [ ] Meet every other", "- [ ] every day", "- [ ] Run every 1001 days", "- [ ] Every week counts here", "- [ ] Fix everyday bugs"]) {
      const task = parse(line);
      expect(task.repeat).toBeUndefined();
      expect(task.title).toBe(line.slice(6));
    }
  });

  it("reads several rules, in the order written, each a token of its own", () => {
    const ranges: ParsedTokenRange[] = [];
    const line = "- [ ] do this [[2026-10-01]] 21:00 every monday every friday p1";
    expect(parseTaskLine(line, reference, "YYYY-MM-DD", false, ranges)).toMatchObject({ title: "do this", repeat: "every monday every friday", scheduledTime: "21:00", priority: 1 });
    expect(ranges.filter(range => range.kind === "repeat").map(range => line.slice(range.from, range.to))).toEqual(["every friday", "every monday"]);
    // A rule written twice counts once.
    expect(parse("- [ ] Task every week every week")).toMatchObject({ title: "Task", repeat: "every week" });
  });

  it("labels several rules, and reads them typed loosely", () => {
    expect(repeatLabel("every monday every friday")).toBe("Every Monday, every Friday");
    expect(repeatRuleList("every monday every 2 weeks")).toEqual(["every monday", "every 2 weeks"]);
    expect(parseRepeatInput("monday, friday")).toBe("every monday every friday");
    expect(parseRepeatInput("every monday and every friday")).toBe("every monday every friday");
    expect(parseRepeatInput("monday, banana")).toBeUndefined();
  });

  it("reads the date and both rules in the task editor and a card, too", () => {
    const typed = "do this every monday every friday today 9pm";
    expect(serializeTask({ ...parseTaskInput(typed, reference)!, destination: "Inbox.md", indent: 0 }, "YYYY-MM-DD", true))
      .toBe("- [ ] do this [[2026-09-27]] 21:00 every monday every friday");
    expect(parseEditedTaskInput(typed, "do this", reference)).toMatchObject({ title: "do this", scheduledDate: "2026-09-27", scheduledTime: "21:00", repeat: "every monday every friday" });
  });

  it("converts the user's line in a note: the date, with both rules kept", () => {
    const line = "- [ ] do this every monday every friday today 9pm";
    let result = line;
    for (const change of noteDateChanges(line, "YYYY-MM-DD", reference).reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    expect(result).toBe("- [ ] do this every monday every friday [[2026-09-27]] 21:00");
    expect(parse(result)).toMatchObject({ title: "do this", scheduledDate: "2026-09-27", scheduledTime: "21:00", repeat: "every monday every friday" });
  });

  it("never reads 'every friday' as a schedule in typed input or note dates", () => {
    expect(parseTaskInput("Call mom every friday", reference)).toMatchObject({ title: "Call mom", repeat: "every friday" });
    expect(parseTaskInput("Call mom every friday", reference)!.scheduledDate).toBeUndefined();
    expect(parseTaskInput("Call mom every friday at 5pm", reference)).toMatchObject({ title: "Call mom every friday at 5pm" });
    expect(parseTaskInput("Call mom every friday at 5pm", reference)!.scheduledDate).toBeUndefined();
    expect(noteDateChanges("- [ ] Meet every friday", "YYYY-MM-DD", reference, false)).toEqual([]);
    expect(noteDateChanges("- [ ] every friday", "YYYY-MM-DD", reference, false)).toEqual([]);
    expect(noteDateChanges("- [ ] Water tomorrow every week", "YYYY-MM-DD", reference, false)).toEqual([{ from: 12, to: 20, insert: "2026-09-28" }]);
  });

});

describe("inline repeat writing", () => {
  const draft = (overrides: Partial<TaskDraft>): TaskDraft => ({ title: "Water plants", completed: false, destination: "Inbox.md", indent: 0, ...overrides });

  it("serialises the rule after the scheduled date, time and duration", () => {
    const line = serializeTask(draft({ scheduledDate: "2026-09-28", scheduledTime: "10:00", repeat: "every week", durationMinutes: 15, priority: 2 }), "YYYY-MM-DD", false);
    expect(line).toBe("- [ ] Water plants 2026-09-28 10:00 15m every week p2");
    expect(parse(line)).toMatchObject({ title: "Water plants", scheduledDate: "2026-09-28", scheduledTime: "10:00", repeat: "every week", durationMinutes: 15, priority: 2 });
  });

  it("adds, replaces and removes the rule in place", () => {
    const raw = "  - [ ] Water  plants 2026-09-28 15m p1 ~[[Garden]] ^w1";
    const base = { ...parse(raw), destination: "Garden.md", indent: 2 };
    const added = rewriteTaskLine(raw, { ...base, repeat: "every week" }, "YYYY-MM-DD", false);
    expect(added).toBe("  - [ ] Water  plants 2026-09-28 15m every week p1 ~[[Garden]] ^w1");
    const replaced = rewriteTaskLine(added, { ...base, repeat: "every 2 weeks" }, "YYYY-MM-DD", false);
    expect(replaced).toBe("  - [ ] Water  plants 2026-09-28 15m every 2 weeks p1 ~[[Garden]] ^w1");
    expect(rewriteTaskLine(replaced, { ...base, repeat: undefined }, "YYYY-MM-DD", false)).toBe(raw);
    // An unchanged rule keeps its spelling.
    const spelled = "- [ ] Meet Every Monday";
    expect(rewriteTaskLine(spelled, { ...parse(spelled), destination: "", priority: 1 }, "YYYY-MM-DD", false)).toBe("- [ ] Meet Every Monday p1");
  });
});
