import { describe, expect, it } from "vitest";
import { parseTaskTreeInput } from "../src/task-input";
import { scanTasks, serializeTask } from "../src/parser";
const now = new Date(2026, 8, 7, 10);

describe("multiline new task input", () => {
  it("parses natural language independently for main tasks, siblings and nested subtasks", () => {
    const draft = parseTaskTreeInput("Plan today p1\n  - [ ] Call tomorrow at 9pm 30m p2\n    - [x] Send {next Friday at noon}\nReview tomorrow", "Inbox.md", now);
    const tasks = scanTasks("Inbox.md", [serializeTask(draft), ...draft.additionalLines!].join("\n"));
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ title: "Plan", scheduledDate: "2026-09-07", priority: 1 });
    expect(tasks[1]).toMatchObject({ title: "Call", scheduledDate: "2026-09-08", scheduledTime: "21:00", durationMinutes: 30, priority: 2, parentId: tasks[0].id });
    expect(tasks[2]).toMatchObject({ title: "Send", completed: true, deadline: "2026-09-18", deadlineTime: "12:00", parentId: tasks[1].id });
    expect(tasks[3]).toMatchObject({ title: "Review", scheduledDate: "2026-09-08", parentId: undefined });
  });
  it("preserves description bullets and their wrapped text without date parsing", () => {
    const draft = parseTaskTreeInput("Plan today\n  - Explain tomorrow p2\n    and next Friday\n  - [ ] Call tomorrow\n    * Ask next Monday", "Inbox.md", now);
    expect(draft.additionalLines).toEqual(["  - Explain tomorrow p2", "    and next Friday", "  - [ ] Call [[2026-09-08]]", "    * Ask next Monday"]);
  });
  it("normalizes tabs, pasted root indentation and CRLF using the configured date format", () => {
    const draft = parseTaskTreeInput("\t- [ ] Main today ~[[Work#Plan]]\r\n\t\t- [ ] Child tomorrow\r\n\t- [ ] Sibling", "Inbox.md", now, "DD/MM/YYYY");
    expect(draft).toMatchObject({ indent: 0, destination: "Work.md#Plan" });
    expect(draft.additionalLines).toEqual(["    - [ ] Child [[08/09/2026]]", "- [ ] Sibling"]);
  });
  it("rejects untitled tasks and conflicting destinations before saving", () => {
    expect(() => parseTaskTreeInput("- [ ]", "Inbox.md", now)).toThrow(/title/);
    expect(() => parseTaskTreeInput("Main\n  - [ ] ", "Inbox.md", now)).toThrow(/line 2/);
    expect(() => parseTaskTreeInput("Main\n- [ ] Next ~[[Elsewhere]]", "Inbox.md", now)).toThrow(/destination/);
  });
});
