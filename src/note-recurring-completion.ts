import { ChangeSet, EditorState, StateEffect, Transaction, type Extension, type ChangeSpec, type Line } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { todayIso } from "./date";
import { parseTaskLine, scanTasks, withCompletedDate } from "./parser";
import { nonBodyLines } from "./structure";
import { STATUS_CHARS } from "./task-status";
import { placeChangedTasks, type PlacementOptions } from "./completed-placement";
import type { RecurringOutcome } from "./recurring-task";
import type { Task } from "./types";

interface ClosedRecurring { task: Task; outcome: RecurringOutcome }
const recurringCompletion = StateEffect.define<ClosedRecurring[]>();
/** Tasks moved in the note as Settings › Completed tasks says. */
const tasksPlaced = StateEffect.define<null>();

/** Record completion dates on checkbox flips; off unless `enabled` says so. */
export interface NoteCompletionDates { enabled: () => boolean; linkDates: () => boolean }

interface Flip { line: Line; before: string; after: string }
const isDone = (status: string): boolean => /[xX]/.test(status);
const isClosed = (status: string): boolean => /[xX-]/.test(status);

/** Cheap line-level precheck: old task lines whose checkbox status alone an edit changed. */
function flippedLines(transaction: Transaction): Flip[] {
    const oldDoc = transaction.startState.doc;
    const lines: Flip[] = [];
    const box = /^(\s*-\s+\[)([ xX/?-])(\])/;
    const unmarked = (text: string): string => text.replace(box, "$1 $3");
    transaction.changes.iterChangedRanges((fromA, toA) => {
        const last = oldDoc.lineAt(toA).number;
        for (let number = oldDoc.lineAt(fromA).number; number <= last; number++) {
            const oldLine = oldDoc.line(number);
            const before = box.exec(oldLine.text)?.[2];
            if (before === undefined || lines.some(entry => entry.line.number === number)) continue;
            const newText = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from)).text;
            const after = box.exec(newText)?.[2];
            if (after !== undefined && after !== before && unmarked(newText) === unmarked(oldLine.text)) lines.push({ line: oldLine, before, after });
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
 * Catch native checkbox commands (and typed checks or `-`) without persisting a closed instance of a
 * repeating task: it is completed (`[x]`) or cancelled (`[-]`) instead; with completion dates on, stamp other
 * checked tasks and unstamp reopened ones. With `placement` (Settings › Completed tasks), a task checked or unchecked
 * moves in the note as it says. Lines `isTask` turns down (no task tag) are plain checklist items, left as checked.
 */
export function noteRecurringCompletion(
    getDateFormat: () => string,
    isRecurring: (task: Task) => boolean,
    complete: (task: Task, outcome: RecurringOutcome) => void,
    getPath: (state: EditorState) => string | undefined = state => state.field(editorInfoField, false)?.file?.path,
    completionDates?: NoteCompletionDates,
    getSectionHeadingLevel: () => number = () => 1,
    placement: () => Pick<PlacementOptions, "placement" | "section"> | undefined = () => undefined,
    isTask: (text: string) => boolean = () => true
): Extension {
    return [
        EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
            const path = getPath(transaction.startState);
            if (!path) return transaction;
            const flipped = flippedLines(transaction).filter(entry => isTask(entry.line.text));
            if (!flipped.length) return transaction;
            // An open task closed: checked done, or cancelled. Moves between open statuses (Obsidian's own click on `[/]`
            // writes `[ ]`), and from one closed status to the other, close nothing.
            const closing = flipped.filter(entry => !isClosed(entry.before) && isClosed(entry.after));
            const outcomes = new Map(closing.map(entry => [entry.line.number - 1, isDone(entry.after) ? "COMPLETED" as const : "CANCELED" as const]));
            // Parse only the closed lines first; ordinary (non-recurring) checks never scan the whole note.
            const reference = new Date();
            const recurringLines = new Set(closing.map(entry => entry.line).filter(line => {
                const task = lineTask(path, line, getDateFormat(), reference);
                return task !== undefined && isRecurring(task);
            }).map(line => line.number - 1));
            const tasks: ClosedRecurring[] = [];
            const changes: ChangeSpec[] = [];
            const effects: StateEffect<unknown>[] = [];
            const reverted = new Set<number>();
            const previous = recurringLines.size ? scanTasks(path, transaction.startState.doc.toString(), reference, getDateFormat(), getSectionHeadingLevel())
                .filter(task => recurringLines.has(task.line)) : [];
            if (previous.length) {
                const current = new Map(scanTasks(path, transaction.newDoc.toString(), reference, getDateFormat(), getSectionHeadingLevel())
                    .filter(candidate => candidate.completed).map(candidate => [candidate.line, candidate]));
                for (const task of previous) {
                    if (task.completed) continue;
                    const oldLine = transaction.startState.doc.line(task.line + 1);
                    const mapped = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from));
                    const checkedTask = current.get(mapped.number - 1);
                    if (!checkedTask) continue;
                    // Put the open status back (`[/]` stays in progress if completing fails); advancing resets it to `[ ]`.
                    const status = STATUS_CHARS[task.status];
                    const raw = checkedTask.raw.replace(/^(\s*-\s+\[)[xX-](\])/, `$1${status}$2`);
                    // Only checkbox transitions; pasted/replaced task content is not completion.
                    if (raw !== task.raw) continue;
                    const marker = /^\s*-\s+\[/.exec(checkedTask.raw)!;
                    changes.push({ from: mapped.from + marker[0].length, to: mapped.from + marker[0].length + 1, insert: status });
                    tasks.push({ task: { ...checkedTask, status: task.status, completed: false, raw }, outcome: outcomes.get(task.line) ?? "COMPLETED" });
                    reverted.add(task.line);
                }
            }
            // Repeating tasks are never checked, so they are never stamped; remote changes are not the user's.
            if (completionDates?.enabled() && !transaction.annotation(Transaction.remote)) {
                // Only checking (into done) stamps and unchecking (out of it) unstamps.
                const candidates = flipped.filter(entry => isDone(entry.before) !== isDone(entry.after)
                    && !reverted.has(entry.line.number - 1) && !recurringLines.has(entry.line.number - 1))
                    .map(entry => ({ line: entry.line, checked: isDone(entry.after) }));
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
            // Opened or closed (checked done, or cancelled), a task moves where Settings › Completed tasks puts it; one that
            // repeats is put back open above, and stays.
            const moving = transaction.annotation(Transaction.remote) ? undefined : placement();
            const placed = moving && moving.placement !== "keep" ? flipped.filter(entry => isClosed(entry.before) !== isClosed(entry.after)
                && !reverted.has(entry.line.number - 1) && !recurringLines.has(entry.line.number - 1)) : [];
            if (placed.length) {
                const text = transaction.newDoc.toString();
                const stamped = changes.length ? ChangeSet.of(changes, transaction.newDoc.length).apply(transaction.newDoc).toString() : text;
                const nonBody = nonBodyLines(transaction.newDoc.iterLines());
                const lines = placed.map(entry => ({ line: transaction.newDoc.lineAt(transaction.changes.mapPos(entry.line.from)).number - 1, closed: isClosed(entry.after) }))
                    .filter(entry => !nonBody.has(entry.line));
                const next = lines.length ? placeChangedTasks(path, stamped, lines, { ...moving!, sectionHeadingLevel: getSectionHeadingLevel(), dateFormat: getDateFormat() }) : stamped;
                if (next !== stamped) {
                    changes.splice(0, changes.length, lineChange(0, text, next));
                    effects.push(tasksPlaced.of(null));
                }
            }
            if (!changes.length) return transaction;
            if (tasks.length) effects.push(recurringCompletion.of(tasks));
            return [transaction, { changes, effects, sequential: true }];
        }),
        EditorView.updateListener.of(update => {
            const tasks = update.transactions.flatMap(transaction => transaction.effects
                .filter(effect => effect.is(recurringCompletion)).flatMap(effect => effect.value));
            if (tasks.length) void Promise.resolve().then(() => tasks.forEach(({ task, outcome }) => complete(task, outcome)));
            if (update.transactions.some(transaction => transaction.effects.some(effect => effect.is(tasksPlaced)))) showCheckboxesAsWritten(update.view);
        })
    ];
}

/**
 * A clicked checkbox ticks itself before the note says so. When the task it ticked moves away, the editor keeps the
 * checkbox for the task that moved up into its place, still ticked: each checkbox shows its line's status again.
 */
function showCheckboxesAsWritten(view: EditorView): void {
    for (const box of Array.from(view.contentDOM.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox[data-task]"))) {
        box.checked = box.getAttribute("data-task") !== " ";
    }
}
