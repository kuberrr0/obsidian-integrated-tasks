import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { noteDateInput } from "../src/note-date-input";

const today = new Date(2026, 8, 8, 12);
afterEach(() => vi.useRealTimers());
function state(line: string, mode = false, format = "YYYY-MM-DD") {
  vi.useFakeTimers();
  vi.setSystemTime(today);
  return EditorState.create({ doc: line, selection: { anchor: line.length }, extensions: [noteDateInput(() => format, () => mode)] });
}
function enter(editor: EditorState) {
  const end = editor.doc.length;
  return editor.update({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 }, userEvent: "input" }).state;
}
it("converts scheduled and multiword deadline dates on Enter and maps the caret", () => {
  const result = enter(state("- [ ] do this task @today {@next week}"));
  expect(result.doc.toString()).toBe("- [ ] do this task [[2026-09-08]] {[[2026-09-15]]}\n");
  expect(result.selection.main.head).toBe(result.doc.length);
});
it("preserves a date while typing, then converts when moving to another line", () => {
  let editor = state("\n- [ ] Plan @next");
  editor = editor.update({ changes: { from: editor.doc.length, insert: " week" }, selection: { anchor: editor.doc.length + 5 }, userEvent: "input" }).state;
  expect(editor.doc.toString()).toContain("@next week");
  editor = editor.update({ selection: { anchor: 0 } }).state;
  expect(editor.doc.toString()).toBe("\n- [ ] Plan [[2026-09-15]]");
});
it("uses the Daily Notes format", () => {
  expect(enter(state("- [ ] Go @today", false, "MMM D, YYYY")).doc.toString()).toBe("- [ ] Go [[Sep 8, 2026]]\n");
});
it.each([
  "- [ ] Email user@today.com `@today` [[@today]] [@today](url) {@someone}",
  "- [ ] Unknown @someone {@next", "Ordinary @today", "```md\n- [ ] Example @today", "---\n- [ ] YAML @today"
])("leaves protected or unrecognized input alone: %s", line => {
  expect(enter(state(line)).doc.toString()).toBe(line + "\n");
});
it("does not convert in task mode or during undo", () => {
  const line = "- [ ] Go @today";
  expect(enter(state(line, true)).doc.toString()).toBe(line + "\n");
  const editor = state(line);
  expect(editor.update({ changes: { from: line.length, insert: "\n" }, selection: { anchor: line.length + 1 }, userEvent: "undo" }).newDoc.toString()).toBe(line + "\n");
});

it("orders resolved task properties and retains both times and tag order", () => {
  const result = enter(state("  - [x] Do this #[[work]] p2 {@next week at noon} 1h @today at 9am #[[home]]"));
  expect(result.doc.toString()).toBe("  - [x] Do this [[2026-09-08]] 09:00 1h {[[2026-09-15]] 12:00} p2 #[[work]] #[[home]]\n");
  expect(result.selection.main.head).toBe(result.doc.length);
});

it("retains existing links, title formatting, and destination when ordering", () => {
  expect(enter(state("\t- [ ] **Keep  this** #[[work]] ~[[Project]] P1 {[[2026-09-20]] 17:00} 45m @today", false, "MMM D, YYYY")).doc.toString())
    .toBe("\t- [ ] **Keep  this** [[Sep 8, 2026]] ~[[Project]] 45m {[[2026-09-20]] 17:00} P1 #[[work]]\n");
});

it("reorders on Enter without an @date expression", () => {
  const line = "- [ ] Task p1 30m [[2026-09-08]]";
  const result = enter(state(line));
  expect(result.doc.toString()).toBe("- [ ] Task [[2026-09-08]] 30m p1\n");
  expect(result.selection.main.head).toBe(result.doc.length);
});

it("reorders on leaving a line but not while moving within it", () => {
  const line = "\n- [ ] Task #[[work]] p2 45m";
  let editor = state(line);
  editor = editor.update({ selection: { anchor: line.length - 1 } }).state;
  expect(editor.doc.toString()).toBe(line);
  editor = editor.update({ selection: { anchor: 0 } }).state;
  expect(editor.doc.toString()).toBe("\n- [ ] Task 45m p2 #[[work]]");
  expect(editor.selection.main.head).toBe(0);
});

it("keeps reordering disabled in task mode and during undo/redo", () => {
  const line = "- [ ] Task p1 30m";
  expect(enter(state(line, true)).doc.toString()).toBe(line + "\n");
  for (const userEvent of ["undo", "redo"]) {
    expect(state(line).update({ changes: { from: line.length, insert: "\n" }, selection: { anchor: line.length + 1 }, userEvent }).newDoc.toString()).toBe(line + "\n");
  }
});
