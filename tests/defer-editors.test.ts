import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn()
}));
import { EditorState } from "@codemirror/state";
import { noteDateChanges, noteDateInput } from "../src/note-date-input";

const US = "MMM D, YYYY";
const reference = new Date(2026, 8, 8, 12);
afterEach(() => vi.useRealTimers());


/** The caret ends on the last line, which the user has just typed (only edited lines are resolved). */
function typed(line: string, linkDates = true, format = "YYYY-MM-DD") {
  vi.useFakeTimers();
  vi.setSystemTime(reference);
  const editor = EditorState.create({ doc: line.slice(0, -1), selection: { anchor: line.length - 1 }, extensions: [noteDateInput(() => format, () => false, () => linkDates)] });
  return editor.update({ changes: { from: line.length - 1, insert: line.slice(-1) }, selection: { anchor: line.length }, userEvent: "input.type" }).state;
}
const leave = (editor: EditorState) => editor.update({ changes: { from: editor.doc.length, insert: "\n" }, selection: { anchor: editor.doc.length + 1 }, userEvent: "input" }).state.doc.toString();

describe("typing a defer in notes", () => {
  it("converts natural language when the caret leaves the edited line", () => {
    expect(leave(typed("- [ ] Renew passport >tomorrow"))).toBe("- [ ] Renew passport >[[2026-09-09]]\n");
    expect(leave(typed("- [ ] Renew passport >next monday", false, US))).toBe("- [ ] Renew passport >Sep 14, 2026\n");
  });
  it("keeps someday, date links and unrecognized text", () => {
    for (const line of ["- [ ] Learn Rust >someday", "- [ ] Renew >[[2026-10-01]]", "- [ ] a > b", "- [ ] Compare >maybe", "- [ ] Call >tomorrow 9am"]) {
      expect(leave(typed(line))).toBe(`${line}\n`);
    }
  });
  it("orders a defer after the deadline and still resolves the title's date", () => {
    expect(leave(typed("- [ ] Plan today >next week p2 {friday} #[[work]]"))).toBe("- [ ] Plan [[2026-09-08]] {[[2026-09-11]]} >[[2026-09-15]] p2 #[[work]]\n");
  });
  it("never converts completed tasks or lines the caret merely passes", () => {
    expect(leave(typed("- [x] Done >tomorrow"))).toBe("- [x] Done >tomorrow\n");
    expect(noteDateChanges("- [ ] Renew >tomorrow", "YYYY-MM-DD", reference, true)).toEqual([{ from: 13, to: 21, insert: "[[2026-09-09]]" }]);
    const editor = EditorState.create({ doc: "- [ ] Renew >tomorrow\n", selection: { anchor: 3 }, extensions: [noteDateInput(() => "YYYY-MM-DD", () => false)] });
    expect(editor.update({ selection: { anchor: editor.doc.length } }).state.doc.toString()).toBe("- [ ] Renew >tomorrow\n");
  });
});
