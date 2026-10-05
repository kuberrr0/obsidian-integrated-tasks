import { afterEach, describe, expect, it } from "vitest";
import { setTagFormat } from "../src/task-tags";
import { replaceTaskTokens, taskInputRanges } from "../src/task-input";

// Tuesday, Sep 29 2026.
const now = new Date(2026, 8, 29, 12);
const spans = (text: string, original = "") => taskInputRanges(text, original, now, "YYYY-MM-DD").map(range => `${range.kind}:${text.slice(range.from, range.to)}`);

describe("where task text sets properties", () => {
  it("finds tokens at the end, the destination included", () => {
    expect(spans("Call [[2026-10-01]] 09:00 30m {2026-10-02} p1 every week #[[open house]] ~[[Work]]")).toEqual([
      "scheduledDate:[[2026-10-01]] 09:00", "durationMinutes:30m", "deadline:{2026-10-02}", "priority:p1", "repeat:every week", "tags:#[[open house]]", "destination:~[[Work]]"
    ]);
  });

  it("finds dates written in words that end the title, only where newly typed", () => {
    expect(spans("Call mom about dinner tomorrow at 3pm")).toEqual(["scheduledDate:tomorrow at 3pm"]);
    // Only properties may follow the date; in the middle of the title it is a word.
    expect(spans("Call mom tomorrow at 3pm about dinner")).toEqual([]);
    expect(spans("Call mom tomorrow p1 3pm")).toEqual(["scheduledDate:tomorrow", "priority:p1", "scheduledDate:3pm"]);
    expect(spans("Buy sun cream")).toEqual([]);
    expect(spans("Pay rent {next friday} p2")).toEqual(["deadline:{next friday}", "priority:p2"]);
    // Words already in the title are prose, not a date.
    expect(spans("Plan for tomorrow", "Plan for tomorrow")).toEqual([]);
    expect(spans("Plan for tomorrow friday", "Plan for tomorrow")).toEqual(["scheduledDate:friday"]);
    expect(spans("Water plants every friday")).toEqual(["repeat:every friday"]);
  });
});

describe("rewriting one property's token", () => {
  const replace = (text: string, kinds: Parameters<typeof replaceTaskTokens>[1], token: string, original = "") => replaceTaskTokens(text, kinds, token, original, now, "YYYY-MM-DD");

  it("replaces a token, or words read as a date, and appends the new one", () => {
    expect(replace("Call mom p2 #[[x]]", ["priority"], "p1")).toBe("Call mom #[[x]] p1");
    expect(replace("Call mom about dinner tomorrow at 3pm", ["scheduledDate", "durationMinutes"], "[[2026-10-05]]")).toBe("Call mom about dinner [[2026-10-05]]");
    expect(replace("Call mom p2", ["priority"], "")).toBe("Call mom");
  });

  it("keeps a leading space while there is no title, and later lines as they are", () => {
    expect(replace("", ["priority"], "p1")).toBe(" p1");
    expect(replace(" #[[x]]", ["tags"], "#[[x]] #[[y]]")).toBe(" #[[x]] #[[y]]");
    expect(replace("Main p3\n  - [ ] Child p3", ["priority"], "p1")).toBe("Main p1\n  - [ ] Child p3");
  });
});

import { insertedTaskLine } from "../src/task-store";
describe("finding a newly written task", () => {
  it("returns the first task line an insertion added, past blank lines it brought", () => {
    expect(insertedTaskLine("# Plan\n- [ ] A", "# Plan\n- [ ] New\n- [ ] A")).toBe(1);
    expect(insertedTaskLine("- [ ] A", "- [ ] A\n\n- [ ] New")).toBe(2);
    expect(insertedTaskLine("", "- [ ] New\n")).toBe(0);
    expect(insertedTaskLine("- [ ] A", "- [ ] A")).toBe(-1);
  });
});

import { parseEditedTaskInput } from "../src/task-input";
import { parseTaskInput } from "../src/parser";
describe("a date and a time written apart", () => {
  it("reads them as one schedule, marking each part, and tokens between them too", () => {
    expect(spans("Call mom tomorrow p1 3pm")).toEqual(["scheduledDate:tomorrow", "priority:p1", "scheduledDate:3pm"]);
    expect(parseTaskInput("Call mom tomorrow p1 3pm", now, "YYYY-MM-DD")).toMatchObject({ title: "Call mom", scheduledDate: "2026-09-30", scheduledTime: "15:00", priority: 1 });
    expect(parseEditedTaskInput("Call mom tomorrow p1 3pm", "Call mom", now, "YYYY-MM-DD")).toMatchObject({ title: "Call mom", scheduledDate: "2026-09-30", scheduledTime: "15:00", priority: 1 });
  });

  it("keeps a deadline between a time and a date apart from them", () => {
    expect(spans("Call 3pm {friday} tomorrow")).toEqual(["scheduledDate:3pm", "deadline:{friday}", "scheduledDate:tomorrow"]);
    expect(parseTaskInput("Call 3pm {friday} tomorrow", now, "YYYY-MM-DD")).toMatchObject({ title: "Call", scheduledDate: "2026-09-30", scheduledTime: "15:00", deadline: "2026-10-02" });
  });

  it("gives a date token the time typed apart from it", () => {
    expect(spans("Call 3pm [[2026-10-05]]")).toEqual(["scheduledDate:3pm", "scheduledDate:[[2026-10-05]]"]);
    expect(parseTaskInput("Call 3pm [[2026-10-05]]", now, "YYYY-MM-DD")).toMatchObject({ title: "Call", scheduledDate: "2026-10-05", scheduledTime: "15:00" });
    expect(parseEditedTaskInput("Call 3pm [[2026-10-05]]", "Call [[2026-10-05]]", now, "YYYY-MM-DD")).toMatchObject({ title: "Call", scheduledDate: "2026-10-05", scheduledTime: "15:00" });
  });
});

describe("tags in the #tag format", () => {
  afterEach(() => setTagFormat("wikilink"));
  it("marks a trailing #tag, not a #[[tag]], and rewrites tags as #tag", () => {
    setTagFormat("hash");
    expect(spans("Call mom p1 #family #errand")).toEqual(["priority:p1", "tags:#family", "tags:#errand"]);
    expect(spans("Call #mom about dinner")).toEqual([]);
    expect(spans("Call mom #[[family]]")).toEqual([]);
    expect(replaceTaskTokens("Call mom #family p1", ["priority"], "p2", "", now, "YYYY-MM-DD")).toBe("Call mom #family p2");
  });
});

import { copiedTaskText, insertAfterTask, pastedTaskLines } from "../src/task-block";
import { scanTasks } from "../src/parser";
describe("copying and pasting tasks as Markdown", () => {
  const note = "# Plan\n- [ ] A ^a1\n  - Notes\n  - [ ] A child\n- [x] B\n\t- [ ] Deep";
  const tasks = scanTasks("Work.md", note);

  it("copies each task's block once, in the order given, at the left margin", () => {
    const [a, child, b, deep] = tasks;
    expect(copiedTaskText(new Map([["Work.md", note]]), [b, a, child])).toBe("- [x] B\n\t- [ ] Deep\n- [ ] A ^a1\n  - Notes\n  - [ ] A child");
    expect(copiedTaskText(new Map([["Work.md", note]]), [deep])).toBe("- [ ] Deep");
  });

  it("reads copied text from its first task on, dropping block ids and trailing blank lines", () => {
    expect(pastedTaskLines("Some words\n  - [ ] A ^a1\n    - Notes\n  - [ ] B\n\n")).toEqual(["- [ ] A", "  - Notes", "- [ ] B"]);
    expect(pastedTaskLines("Just text")).toBeUndefined();
  });

  it("inserts pasted lines right after a task, as its next siblings", () => {
    const child = tasks[1];
    expect(insertAfterTask(note, child, ["- [ ] New", "  - [ ] Its step"])).toEqual({
      content: "# Plan\n- [ ] A ^a1\n  - Notes\n  - [ ] A child\n  - [ ] New\n    - [ ] Its step\n- [x] B\n\t- [ ] Deep", line: 4
    });
  });
});
