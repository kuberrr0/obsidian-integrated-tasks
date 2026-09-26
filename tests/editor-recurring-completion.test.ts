import { beforeEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
vi.mock("../src/parser", async importOriginal => {
  const original = await importOriginal<typeof import("../src/parser")>();
  return { ...original, scanTasks: vi.fn(original.scanTasks) };
});
import { scanTasks } from "../src/parser";
import { noteRecurringCompletion } from "../src/note-recurring-completion";
import type { Task } from "../src/types";

beforeEach(() => { vi.mocked(scanTasks).mockClear(); });

function setup(doc: string) {
  const isRecurring = vi.fn((task: Task) => task.title === "[[Habit]]");
  const state = EditorState.create({ doc, extensions: noteRecurringCompletion(() => "YYYY-MM-DD", isRecurring, vi.fn(), () => "Project.md") });
  return { state, isRecurring };
}
const check = (state: EditorState, line: number) => state.update({ changes: { from: state.doc.line(line).from + 3, to: state.doc.line(line).from + 4, insert: "x" } });

it("checks an ordinary task with a single-line parse and no note scan", () => {
  const doc = ["# Tasks", ...Array.from({ length: 50 }, (_, index) => `- [ ] Task ${index} 2026-09-19 p2`)].join("\n");
  const { state, isRecurring } = setup(doc);
  const transaction = check(state, 10);
  expect(transaction.newDoc.line(10).text).toBe("- [x] Task 8 2026-09-19 p2");
  expect(scanTasks).not.toHaveBeenCalled();
  expect(isRecurring).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    path: "Project.md", line: 9, raw: "- [ ] Task 8 2026-09-19 p2", title: "Task 8", scheduledDate: "2026-09-19", priority: 2, completed: false
  }));
});

it("scans the note only when a checked task is recurring", () => {
  const { state } = setup("# Tasks\n- [ ] Ordinary\n- [ ] [[Habit]] 2026-09-19");
  const transaction = check(state, 3);
  expect(transaction.newDoc.toString()).toBe(state.doc.toString());
  expect(transaction.effects).toHaveLength(1);
  expect(scanTasks).toHaveBeenCalledTimes(2);
  expect(transaction.effects[0].value).toEqual([expect.objectContaining({ title: "[[Habit]]", section: "Tasks", completed: false })]);
});

it("does not parse lines that were not checked", () => {
  const { state, isRecurring } = setup("- [ ] [[Habit]] 2026-09-19");
  state.update({ changes: { from: state.doc.length, insert: " p1" } });
  expect(isRecurring).not.toHaveBeenCalled();
  expect(scanTasks).not.toHaveBeenCalled();
});
