import { EditorState, type ChangeSpec } from "@codemirror/state";
import { formatDate, parseDateExpression, parseDateTimeExpression } from "./date";
import { parseTaskLine, type ParsedTokenRange } from "./parser";
import { bodyLines } from "./structure";

/** Resolve only the last date in each category; earlier mentions remain prose. */
export function noteDateChanges(text: string, dateFormat: string, reference = new Date(), linkDates = true): { from: number; to: number; insert: string }[] {
  type Change = { from: number; to: number; insert: string };
  const mask = (value: string): string => " ".repeat(value.length);
  const protectedText = text.replace(/(`+)[\s\S]*?\1|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\S+@\S+\.\S+/g, mask);
  const replacement = (expression: string): string | undefined => {
    const value = expression.trim().replace(/^@/, "");
    const dateTime = parseDateTimeExpression(value, reference, dateFormat);
    const date = dateTime?.date ?? (expression.trim().startsWith("@") ? parseDateExpression(value, reference, dateFormat) : undefined);
    if (!date) return undefined;
    const label = formatDate(date, dateFormat);
    return `${linkDates ? `[[${label}]]` : label}${dateTime?.time ? ` ${dateTime.time}` : ""}`;
  };
  let deadline: Change | undefined;
  const withoutDeadlines = protectedText.replace(/\{([^{}]*)\}/g, (whole: string, expression: string, offset: number) => {
    const insert = replacement(expression);
    if (insert !== undefined) deadline = { from: offset + 1, to: offset + whole.length - 1, insert: expression.trim().startsWith("[[") ? expression : insert };
    return mask(whole);
  }).replace(/\{[^}]*$/, mask);
  const scheduled: Change[] = [];
  const prose = withoutDeadlines.replace(/[#~]?\[\[([^\]]+)\]\]/g, (whole: string, _target: string, offset: number) => {
    // Existing date links participate in "last date wins" without being rewritten.
    if (whole.startsWith("[[") && replacement(whole) !== undefined) scheduled.push({ from: offset, to: offset + whole.length, insert: whole });
    return mask(whole);
  });
  const dateProse = prose.replace(/\b(?:\d+h(?:\d+m)?|\d+m)\b/g, mask);
  const words = /\S+/g;
  let word: RegExpExecArray | null;
  while ((word = words.exec(dateProse))) {
    const from = word.index;
    // An @ marker is optional, but cannot be embedded in another word.
    for (let end = dateProse.length; end > from; end--) {
      if (end < dateProse.length && !/[\s.,;!?]/.test(dateProse[end])) continue;
      if (/[.,;!?]/.test(dateProse[end] ?? "") && end + 1 < dateProse.length && !/\s/.test(dateProse[end + 1])) continue;
      if (/\s/.test(dateProse[end - 1])) continue;
      const expression = dateProse.slice(from, end);
      if (expression !== text.slice(from, end)) continue;
      const insert = replacement(expression);
      if (insert === undefined) continue;
      scheduled.push({ from, to: end, insert });
      words.lastIndex = end;
      break;
    }
  }
  const lastScheduled = scheduled.sort((a, b) => a.from - b.from).pop();
  return [lastScheduled, deadline].filter((change): change is Change => Boolean(change))
    .filter(change => text.slice(change.from, change.to) !== change.insert)
    .sort((a, b) => a.from - b.from);
}

/** Reorder recognized token slots, retaining source spelling, spacing and destinations. */
function orderNoteProperties(text: string, dateFormat: string, reference: Date): string {
  const ranges: ParsedTokenRange[] = [];
  parseTaskLine(text, reference, dateFormat, false, ranges);
  ranges.sort((a, b) => a.from - b.from);
  const order: ParsedTokenRange["kind"][] = ["scheduledDate", "durationMinutes", "deadline", "priority", "tags"];
  const tokens = [...ranges].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(range => text.slice(range.from, range.to));
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    text = text.slice(0, range.from) + tokens[index] + text.slice(range.to);
  }
  return text;
}

/** Resolve dates and order properties when the caret leaves a task line (including Enter). */
export function noteDateInput(getDateFormat: () => string, isTaskMode: () => boolean, getLinkDates: () => boolean = () => true) {
  return EditorState.transactionFilter.of(transaction => {
    if (isTaskMode() || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
    if (!transaction.selection && !transaction.docChanged) return transaction;
    const candidates = new Set(transaction.startState.selection.ranges.map(range =>
      transaction.newDoc.lineAt(transaction.changes.mapPos(transaction.startState.doc.lineAt(range.head).from, -1)).number));
    const selections = transaction.newSelection.ranges;
    for (const number of candidates) {
      const { from, to } = transaction.newDoc.line(number);
      if (selections.some(range => range.from <= to && range.to >= from)) candidates.delete(number);
    }
    if (!candidates.size) return transaction;
    const changes: ChangeSpec[] = [];
    const reference = new Date();
    for (const { text, line } of bodyLines(transaction.newDoc.toString())) {
      if (!candidates.has(line + 1) || !/^\s*-\s+\[[ xX]\]\s/.test(text)) continue;
      const { from } = transaction.newDoc.line(line + 1);
      const dateFormat = getDateFormat();
      const resolvedDates = noteDateChanges(text, dateFormat, reference, getLinkDates());
      let resolved = text;
      for (const change of resolvedDates.reverse()) {
        resolved = resolved.slice(0, change.from) + change.insert + resolved.slice(change.to);
      }
      const ordered = orderNoteProperties(resolved, dateFormat, reference);
      if (ordered !== text) changes.push({ from, to: from + text.length, insert: ordered });
    }
    return changes.length ? [transaction, { changes, sequential: true }] : transaction;
  });
}
