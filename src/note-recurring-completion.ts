import { EditorState, StateEffect, type Extension, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { scanTasks } from "./parser";
import type { Task } from "./types";

const recurringCompletion = StateEffect.define<Task[]>();

/** Catch native checkbox commands (and typed checks) without persisting a checked instance. */
export function noteRecurringCompletion(
    getDateFormat: () => string,
    isRecurring: (task: Task) => boolean,
    complete: (task: Task) => void,
    getPath: (state: EditorState) => string | undefined = state => state.field(editorInfoField, false)?.file?.path
): Extension {
    return [
        EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
            const path = getPath(transaction.startState);
            if (!path) return transaction;
            const previous = scanTasks(path, transaction.startState.doc.toString(), new Date(), getDateFormat());
            const current = scanTasks(path, transaction.newDoc.toString(), new Date(), getDateFormat());
            const tasks: Task[] = [];
            const changes: ChangeSpec[] = [];
            for (const task of previous) {
                if (task.completed) continue;
                const oldLine = transaction.startState.doc.line(task.line + 1);
                const mapped = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from));
                const checked = current.find(candidate => candidate.line === mapped.number - 1 && candidate.completed);
                if (!checked) continue;
                const raw = checked.raw.replace(/^(\s*-\s+\[)[xX](\])/, "$1 $2");
                // Only checkbox transitions; pasted/replaced task content is not completion.
                if (raw !== task.raw || !isRecurring(task)) continue;
                const marker = /^\s*-\s+\[/.exec(checked.raw)!;
                changes.push({ from: mapped.from + marker[0].length, to: mapped.from + marker[0].length + 1, insert: " " });
                tasks.push({ ...checked, completed: false, raw });
            }
            return tasks.length ? [transaction, { changes, effects: recurringCompletion.of(tasks), sequential: true }] : transaction;
        }),
        EditorView.updateListener.of(update => {
            const tasks = update.transactions.flatMap(transaction => transaction.effects
                .filter(effect => effect.is(recurringCompletion)).flatMap(effect => effect.value));
            if (tasks.length) void Promise.resolve().then(() => tasks.forEach(task => complete(task)));
        })
    ];
}
