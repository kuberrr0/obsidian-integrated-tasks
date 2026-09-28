import { EditorState, StateEffect, Transaction, type Extension, type ChangeSpec, type Line } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { todayIso } from "./date";
import { parseTaskLine, scanTasks, withCompletedDate } from "./parser";
import { nonBodyLines } from "./structure";
import type { Task } from "./types";

const recurringCompletion = StateEffect.define<Task[]>();

/** Record completion dates on checkbox flips; off unless `enabled` says so. */
export interface NoteCompletionDates { enabled: () => boolean; linkDates: () => boolean }

/** Cheap line-level precheck: old task lines whose checkbox alone an edit flipped, and in which direction. */
function flippedLines(transaction: Transaction): Array<{ line: Line; checked: boolean }> {
    const oldDoc = transaction.startState.doc;
    const lines: Array<{ line: Line; checked: boolean }> = [];
    transaction.changes.iterChangedRanges((fromA, toA) => {
        const last = oldDoc.lineAt(toA).number;
        for (let number = oldDoc.lineAt(fromA).number; number <= last; number++) {
            const oldLine = oldDoc.line(number);
            const box = /^\s*-\s+\[([ xX])\]/.exec(oldLine.text);
            if (!box || lines.some(entry => entry.line.number === number)) continue;
            const newText = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from)).text;
            const checked = box[1] === " ";
            const unmarked = (text: string): string => text.replace(/^(\s*-\s+\[)[ xX](\])/, "$1 $2");
            const flipped = checked ? /^\s*-\s+\[[xX]\]/.test(newText) : /^\s*-\s+\[ \]/.test(newText);
            if (flipped && unmarked(newText) === unmarked(oldLine.text)) lines.push({ line: oldLine, checked });
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

/** The smallest change turning `before` into `after`, so the caret and other edits keep their place. */
function lineChange(from: number, before: string, after: string): ChangeSpec {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    return { from: from + start, to: from + before.length - end, insert: after.slice(start, after.length - end) };
}

/**
 * Catch native checkbox commands (and typed checks) without persisting a checked instance of a
 * repeating task; with completion dates on, stamp other checked tasks and unstamp reopened ones.
 */
export function noteRecurringCompletion(
    getDateFormat: () => string,
    isRecurring: (task: Task) => boolean,
    complete: (task: Task) => void,
    getPath: (state: EditorState) => string | undefined = state => state.field(editorInfoField, false)?.file?.path,
    completionDates?: NoteCompletionDates
): Extension {
    return [
        EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
            const path = getPath(transaction.startState);
            if (!path) return transaction;
            const flipped = flippedLines(transaction);
            if (!flipped.length) return transaction;
            const checked = flipped.filter(entry => entry.checked).map(entry => entry.line);
            // Parse only the checked lines first; ordinary (non-recurring) checks never scan the whole note.
            const reference = new Date();
            const recurringLines = new Set(checked.filter(line => {
                const task = lineTask(path, line, getDateFormat(), reference);
                return task !== undefined && isRecurring(task);
            }).map(line => line.number - 1));
            const tasks: Task[] = [];
            const changes: ChangeSpec[] = [];
            const reverted = new Set<number>();
            const previous = recurringLines.size ? scanTasks(path, transaction.startState.doc.toString(), reference, getDateFormat())
                .filter(task => recurringLines.has(task.line)) : [];
            if (previous.length) {
                const current = new Map(scanTasks(path, transaction.newDoc.toString(), reference, getDateFormat())
                    .filter(candidate => candidate.completed).map(candidate => [candidate.line, candidate]));
                for (const task of previous) {
                    if (task.completed) continue;
                    const oldLine = transaction.startState.doc.line(task.line + 1);
                    const mapped = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from));
                    const checkedTask = current.get(mapped.number - 1);
                    if (!checkedTask) continue;
                    const raw = checkedTask.raw.replace(/^(\s*-\s+\[)[xX](\])/, "$1 $2");
                    // Only checkbox transitions; pasted/replaced task content is not completion.
                    if (raw !== task.raw) continue;
                    const marker = /^\s*-\s+\[/.exec(checkedTask.raw)!;
                    changes.push({ from: mapped.from + marker[0].length, to: mapped.from + marker[0].length + 1, insert: " " });
                    tasks.push({ ...checkedTask, completed: false, raw });
                    reverted.add(task.line);
                }
            }
            // Repeating tasks are never checked, so they are never stamped; remote changes are not the user's.
            if (completionDates?.enabled() && !transaction.annotation(Transaction.remote)) {
                const candidates = flipped.filter(entry => !reverted.has(entry.line.number - 1) && !recurringLines.has(entry.line.number - 1));
                const nonBody = candidates.length ? nonBodyLines(transaction.newDoc.iterLines()) : new Set<number>();
                const today = todayIso(reference);
                for (const { line, checked: completing } of candidates) {
                    const mapped = transaction.newDoc.lineAt(transaction.changes.mapPos(line.from));
                    if (nonBody.has(mapped.number - 1)) continue;
                    const parsed = parseTaskLine(mapped.text, reference, getDateFormat());
                    if (!parsed || (completing ? parsed.completedDate : !parsed.completedDate)) continue;
                    const next = withCompletedDate(mapped.text, completing ? today : undefined, getDateFormat(), completionDates.linkDates(), reference);
                    if (next !== mapped.text) changes.push(lineChange(mapped.from, mapped.text, next));
                }
            }
            if (!changes.length) return transaction;
            return [transaction, { changes, ...(tasks.length ? { effects: recurringCompletion.of(tasks) } : {}), sequential: true }];
        }),
        EditorView.updateListener.of(update => {
            const tasks = update.transactions.flatMap(transaction => transaction.effects
                .filter(effect => effect.is(recurringCompletion)).flatMap(effect => effect.value));
            if (tasks.length) void Promise.resolve().then(() => tasks.forEach(task => complete(task)));
        })
    ];
}
