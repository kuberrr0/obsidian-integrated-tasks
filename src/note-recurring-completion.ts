import { EditorState, StateEffect, type Extension, type ChangeSpec, type Line, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { parseTaskLine, scanTasks } from "./parser";
import type { Task } from "./types";

const recurringCompletion = StateEffect.define<Task[]>();

/** Cheap line-level precheck: old lines whose open checkbox an edit turned into a checked one. */
function checkedOpenLines(transaction: Transaction): Line[] {
    const oldDoc = transaction.startState.doc;
    const lines: Line[] = [];
    transaction.changes.iterChangedRanges((fromA, toA) => {
        const last = oldDoc.lineAt(toA).number;
        for (let number = oldDoc.lineAt(fromA).number; number <= last; number++) {
            const oldLine = oldDoc.line(number);
            if (!/^\s*-\s+\[ \]/.test(oldLine.text) || lines.some(line => line.number === number)) continue;
            const newText = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from)).text;
            if (newText.replace(/^(\s*-\s+\[)[xX](\])/, "$1 $2") === oldLine.text && newText !== oldLine.text) lines.push(oldLine);
        }
    });
    return lines;
}

/** A single-line Task, enough for the recurrence check (path, line, raw, title and parsed fields). */
function lineTask(path: string, line: Line, dateFormat: string, reference: Date): Task | undefined {
    const parsed = parseTaskLine(line.text, reference, dateFormat);
    if (!parsed) return undefined;
    const { destination: _destination, ...fields } = parsed;
    return { ...fields, id: `${path}:${line.number - 1}`, path, line: line.number - 1, endLine: line.number - 1, raw: line.text, childIds: [] };
}

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
            const checked = checkedOpenLines(transaction);
            if (!checked.length) return transaction;
            // Parse only the checked lines first; ordinary (non-recurring) checks never scan the whole note.
            const reference = new Date();
            const recurringLines = new Set(checked.filter(line => {
                const task = lineTask(path, line, getDateFormat(), reference);
                return task !== undefined && isRecurring(task);
            }).map(line => line.number - 1));
            if (!recurringLines.size) return transaction;
            const previous = scanTasks(path, transaction.startState.doc.toString(), reference, getDateFormat())
                .filter(task => recurringLines.has(task.line));
            if (!previous.length) return transaction;
            const current = new Map(scanTasks(path, transaction.newDoc.toString(), reference, getDateFormat())
                .filter(candidate => candidate.completed).map(candidate => [candidate.line, candidate]));
            const tasks: Task[] = [];
            const changes: ChangeSpec[] = [];
            for (const task of previous) {
                if (task.completed) continue;
                const oldLine = transaction.startState.doc.line(task.line + 1);
                const mapped = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from));
                const checked = current.get(mapped.number - 1);
                if (!checked) continue;
                const raw = checked.raw.replace(/^(\s*-\s+\[)[xX](\])/, "$1 $2");
                // Only checkbox transitions; pasted/replaced task content is not completion.
                if (raw !== task.raw) continue;
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
