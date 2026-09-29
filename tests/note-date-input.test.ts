import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { noteDateInput } from "../src/note-date-input";
import { setTagFormat } from "../src/task-tags";

const today = new Date(2026, 8, 8, 12);
afterEach(() => vi.useRealTimers());
/** The caret ends on the last line, which the user has just typed (only edited lines are resolved). */
function state(line: string, mode = false, format = "YYYY-MM-DD", linkDates = true) {
  vi.useFakeTimers();
  vi.setSystemTime(today);
  const editor = EditorState.create({ doc: line.slice(0, -1), selection: { anchor: line.length - 1 }, extensions: [noteDateInput(() => format, () => mode, () => linkDates)] });
  return editor.update({ changes: { from: line.length - 1, insert: line.slice(-1) }, selection: { anchor: line.length }, userEvent: "input.type" }).state;
}
function enter(editor: EditorState) {
  const end = editor.doc.length;
  return editor.update({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 }, userEvent: "input" }).state;
}
it("converts scheduled and multiword deadline dates on Enter and maps the caret", () => {
  const result = enter(state("- [ ] do this task today {next week}"));
  expect(result.doc.toString()).toBe("- [ ] do this task [[2026-09-08]] {[[2026-09-15]]}\n");
  expect(result.selection.main.head).toBe(result.doc.length);
});
it("preserves a date while typing, then converts when moving to another line", () => {
  let editor = state("\n- [ ] Plan next");
  editor = editor.update({ changes: { from: editor.doc.length, insert: " week" }, selection: { anchor: editor.doc.length + 5 }, userEvent: "input" }).state;
  expect(editor.doc.toString()).toContain("next week");
  editor = editor.update({ selection: { anchor: 0 } }).state;
  expect(editor.doc.toString()).toBe("\n- [ ] Plan [[2026-09-15]]");
});
it("uses the Daily Notes format", () => {
  expect(enter(state("- [ ] Go today", false, "MMM D, YYYY")).doc.toString()).toBe("- [ ] Go [[Sep 8, 2026]]\n");
});
it.each([
  "- [ ] Email user@today.com `today` [[today]] [today](url) {someone}",
  "- [ ] Unknown someone {next", "Ordinary today", "```md\n- [ ] Example today", "---\n- [ ] YAML today"
])("leaves protected or unrecognized input alone: %s", line => {
  expect(enter(state(line)).doc.toString()).toBe(line + "\n");
});
it("does not convert in task mode or during undo", () => {
  const line = "- [ ] Go today";
  expect(enter(state(line, true)).doc.toString()).toBe(line + "\n");
  const editor = state(line);
  expect(editor.update({ changes: { from: line.length, insert: "\n" }, selection: { anchor: line.length + 1 }, userEvent: "undo" }).newDoc.toString()).toBe(line + "\n");
});

it("orders resolved task properties and retains both times and tag order", () => {
  const result = enter(state("  - [ ] Do this #[[work]] p2 {next week at noon} 1h today at 9am #[[home]]"));
  expect(result.doc.toString()).toBe("  - [ ] Do this [[2026-09-08]] 09:00 1h {[[2026-09-15]] 12:00} p2 #[[work]] #[[home]]\n");
  expect(result.selection.main.head).toBe(result.doc.length);
});

it("retains existing links, title formatting, and destination when ordering", () => {
  expect(enter(state("\t- [ ] **Keep  this** #[[work]] ~[[Project]] P1 {[[2026-09-20]] 17:00} 45m today", false, "MMM D, YYYY")).doc.toString())
    .toBe("\t- [ ] **Keep  this** [[Sep 8, 2026]] ~[[Project]] 45m {[[2026-09-20]] 17:00} P1 #[[work]]\n");
});

it("reorders on Enter without a date expression", () => {
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

it("resolves unmarked dates, choosing only the last date in each category", () => {
  const line = "- [ ] this is a task that was given to me yesterday tomorrow {next week} {next sunday}";
  const resolved = "- [ ] this is a task that was given to me yesterday [[2026-09-09]] {next week} {[[2026-09-20]]}\n";
  expect(enter(state(line)).doc.toString()).toBe(resolved);
  expect(enter(state(resolved.trimEnd())).doc.toString()).toBe(resolved);
});

it("accepts unmarked dates and preserves time and link-date preferences", () => {
  expect(enter(state("- [ ] Task today at 9am {next sunday at noon}")).doc.toString())
    .toBe("- [ ] Task [[2026-09-08]] 09:00 {[[2026-09-20]] 12:00}\n");
  const result = enter(state("- [ ] Task yesterday tomorrow {next week} {next sunday}", false, "DD.MM.YYYY", false)).doc.toString();
  expect(result).toBe("- [ ] Task yesterday 09.09.2026 {next week} {20.09.2026}\n");
  expect(enter(state(result.trimEnd(), false, "DD.MM.YYYY", false)).doc.toString()).toBe(result);
});

it("keeps protected dates and durations unchanged", () => {
  const line = "- [ ] Task `today` #[[tomorrow]] ~[[Friday]] [Sunday](url) user@today.com 45m";
  expect(enter(state(line)).doc.toString()).not.toContain("[[2026-");
});

it("reads a date and a time written apart, keeping the protected content between them", () => {
  const result = enter(state("- [ ] Task tomorrow #[[work]] at 9am {next week}"));
  expect(result.doc.toString()).toBe("- [ ] Task [[2026-09-09]] 09:00 {[[2026-09-15]]} #[[work]]\n");
});

it("reads properties typed in any order, then sorts them", () => {
  setTagFormat("hash");
  try {
    const result = enter(state("- [ ] do this tomorrow {sunday} 5m 9:30pm p2 #call"));
    expect(result.doc.toString()).toBe("- [ ] do this [[2026-09-09]] 21:30 5m {[[2026-09-13]]} p2 #call\n");
    expect(enter(state("- [ ] Water 9:30pm p1 tomorrow")).doc.toString()).toBe("- [ ] Water [[2026-09-09]] 21:30 p1\n");
  } finally { setTagFormat("wikilink"); }
  setTagFormat("hash");
  try {
    // A repeat among the properties, and a time written apart from an existing date.
    expect(enter(state("- [ ] do this tomorrow every monday {sunday} 5m 9:30pm p2 #call")).doc.toString())
      .toBe("- [ ] do this [[2026-09-09]] 21:30 5m every monday {[[2026-09-13]]} p2 #call\n");
    expect(enter(state("- [ ] do this [[2026-10-01]] every monday 21:30 5m {[[2026-10-04]]} p2 #call")).doc.toString())
      .toBe("- [ ] do this [[2026-10-01]] 21:30 5m every monday {[[2026-10-04]]} p2 #call\n");
  } finally { setTagFormat("wikilink"); }
  // With #[[tag]] tags, a plain #tag is prose, so the date follows it to stay the schedule.
  expect(enter(state("- [ ] do this tomorrow {sunday} 5m 9:30pm p2 #call")).doc.toString())
    .toBe("- [ ] do this {[[2026-09-13]]} 5m p2 #call [[2026-09-09]] 21:30\n");
  // A date inside the title's prose stays prose.
  expect(enter(state("- [ ] Call #mom tomorrow about dinner")).doc.toString()).toBe("- [ ] Call #mom tomorrow about dinner\n");
});
