import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import { noteDateChanges, noteDateInput } from "../src/note-date-input";

const FORMAT = "MMM D, YYYY";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 26, 12)); });
afterEach(() => vi.useRealTimers());

function create(doc: string, anchor = 0, linkDates = true) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [noteDateInput(() => FORMAT, () => false, () => linkDates)] });
}
const select = (state: EditorState, anchor: number) => state.update({ selection: { anchor } }).state;
const type = (state: EditorState, at: number, text: string, userEvent = "input.type") =>
  state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent }).state;
/** Type text at the end of a line, then click the start of the document. */
function editLine(doc: string, lineNumber: number, text: string, at?: number) {
  let state = create(doc);
  const line = state.doc.line(lineNumber);
  state = select(state, line.to);
  state = type(state, at ?? line.to, text);
  return select(state, state.doc.length === state.doc.line(lineNumber).to ? 0 : state.doc.length).doc.toString();
}

const repros = [
  "- [ ] Buy sun cream",
  "- [x] Done last Friday",
  "- [ ] Read chapter 5/10",
  "- [ ] Water the plants every Friday",
  "- [ ] Call mom tomorrow",
  "- [ ] Task p1 30m [[2026-09-08]]"
];

describe("noteDateInput only resolves lines the user edited", () => {
  it("never changes untouched lines while the caret passes through them", () => {
    const doc = ["# Notes", ...repros, "Last line"].join("\n");
    let state = create(doc);
    for (let number = 1; number <= state.doc.lines; number++) {
      state = select(state, state.doc.line(number).from + 3);
      state = select(state, state.doc.line(number).to);
    }
    for (let number = state.doc.lines; number >= 1; number--) state = select(state, state.doc.line(number).from);
    expect(state.doc.toString()).toBe(doc);
  });

  it("does not resolve a line when Enter is pressed at its end without editing it", () => {
    const state = create("- [ ] Call mom tomorrow", 23);
    const next = state.update({ changes: { from: 23, insert: "\n- [ ] " }, selection: { anchor: 30 }, userEvent: "input" }).state;
    expect(next.doc.toString()).toBe("- [ ] Call mom tomorrow\n- [ ] ");
  });

  it("forgets edits made before the caret entered a line (a multi-line paste)", () => {
    let state = create("x");
    state = type(state, 0, "- [ ] Call mom tomorrow\n", "input.paste");
    expect(state.selection.main.head).toBe(24);
    state = select(state, 5);
    state = select(state, state.doc.length);
    expect(state.doc.toString()).toBe("- [ ] Call mom tomorrow\nx");
  });

  it("ignores programmatic and undo/redo changes", () => {
    for (const userEvent of [undefined, "undo", "redo"]) {
      let state = create("- [ ] Pay rent\nnext", 14);
      state = state.update({ changes: { from: 14, insert: " tomorrow" }, ...(userEvent ? { userEvent } : {}) }).state;
      expect(select(state, state.doc.length).doc.toString()).toBe("- [ ] Pay rent tomorrow\nnext");
    }
  });

  it("converts a typed trailing date, before metadata tokens, when the caret leaves", () => {
    expect(editLine("- [ ] Pay rent\nnext", 1, " tomorrow")).toBe("- [ ] Pay rent [[Sep 27, 2026]]\nnext");
    expect(editLine("- [ ] Pay rent p2 #[[home]] ~[[Flat#Bills]]\nnext", 1, " tomorrow", 14))
      .toBe("- [ ] Pay rent [[Sep 27, 2026]] p2 #[[home]] ~[[Flat#Bills]]\nnext");
    expect(editLine("next\n- [ ] Call", 2, " next friday 5pm")).toMatch(/^next\n- \[ \] Call \[\[Oct \d+, 2026\]\] 17:00$/);
  });

  it("processes an edited line only once, and never completed tasks", () => {
    let state = create("- [ ] Pay rent\n- [x] Done\nnext", 14);
    state = type(state, 14, " tomorrow");
    state = select(state, state.doc.length);
    expect(state.doc.line(1).text).toBe("- [ ] Pay rent [[Sep 27, 2026]]");
    // Rewriting the link back to prose from elsewhere (not a user edit) is left alone on the next pass.
    state = state.update({ changes: { from: 15, to: state.doc.line(1).to, insert: "today" } }).state;
    state = select(state, 3);
    state = select(state, state.doc.length);
    expect(state.doc.line(1).text).toBe("- [ ] Pay rent today");
    expect(editLine("- [x] Done\nnext", 1, " last Friday")).toBe("- [x] Done last Friday\nnext");
    expect(editLine("- [X] Done p1 30m\nnext", 1, " tomorrow")).toBe("- [X] Done p1 30m tomorrow\nnext");
  });

  it.each([
    ["- [ ] Buy sun", " cream"],
    ["- [ ] Wear", " sun"],
    ["- [ ] Eat", " 1/2"],
    ["- [ ] Read chapter", " 5/10"],
    ["- [ ] Water the plants", " every Friday"],
    ["- [ ] Done", " last Friday"],
    ["- [ ] Review", " past Monday"],
    ["- [ ] Call mom tomorrow", " about the trip"],
    ["- [ ] Go", " @tomorrow"]
  ])("keeps edited prose that is not a trailing schedule: %s + %s", (doc, text) => {
    expect(editLine(`${doc}\nnext`, 1, text)).toBe(`${doc}${text}\nnext`);
  });
});

describe("noteDateChanges", () => {
  const reference = new Date(2026, 8, 26, 12);
  const changes = (text: string, format = FORMAT) => noteDateChanges(text, format, reference);

  it("only reads the trailing prose expression, masking metadata tokens", () => {
    expect(changes("- [ ] Pay rent tomorrow p2 #[[home]]")).toEqual([{ from: 15, to: 23, insert: "[[Sep 27, 2026]]" }]);
    expect(changes("- [ ] Pay tomorrow rent")).toEqual([]);
    expect(changes("- [ ] Meet tomorrow [[Mom]]")).toEqual([]);
    expect(changes("- [ ] Pay rent tomorrow [[Sep 30, 2026]]")).toEqual([]);
  });

  it("accepts a fraction only when it is the configured date format", () => {
    expect(changes("- [ ] Eat 1/2", "D/M")).toEqual([{ from: 10, to: 13, insert: "[[1/2]]" }]);
    expect(changes("- [ ] Eat 1/2", "DD/MM/YYYY")).toEqual([]);
  });

  it("converts explicit deadline braces only after whitespace", () => {
    expect(changes("- [ ] Report {tomorrow}")).toEqual([{ from: 14, to: 22, insert: "[[Sep 27, 2026]]" }]);
    expect(changes("- [ ] Report x{tomorrow}")).toEqual([]);
  });

  it("has no @ date syntax", () => {
    expect(changes("- [ ] Go @today")).toEqual([]);
    expect(changes("- [ ] Go {@today}")).toEqual([]);
    for (const file of ["note-date-input.ts", "date.ts", "task-editor.ts", "task-input.ts", "task-line-editor.ts"]) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/"@"|\^@|@ marker|@today|@date/);
    }
  });
});

describe("Link tags in notes", () => {
  const leave = (doc: string, text: string, linkTags: boolean) => {
    let state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [noteDateInput(() => FORMAT, () => false, () => true, () => linkTags)] });
    const line = state.doc.line(1);
    state = state.update({ selection: { anchor: line.to } }).state;
    state = state.update({ changes: { from: line.to, insert: text }, selection: { anchor: line.to + text.length }, userEvent: "input.type" }).state;
    return state.update({ selection: { anchor: state.doc.length } }).state.doc.toString();
  };

  it("reads dates the same with Link tags off, moving a date after plain tags so it stays the schedule", () => {
    expect(leave("- [ ] Buy milk\nNext", " tomorrow #errand", false)).toBe("- [ ] Buy milk #errand [[Sep 27, 2026]]\nNext");
    expect(leave("- [ ] Buy milk\nNext", " #errand tomorrow", false)).toBe("- [ ] Buy milk #errand [[Sep 27, 2026]]\nNext");
    expect(leave("- [ ] Buy milk\nNext", " tomorrow #errand p1 {friday}", false)).toBe("- [ ] Buy milk #errand [[Sep 27, 2026]] {[[Oct 2, 2026]]} p1\nNext");
    expect(noteDateChanges("- [ ] Buy milk tomorrow #errand", FORMAT)).toEqual([
      { from: 14, to: 23, insert: "" }, { from: 31, to: 31, insert: " [[Sep 27, 2026]]" }
    ]);
    // Only a date that ends the prose moves; a date inside it stays prose.
    expect(leave("- [ ] Call\nNext", " #mom tomorrow about dinner", false)).toBe("- [ ] Call #mom tomorrow about dinner\nNext");
  });

  it("turns plain tags into task tags when leaving an edited task line, only with the setting on", () => {
    expect(leave("- [ ] Call #mom about dinner\nNext", " tomorrow", true)).toBe("- [ ] Call about dinner [[Sep 27, 2026]] #[[mom]]\nNext");
    expect(leave("- [ ] Call #mom about dinner\nNext", " soon", false)).toBe("- [ ] Call #mom about dinner soon\nNext");
  });

  it("leaves lines the caret only passes through", () => {
    let state = EditorState.create({ doc: "- [ ] Call #mom\nNext", selection: { anchor: 0 }, extensions: [noteDateInput(() => FORMAT, () => false, () => true, () => true)] });
    state = state.update({ selection: { anchor: 8 } }).state;
    state = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(state.doc.toString()).toBe("- [ ] Call #mom\nNext");
  });
});
