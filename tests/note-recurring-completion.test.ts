import { expect, it, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { noteRecurringCompletion } from "../src/note-recurring-completion";

function setup(doc: string, enabled = true) {
    const complete = vi.fn();
    const state = EditorState.create({ doc, extensions: noteRecurringCompletion(() => "YYYY-MM-DD", task => enabled && task.title === "[[Habit]]", complete, () => "Project.md") });
    return { state, complete };
}

it("intercepts the native toggle, retaining an unchecked instance until recurrence is saved", async () => {
    const { state, complete } = setup("- [ ] [[Habit]] 2026-09-19 p1");
    const transaction = state.update({ changes: { from: 3, to: 4, insert: "x" } });
    expect(transaction.newDoc.toString()).toBe(state.doc.toString());
    expect(transaction.effects).toHaveLength(1);
    for (const listener of transaction.state.facet(EditorView.updateListener)) listener({ transactions: [transaction] } as never);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ completed: false, scheduledDate: "2026-09-19", priority: 1 }));
});

it("handles several toggled tasks while keeping ordinary checkbox changes", async () => {
    const { state, complete } = setup("- [ ] [[Habit]] 2026-09-19\n- [ ] Ordinary\n- [ ] [[Habit]] 2026-09-20");
    const changes = [1, 2, 3].map(number => ({ from: state.doc.line(number).from + 3, to: state.doc.line(number).from + 4, insert: "x" }));
    const transaction = state.update({ changes });
    expect(transaction.newDoc.toString()).toBe("- [ ] [[Habit]] 2026-09-19\n- [x] Ordinary\n- [ ] [[Habit]] 2026-09-20");
    for (const listener of transaction.state.facet(EditorView.updateListener)) listener({ transactions: [transaction] } as never);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledTimes(2);
});

it.each(["undo", "redo"])("does not create history during %s", event => {
    const { state } = setup("- [ ] [[Habit]] 2026-09-19");
    const transaction = state.update({ changes: { from: 3, to: 4, insert: "x" }, annotations: Transaction.userEvent.of(event) });
    expect(transaction.effects).toHaveLength(0);
    expect(transaction.newDoc.toString()).toContain("[x]");
});

it("ignores disabled recurrence, unchecking, pasted tasks and fenced examples", () => {
    for (const [doc, enabled, changes] of [
        ["- [ ] [[Habit]] 2026-09-19", false, { from: 3, to: 4, insert: "x" }],
        ["- [x] [[Habit]] 2026-09-19", true, { from: 3, to: 4, insert: " " }],
        ["", true, { from: 0, insert: "- [x] [[Habit]] 2026-09-19" }],
        ["```\n- [ ] [[Habit]] 2026-09-19\n```", true, { from: 7, to: 8, insert: "x" }]
    ] as const) {
        const { state } = setup(doc, enabled);
        expect(state.update({ changes }).effects).toHaveLength(0);
    }
});
