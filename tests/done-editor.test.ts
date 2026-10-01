import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { noteRecurringCompletion } from "../src/note-recurring-completion";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 27, 12)); });
afterEach(() => { vi.useRealTimers(); });

function setup(doc: string, enabled = true, linkDates = false) {
    const complete = vi.fn();
    const state = EditorState.create({ doc, extensions: noteRecurringCompletion(() => "YYYY-MM-DD", task => Boolean(task.repeat), complete, () => "Project.md",
        { enabled: () => enabled, linkDates: () => linkDates }) });
    return { state, complete };
}
const flip = (state: EditorState, line: number, mark: string, extra: Partial<TransactionSpec> = {}) =>
    state.update({ changes: { from: state.doc.line(line).from + 3, to: state.doc.line(line).from + 4, insert: mark }, ...extra });

it("stamps a checked task and unstamps a reopened one", () => {
    const { state } = setup("- [ ] Pay rent p1 ~[[Bills]]\n- [x] Paid ✓2026-09-20 ^p");
    expect(flip(state, 1, "x").newDoc.line(1).text).toBe("- [x] Pay rent p1 ✓2026-09-27 ~[[Bills]]");
    expect(flip(state, 2, " ").newDoc.line(2).text).toBe("- [ ] Paid ^p");
    expect(flip(setup("- [ ] Pay", true, true).state, 1, "X").newDoc.toString()).toBe("- [X] Pay ✓[[2026-09-27]]");
});

it("keeps the caret where it was", () => {
    const { state } = setup("- [ ] Pay rent");
    const transaction = flip(state, 1, "x", { selection: { anchor: 8 } });
    expect(transaction.newDoc.toString()).toBe("- [x] Pay rent ✓2026-09-27");
    expect(transaction.selection?.main.head).toBe(8);
});

it("leaves an existing date, the setting off, undo, redo, remote changes and code blocks alone", () => {
    expect(flip(setup("- [ ] Pay ✓2026-09-01").state, 1, "x").newDoc.toString()).toBe("- [x] Pay ✓2026-09-01");
    expect(flip(setup("- [ ] Pay", false).state, 1, "x").newDoc.toString()).toBe("- [x] Pay");
    expect(flip(setup("- [x] Pay ✓2026-09-01", false).state, 1, " ").newDoc.toString()).toBe("- [ ] Pay ✓2026-09-01");
    for (const annotations of [Transaction.userEvent.of("undo"), Transaction.userEvent.of("redo"), Transaction.remote.of(true)]) {
        expect(flip(setup("- [ ] Pay").state, 1, "x", { annotations }).newDoc.toString()).toBe("- [x] Pay");
    }
    const { state } = setup("```\n- [ ] Pay\n```");
    expect(flip(state, 2, "x").newDoc.line(2).text).toBe("- [x] Pay");
});

it("ignores edits that change more than the checkbox", () => {
    const { state } = setup("- [ ] Pay");
    expect(state.update({ changes: { from: 0, to: state.doc.length, insert: "- [x] Paid" } }).newDoc.toString()).toBe("- [x] Paid");
});

it("reverts and advances an inline repeat instead of checking or stamping it", async () => {
    const { state, complete } = setup("- [ ] Water 2026-09-28 every week\n- [ ] Pay");
    const transaction = state.update({ changes: [1, 2].map(line => ({ from: state.doc.line(line).from + 3, to: state.doc.line(line).from + 4, insert: "x" })) });
    expect(transaction.newDoc.toString()).toBe("- [ ] Water 2026-09-28 every week\n- [x] Pay ✓2026-09-27");
    const { EditorView } = await import("@codemirror/view");
    for (const listener of transaction.state.facet(EditorView.updateListener)) listener({ transactions: [transaction] } as never);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Water", repeat: "every week", scheduledDate: "2026-09-28", completed: false }), "COMPLETED");
});
