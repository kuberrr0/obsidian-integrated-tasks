import { describe, expect, it } from "vitest";
import { parseRepeatRule, parseTaskInput, parseTaskLine, rewriteTaskLine, serializeTask, type ParsedTokenRange } from "../src/parser";
import { noteDateChanges } from "../src/note-date-input";
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

  it("is consumed once", () => {
    expect(parse("- [ ] Task every week every day")).toMatchObject({ title: "Task every week", repeat: "every day" });
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

  it("serialises the rule after the scheduled date and time, before the duration", () => {
    const line = serializeTask(draft({ scheduledDate: "2026-09-28", scheduledTime: "10:00", repeat: "every week", durationMinutes: 15, priority: 2 }), "YYYY-MM-DD", false);
    expect(line).toBe("- [ ] Water plants 2026-09-28 10:00 every week 15m p2");
    expect(parse(line)).toMatchObject({ title: "Water plants", scheduledDate: "2026-09-28", scheduledTime: "10:00", repeat: "every week", durationMinutes: 15, priority: 2 });
  });

  it("adds, replaces and removes the rule in place", () => {
    const raw = "  - [ ] Water  plants 2026-09-28 15m p1 ~[[Garden]] ^w1";
    const base = { ...parse(raw), destination: "Garden.md", indent: 2 };
    const added = rewriteTaskLine(raw, { ...base, repeat: "every week" }, "YYYY-MM-DD", false);
    expect(added).toBe("  - [ ] Water  plants 2026-09-28 every week 15m p1 ~[[Garden]] ^w1");
    const replaced = rewriteTaskLine(added, { ...base, repeat: "every 2 weeks" }, "YYYY-MM-DD", false);
    expect(replaced).toBe("  - [ ] Water  plants 2026-09-28 every 2 weeks 15m p1 ~[[Garden]] ^w1");
    expect(rewriteTaskLine(replaced, { ...base, repeat: undefined }, "YYYY-MM-DD", false)).toBe(raw);
    // An unchanged rule keeps its spelling.
    const spelled = "- [ ] Meet Every Monday";
    expect(rewriteTaskLine(spelled, { ...parse(spelled), destination: "", priority: 1 }, "YYYY-MM-DD", false)).toBe("- [ ] Meet Every Monday p1");
  });
});
