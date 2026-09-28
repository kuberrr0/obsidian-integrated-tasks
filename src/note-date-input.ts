import { EditorState, StateEffect, StateField, type ChangeSpec, type Transaction } from "@codemirror/state";
import { moment as obsidianMoment } from "obsidian";
import type momentFactory from "moment";
import { formatDate, parseDateTimeExpression } from "./date";
import { parseTaskLine, type ParsedTokenRange } from "./parser";
import { nonBodyLines } from "./structure";

const moment = obsidianMoment as unknown as typeof momentFactory;

/** A bare weekday abbreviation is far more often a word ("sun cream") than a date. */
const WEEKDAY_ABBREVIATION = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$/i;
/** "every Friday" and "last Friday" describe recurrence or the past, not a schedule. */
const NON_SCHEDULE_PREFIX = /^(?:every|each|last|past|previous)$/i;
const PAST_EXPRESSION = /^(?:last|past|previous)\b/i;
const FRACTION = /(?:^|\s)\d{1,2}\/\d{1,2}(?=\s|$)/;
/** Longest trailing expression considered, in words ("a week from next friday at 5pm"). */
const MAX_EXPRESSION_WORDS = 8;

/** Whether a trailing unmarked expression may be read as a date. */
function acceptsExpression(expression: string, previousWord: string, dateFormat: string): boolean {
  if (WEEKDAY_ABBREVIATION.test(expression)) return false;
  if (NON_SCHEDULE_PREFIX.test(previousWord) || PAST_EXPRESSION.test(expression)) return false;
  // "chapter 5/10" is a fraction unless the configured format spells dates exactly that way.
  if (FRACTION.test(expression) && !moment(expression, dateFormat, true).isValid()) return false;
  return true;
}

/**
 * Resolve an unmarked date only at the end of the title prose (after which only metadata tokens
 * may follow), the last `{…}` deadline and a trailing `>…` defer. Existing date links win over earlier prose.
 */
export function noteDateChanges(text: string, dateFormat: string, reference = new Date(), linkDates = true): { from: number; to: number; insert: string }[] {
  type Change = { from: number; to: number; insert: string };
  const blank = (value: string): string => " ".repeat(value.length);
  // Prose that must never be parsed, but still counts as prose (so a date before it is not trailing).
  const opaque = (value: string): string => "\u0001".repeat(value.length);
  const checkbox = /^\s*-\s+\[[ xX/?-]\]\s/.exec(text)?.[0] ?? "";
  const ranges: ParsedTokenRange[] = [];
  parseTaskLine(text, reference, dateFormat, false, ranges);
  const deferRange = ranges.find(range => range.kind === "defer");
  let defer: Change | undefined;
  if (deferRange) {
    const expression = text.slice(deferRange.from + 1, deferRange.to);
    const dateTime = /^someday$|^\[\[/i.test(expression) ? undefined : parseDateTimeExpression(expression, reference, dateFormat);
    const label = dateTime && formatDate(dateTime.date, dateFormat);
    if (label) defer = { from: deferRange.from + 1, to: deferRange.to, insert: linkDates ? `[[${label}]]` : label };
  }
  // A defer, an `every …` repeat and a completion date are never read as a schedule.
  const source = ranges.filter(range => range.kind === "defer" || range.kind === "repeat" || range.kind === "completedDate")
    .reduce((value, range) => value.slice(0, range.from) + blank(value.slice(range.from, range.to)) + value.slice(range.to), text);
  const protectedText = blank(checkbox) + source.slice(checkbox.length)
    .replace(/(`+)[\s\S]*?\1|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\S+@\S+\.\S+/g, opaque);
  const replacement = (expression: string): string | undefined => {
    const dateTime = parseDateTimeExpression(expression.trim(), reference, dateFormat);
    if (!dateTime) return undefined;
    const label = formatDate(dateTime.date, dateFormat);
    return `${linkDates ? `[[${label}]]` : label}${dateTime.time ? ` ${dateTime.time}` : ""}`;
  };
  let deadline: Change | undefined;
  const withoutDeadlines = protectedText.replace(/(^|\s)\{([^{}]*)\}/g, (whole: string, space: string, expression: string, offset: number) => {
    const insert = replacement(expression);
    const from = offset + space.length + 1;
    if (insert !== undefined) deadline = { from, to: from + expression.length, insert: expression.trim().startsWith("[[") ? expression : insert };
    return space + blank(whole.slice(space.length));
  }).replace(/(^|\s)\{[^}]*$/, (whole: string, space: string) => space + blank(whole.slice(space.length)));
  let lastDateLink = 0;
  const prose = withoutDeadlines.replace(/([#~]?)\[\[([^\]]+)\]\](?:\s+\d{2}:\d{2}(?=\s|$))?/g, (whole: string, prefix: string, _target: string, offset: number) => {
    if (prefix) return blank(whole);
    // Existing date links are metadata and win over any earlier prose date; other links are prose.
    if (replacement(whole) === undefined) return opaque(whole);
    lastDateLink = offset + whole.length;
    return blank(whole);
  }).replace(/(^|\s)(?:\d+h(?:\d+m)?|\d+m|[pP][123])(?=\s|$)/g, (whole: string, space: string) => space + blank(whole.slice(space.length)));

  const changes: Change[] = [];
  const end = prose.trimEnd().length;
  const words = [...prose.slice(0, end).matchAll(/\S+/g)].slice(-MAX_EXPRESSION_WORDS);
  // Longest trailing expression wins ("next friday 5pm" over "5pm").
  for (let index = 0; index < words.length; index++) {
    const from = words[index].index ?? 0;
    if (from < lastDateLink) continue;
    const expression = prose.slice(from, end);
    if (expression !== text.slice(from, end)) continue;
    const previousWord = /(\S+)\s*$/.exec(prose.slice(0, from))?.[1] ?? "";
    // Never split an unrecognized `>…` token into prose and a date.
    if (previousWord.startsWith(">")) continue;
    if (!acceptsExpression(expression, previousWord, dateFormat)) continue;
    const insert = replacement(expression);
    if (insert === undefined) continue;
    changes.push({ from, to: end, insert });
    break;
  }
  if (deadline) changes.push(deadline);
  if (defer) changes.push(defer);
  return changes.filter(change => text.slice(change.from, change.to) !== change.insert).sort((a, b) => a.from - b.from);
}

/** Reorder recognized token slots, retaining source spelling, spacing and destinations. */
function orderNoteProperties(text: string, dateFormat: string, reference: Date): string {
  const ranges: ParsedTokenRange[] = [];
  parseTaskLine(text, reference, dateFormat, false, ranges);
  ranges.sort((a, b) => a.from - b.from);
  const order: ParsedTokenRange["kind"][] = ["scheduledDate", "repeat", "durationMinutes", "deadline", "defer", "priority", "tags", "completedDate"];
  const tokens = [...ranges].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(range => text.slice(range.from, range.to));
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    text = text.slice(0, range.from) + tokens[index] + text.slice(range.to);
  }
  return text;
}

const USER_EDIT_EVENTS = ["input", "delete", "move", "paste", "drop"];

function isUserEdit(transaction: Transaction): boolean {
  return transaction.docChanged && !transaction.isUserEvent("undo") && !transaction.isUserEvent("redo")
    && USER_EDIT_EVENTS.some(event => transaction.isUserEvent(event));
}

/** New-document line numbers whose text a transaction changed (not lines merely split off or pushed down). */
function touchedLines(transaction: Transaction): Set<number> {
  const lines = new Set<number>();
  const oldDoc = transaction.startState.doc;
  const doc = transaction.newDoc;
  transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    let first = doc.lineAt(fromB).number;
    let last = doc.lineAt(toB).number;
    const atLineStart = (pos: number): boolean => oldDoc.lineAt(pos).from === pos;
    const atLineEnd = (pos: number): boolean => oldDoc.lineAt(pos).to === pos;
    if (fromA === toA && inserted.lines > 1) {
      // Enter at the end of a line, or a line inserted above another, leaves that line's text alone.
      if (!inserted.line(1).length && atLineEnd(fromA)) first++;
      if (!inserted.line(inserted.lines).length && atLineStart(fromA)) last--;
    } else if (!inserted.length && ((atLineStart(fromA) && atLineStart(toA)) || (atLineEnd(fromA) && atLineEnd(toA)))) {
      return; // A whole line was deleted; its neighbours are unchanged.
    }
    for (let number = first; number <= last; number++) lines.add(number);
  });
  return lines;
}

/** Line numbers, in the transaction's new document, that the date filter has just processed or left. */
const clearEditedLines = StateEffect.define<number[]>();

/** Starts of lines the user edited since the caret entered them, mapped through every change. */
const editedLines = StateField.define<ReadonlySet<number>>({
  create: () => new Set(),
  update(value, transaction) {
    const cleared = transaction.effects.filter(effect => effect.is(clearEditedLines)).flatMap(effect => effect.value);
    if (!transaction.docChanged && !transaction.selection && !cleared.length) return value;
    if (!value.size && !cleared.length && !isUserEdit(transaction)) return value;
    const doc = transaction.newDoc;
    const next = new Set<number>();
    for (const pos of value) next.add(transaction.docChanged ? doc.lineAt(transaction.changes.mapPos(pos, 1)).from : pos);
    const touched = isUserEdit(transaction) ? [...touchedLines(transaction)].map(number => doc.line(number).from) : [];
    if (transaction.selection && next.size) {
      // Entering a line starts a fresh visit: only edits made from now on count.
      const before = new Set(transaction.startState.selection.ranges.map(range =>
        doc.lineAt(transaction.changes.mapPos(transaction.startState.doc.lineAt(range.head).from, 1)).from));
      for (const range of transaction.newSelection.ranges) {
        const from = doc.lineAt(range.head).from;
        if (!before.has(from)) next.delete(from);
      }
    }
    for (const from of touched) next.add(from);
    for (const number of cleared) if (number <= doc.lines) next.delete(doc.line(number).from);
    return next;
  }
});

/**
 * Resolve dates and order properties when the caret leaves a task line the user edited (including Enter).
 * Lines the caret merely passes through, and completed tasks, are never changed.
 */
export function noteDateInput(getDateFormat: () => string, isTaskMode: () => boolean, getLinkDates: () => boolean = () => true) {
  const filter = EditorState.transactionFilter.of(transaction => {
    if (isTaskMode() || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
    if (!transaction.selection && !transaction.docChanged) return transaction;
    const edited = transaction.startState.field(editedLines, false) ?? new Set<number>();
    const touchedNow = isUserEdit(transaction) ? touchedLines(transaction) : new Set<number>();
    // Lines the caret left, in new-document numbers, and whether each was edited during the visit.
    // A line's start maps forward, so text inserted above it (a paste ending in a newline) moves it down.
    const left = new Map<number, boolean>();
    for (const range of transaction.startState.selection.ranges) {
      const oldLine = transaction.startState.doc.lineAt(range.head);
      const number = transaction.newDoc.lineAt(transaction.changes.mapPos(oldLine.from, 1)).number;
      left.set(number, Boolean(left.get(number)) || edited.has(oldLine.from) || touchedNow.has(number));
    }
    const selections = transaction.newSelection.ranges;
    for (const number of left.keys()) {
      const { from, to } = transaction.newDoc.line(number);
      if (selections.some(range => range.from <= to && range.to >= from)) left.delete(number);
    }
    const clear = [...left].filter(([, wasEdited]) => wasEdited).map(([number]) => number);
    if (!clear.length) return transaction;
    // Only edited open tasks (to do, in progress, waiting) can change; check them before classifying the whole note.
    const tasks = clear.sort((a, b) => a - b).map(number => transaction.newDoc.line(number))
      .filter(line => /^\s*-\s+\[[ /?]\]\s/.test(line.text));
    const changes: ChangeSpec[] = [];
    if (tasks.length) {
      const nonBody = nonBodyLines(transaction.newDoc.iterLines());
      const reference = new Date();
      const dateFormat = getDateFormat();
      for (const { text, number, from } of tasks) {
        if (nonBody.has(number - 1)) continue;
        const resolvedDates = noteDateChanges(text, dateFormat, reference, getLinkDates());
        let resolved = text;
        for (const change of resolvedDates.reverse()) {
          resolved = resolved.slice(0, change.from) + change.insert + resolved.slice(change.to);
        }
        const ordered = orderNoteProperties(resolved, dateFormat, reference);
        if (ordered !== text) changes.push({ from, to: from + text.length, insert: ordered });
      }
    }
    // Rewrites never add or remove lines, so the new-document line numbers stay valid.
    return [transaction, { changes, effects: clearEditedLines.of(clear), sequential: true }];
  });
  return [editedLines, filter];
}
