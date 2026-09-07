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
