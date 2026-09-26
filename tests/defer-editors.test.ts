import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn()
}));
import { EditorState } from "@codemirror/state";
import { bulkInlinePatch, bulkInlineText, bulkPropertyPatch, bulkPropertyValues, commonBulkValues } from "../src/bulk-task-editor";
import { noteDateChanges, noteDateInput } from "../src/note-date-input";
import { inlineTaskTokens, taskMetadataStart, taskModeEditorText } from "../src/task-line-editor";
import { taskTokens, tokenClass } from "../src/task-tokens";
import { noteTaskPresentation } from "../src/note-task-presentation";
import { noteTokenMarks } from "../src/note-token-editor";
import { TASK_PROPERTY_ICONS } from "../src/task-property-icons";
import { scanTasks } from "../src/parser";

const US = "MMM D, YYYY";
const reference = new Date(2026, 8, 8, 12);
afterEach(() => vi.useRealTimers());

describe("bulk editor defer", () => {
  const tasks = scanTasks("Work.md", "- [ ] A >2026-10-01\n- [ ] B >someday\n- [ ] C\n- [ ] D >2026-10-01\n");
  it("reads each task's defer and shows only a common value", () => {
    expect(tasks.map(task => bulkPropertyValues(task, US).defer)).toEqual(["Oct 1, 2026", "someday", "", "Oct 1, 2026"]);
    expect(commonBulkValues([tasks[0], tasks[3]], US).defer).toBe("Oct 1, 2026");
    expect("defer" in commonBulkValues(tasks, US)).toBe(false);
  });
  it("patches a date, someday, or a clear", () => {
    expect(bulkPropertyPatch({ defer: "Oct 3, 2026" }, US)).toEqual({ deferDate: "2026-10-03", someday: undefined });
    expect(bulkPropertyPatch({ defer: "friday" }, US, reference)).toEqual({ deferDate: "2026-09-11", someday: undefined });
    expect(bulkPropertyPatch({ defer: "Someday" }, US)).toEqual({ deferDate: undefined, someday: true });
    const cleared = bulkPropertyPatch({ defer: "" }, US);
    expect(cleared).toEqual({ deferDate: undefined, someday: undefined });
    expect("deferDate" in cleared && "someday" in cleared).toBe(true);
    expect(bulkPropertyPatch({}, US)).toEqual({});
    expect(() => bulkPropertyPatch({ defer: "tomorrow 9am" }, US)).toThrow(/hidden-until/);
    expect(() => bulkPropertyPatch({ defer: "maybe" }, US)).toThrow(/hidden-until/);
  });
  it("edits the defer inline, leaving mixed values unchanged", () => {
    const initial = bulkInlineText(commonBulkValues([tasks[0], tasks[3]], US), US);
    expect(initial).toBe(">[[Oct 1, 2026]] ~[[Work]]");
    expect(bulkInlinePatch(">someday p1 ~[[Work]]", initial, US, "Inbox.md")).toEqual({ deferDate: undefined, someday: true, priority: 1 });
    expect(bulkInlinePatch("~[[Work]]", initial, US, "Inbox.md")).toEqual({ deferDate: undefined, someday: undefined });
    const mixed = bulkInlineText(commonBulkValues(tasks, US), US);
    expect(mixed).toBe("~[[Work]]");
    expect(bulkInlinePatch("p2 ~[[Work]]", mixed, US, "Inbox.md")).toEqual({ priority: 2 });
    expect(bulkInlinePatch(">Oct 5, 2026 ~[[Work]]", mixed, US, "Inbox.md")).toEqual({ deferDate: "2026-10-05", someday: undefined });
  });
});

describe("note tokens", () => {
  it("labels a linked defer and displays its formatted date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(reference);
    const line = "- [ ] Renew >[[2026-10-01]] p1";
    const token = taskTokens(line, US).find(item => item.kind === "defer")!;
    expect(line.slice(token.from, token.to)).toBe(">[[2026-10-01]]");
    expect(token).toMatchObject({ label: "Hidden until Oct 1, 2026", description: "Hidden until: Oct 1, 2026", dateLabel: "Oct 1, 2026", linkText: "2026-10-01", active: true });
    expect(line.slice(token.display!.from, token.display!.to)).toBe("[[2026-10-01]]");
    expect(token.display).toMatchObject({ label: "Oct 1, 2026", linkText: "2026-10-01" });
    expect(tokenClass(token)).toBe("tm-note-token tm-note-token-defer is-active");
  });
  it("labels someday and plain dates, displaying only changed text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(reference);
    expect(taskTokens("- [ ] Learn >someday", US)[0]).toMatchObject({ kind: "defer", label: "Someday", active: true });
    const plain = taskTokens("- [ ] Past >Sep 1, 2026", US)[0];
    expect(plain).toMatchObject({ label: "Hidden until Sep 1, 2026", active: false, display: undefined });
    const natural = "- [ ] Later >tomorrow";
    const token = taskTokens(natural, US)[0];
    expect(natural.slice(token.display!.from, token.display!.to)).toBe("tomorrow");
    expect(token.display!.label).toBe("Sep 9, 2026");
  });
  it("presents a relative label after the deadline", () => {
    const presentation = noteTaskPresentation("- [ ] Renew {2026-09-20} >[[2026-09-09]] p2", "YYYY-MM-DD", reference)!;
    expect(presentation.tokens.map(token => token.kind)).toEqual(["deadline", "defer", "priority"]);
    expect(presentation.tokens[1]).toMatchObject({ dateLabel: "Tomorrow", label: "Hidden until Tomorrow", active: true });
    expect(noteTaskPresentation("- [ ] Renew >2026-09-08", "YYYY-MM-DD", reference)!.tokens[0]).toMatchObject({ dateLabel: "Today", active: false });
    expect(noteTaskPresentation("- [ ] Renew >Someday", "YYYY-MM-DD", reference)!.tokens[0]).toMatchObject({ label: "Someday", active: true });
  });
  it("hides the > prefix in Live Preview pills", () => {
    const [token] = taskTokens("- [ ] Learn >someday", US);
    const { syntax } = noteTokenMarks([{ from: 12, to: 20, token }], { from: 0, to: 100 }, []);
    const marks: Array<{ from: number; to: number; cls: string }> = [];
    syntax.between(0, 100, (from, to, value) => { marks.push({ from, to, cls: value.spec.class }); });
    expect(marks).toEqual([{ from: 12, to: 13, cls: "tm-note-token-brace" }]);
    expect(TASK_PROPERTY_ICONS.defer).toBe("eye-off");
  });
  it("keeps defer on the secondary line of the task-mode editor", () => {
    const text = "Renew #[[x]] >2026-10-01 p1 {2026-09-20} [[2026-09-15]]";
    expect(taskModeEditorText(text, "YYYY-MM-DD")).toBe("Renew {2026-09-20} p1 [[2026-09-15]] >2026-10-01 #[[x]]");
    const tokens = inlineTaskTokens("Renew {2026-09-20} >2026-10-01", "YYYY-MM-DD");
    expect(taskMetadataStart(tokens)).toBe("Renew {2026-09-20} ".length);
  });
});

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
