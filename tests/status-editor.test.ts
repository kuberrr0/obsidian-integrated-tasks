import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { noteRecurringCompletion } from "../src/note-recurring-completion";
import { noteDateInput } from "../src/note-date-input";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 27, 12)); });
afterEach(() => { vi.useRealTimers(); });

describe("checkbox changes in notes", () => {
  function setup(doc: string) {
    const complete = vi.fn();
    const state = EditorState.create({ doc, extensions: noteRecurringCompletion(() => "YYYY-MM-DD", task => task.title === "[[Habit]]", complete, () => "Project.md",
      { enabled: () => true, linkDates: () => false }) });
    return { state, complete };
  }
  const mark = (state: EditorState, line: number, char: string) =>
    state.update({ changes: { from: state.doc.line(line).from + 3, to: state.doc.line(line).from + 4, insert: char } });

  it("completes a repeating task checked from in progress or waiting, keeping its status until it advances", async () => {
    const { state, complete } = setup("- [/] [[Habit]] 2026-09-19\n- [?] [[Habit]] 2026-09-20");
    const transaction = state.update({ changes: [1, 2].map(line => ({ from: state.doc.line(line).from + 3, to: state.doc.line(line).from + 4, insert: "x" })) });
    expect(transaction.newDoc.toString()).toBe(state.doc.toString());
    for (const listener of transaction.state.facet(EditorView.updateListener)) listener({ transactions: [transaction] } as never);
    await Promise.resolve();
    expect(complete.mock.calls.map(([task]) => [task.status, task.raw])).toEqual([["doing", "- [/] [[Habit]] 2026-09-19"], ["waiting", "- [?] [[Habit]] 2026-09-20"]]);
  });

  it("stamps a completion date only on a change to done, and removes it when a done task changes status", () => {
    const { state } = setup("- [/] Draft\n- [x] Paid ✓2026-09-20\n- [ ] Plan\n- [-] Dropped");
    expect(mark(state, 1, "x").newDoc.line(1).text).toBe("- [x] Draft ✓2026-09-27");
    expect(mark(state, 2, "-").newDoc.line(2).text).toBe("- [-] Paid");
    expect(mark(state, 2, "/").newDoc.line(2).text).toBe("- [/] Paid");
    expect(mark(state, 3, "/").newDoc.line(3).text).toBe("- [/] Plan");
    expect(mark(state, 3, "-").newDoc.line(3).text).toBe("- [-] Plan");
    expect(mark(state, 4, "x").newDoc.line(4).text).toBe("- [x] Dropped ✓2026-09-27");
    // Obsidian's own click on `[/]` writes `[ ]`: neither a completion nor a reopening.
    expect(mark(state, 1, " ").newDoc.line(1).text).toBe("- [ ] Draft");
  });
});

describe("date input on edited lines", () => {
  const create = (doc: string) => EditorState.create({ doc, selection: { anchor: 0 }, extensions: [noteDateInput(() => "YYYY-MM-DD", () => false, () => false)] });
  function editEnd(doc: string): string {
    let state = create(doc);
    const end = state.doc.line(1).to;
    state = state.update({ selection: { anchor: end } }).state;
    state = state.update({ changes: { from: end, insert: " tomorrow" }, selection: { anchor: end + 9 }, userEvent: "input.type" }).state;
    return state.update({ selection: { anchor: state.doc.length } }).state.doc.line(1).text;
  }

  it("resolves dates on open statuses only", () => {
    expect(editEnd("- [/] Call Sam\n")).toBe("- [/] Call Sam 2026-09-28");
    expect(editEnd("- [?] Call Sam\n")).toBe("- [?] Call Sam 2026-09-28");
    expect(editEnd("- [-] Call Sam\n")).toBe("- [-] Call Sam tomorrow");
    expect(editEnd("- [x] Call Sam\n")).toBe("- [x] Call Sam tomorrow");
  });
});
