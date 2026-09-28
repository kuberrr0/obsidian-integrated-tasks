import { describe, expect, it } from "vitest";
import { parseTaskLine, rewriteTaskLine, scanTasks, serializeTask, withCompletedDate } from "../src/parser";
import { insertIntoDestination, toggleTaskInContent } from "../src/markdown";
import { descriptionLines } from "../src/task-description";
import { parseTaskTreeInput } from "../src/task-input";
import { advanceRecurringTask } from "../src/recurring-task";
import { draftStatus, statusFromLabel } from "../src/task-status";
import type { TaskDraft } from "../src/types";

const reference = new Date(2026, 8, 27, 12);

describe("status checkboxes", () => {
  it.each([
    [" ", "todo", false], ["/", "doing", false], ["?", "waiting", false], ["x", "done", true], ["X", "done", true], ["-", "cancelled", true]
  ] as const)("reads [%s] as %s", (char, status, completed) => {
    expect(parseTaskLine(`- [${char}] Task p1`, reference)).toMatchObject({ title: "Task", status, completed, priority: 1 });
  });

  it("leaves other characters as plain list items", () => {
    for (const char of ["!", ">", "*", "<", "~"]) expect(parseTaskLine(`- [${char}] Task`, reference)).toBeUndefined();
    expect(scanTasks("A.md", "- [!] Flagged\n- [>] Forwarded\n- [/] Doing")).toHaveLength(1);
  });

  it("serializes each status, deriving it from completed when a draft has none", () => {
    const draft: TaskDraft = { title: "Task", completed: false, destination: "", indent: 0 };
    expect(serializeTask(draft)).toBe("- [ ] Task");
    expect(serializeTask({ ...draft, completed: true })).toBe("- [x] Task");
    expect(serializeTask({ ...draft, status: "doing" })).toBe("- [/] Task");
    expect(serializeTask({ ...draft, status: "waiting" })).toBe("- [?] Task");
    expect(serializeTask({ ...draft, status: "cancelled", completed: true })).toBe("- [-] Task");
  });

  it("follows completed when a spread task is checked or unchecked", () => {
    expect(draftStatus({ status: "doing", completed: true })).toBe("done");
    expect(draftStatus({ status: "cancelled", completed: false })).toBe("todo");
    expect(draftStatus({ status: "cancelled", completed: true })).toBe("cancelled");
    expect(draftStatus({ status: "waiting", completed: false })).toBe("waiting");
  });

  it("reads status labels and query words", () => {
    expect(["To do", "todo", "In progress", "doing", "Waiting", "Done", "completed", "Cancelled", "canceled", "open"].map(statusFromLabel))
      .toEqual(["todo", "todo", "doing", "doing", "waiting", "done", "done", "cancelled", "cancelled", undefined]);
  });

  it("rewrites only the marker, keeping spacing, tokens and block IDs", () => {
    const raw = "  -   [ ]  Call   Sam [[2026-09-28]] p1 #[[work]] ^abc";
    const parsed = { ...parseTaskLine(raw, reference)!, destination: "" };
    expect(rewriteTaskLine(raw, { ...parsed, status: "doing" }, "YYYY-MM-DD", true, reference)).toBe("  -   [/]  Call   Sam [[2026-09-28]] p1 #[[work]] ^abc");
    expect(rewriteTaskLine(raw, { ...parsed, status: "cancelled", completed: true }, "YYYY-MM-DD", true, reference)).toBe("  -   [-]  Call   Sam [[2026-09-28]] p1 #[[work]] ^abc");
    const done = "- [X] Done";
    expect(rewriteTaskLine(done, { ...parseTaskLine(done, reference)!, destination: "", priority: 2 })).toBe("- [X] Done p2");
    expect(withCompletedDate("- [/] Doing p1", "2026-09-27")).toBe("- [/] Doing p1 ✓[[2026-09-27]]");
  });

  it("toggles any open status to done, and done or cancelled back to to do", () => {
    const content = "- [ ] A\n- [/] B\n- [?] C\n- [x] D\n- [-] E";
    const tasks = scanTasks("A.md", content);
    const toggled = tasks.map(task => toggleTaskInContent(content, task, !task.completed).split("\n")[task.line]);
    expect(toggled).toEqual(["- [x] A", "- [x] B", "- [x] C", "- [ ] D", "- [ ] E"]);
  });

  it("keeps new-status lines as subtasks in task batches, and as text in typed descriptions", () => {
    // Description text stays description text, as `- [ ]` lines already do.
    expect(descriptionLines("Notes\n- [/] Draft\n- [-] Dropped", 0)).toEqual(["    - Notes", "    - - [/] Draft", "    - - [-] Dropped"]);
    const draft = parseTaskTreeInput("- [/] Launch\n  - [?] Hear back\n  - [-] Old plan", "Inbox.md", reference);
    expect(draft).toMatchObject({ title: "Launch", status: "doing", additionalLines: ["  - [?] Hear back", "  - [-] Old plan"] });
  });

  it("inserts new tasks at the first task of any status", () => {
    expect(insertIntoDestination("Intro\n- [/] Doing\n", ["- [ ] New"])).toBe("Intro\n- [ ] New\n- [/] Doing\n");
  });

  it("resets an advanced repeating task to to do", () => {
    const content = "- [/] [[Habit]] 2026-09-19 p1";
    const [task] = scanTasks("A.md", content);
    expect(advanceRecurringTask(content, task, "2026-09-22", "YYYY-MM-DD")).toBe("- [ ] [[Habit]] 2026-09-22 p1");
  });
});
