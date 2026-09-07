import { EditorState, type ChangeSpec } from "@codemirror/state";
import { formatDate, parseDateExpression, parseDateTimeExpression } from "./date";
import { parseTaskLine, type ParsedTokenRange } from "./parser";
import { bodyLines } from "./structure";

/** Resolve explicit @ dates while leaving links, code and ordinary prose alone. */
export function noteDateChanges(text: string, dateFormat: string, reference = new Date()): { from: number; to: number; insert: string }[] {
  const prose = text.replace(/(`+)[\s\S]*?\1|\[\[[\s\S]*?\]\]|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\{(?!@)[^}]*\}/g, match => " ".repeat(match.length));
  const changes: { from: number; to: number; insert: string }[] = [];
  const pattern = /(^|\s|\{)@/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose))) {
    const from = match.index + match[1].length;
    const braced = match[1] === "{";
    const rest = prose.slice(from + 1);
    const end = rest.search(braced ? /[{}]/ : /[@{}]/);
    const candidate = rest.slice(0, end < 0 ? rest.length : end).trimEnd();
    if (braced && (end < 0 || rest[end] !== "}")) continue;
    // Longest complete expression wins, so “next week” is never committed as “next”.
    for (let length = candidate.length; length > 0; length--) {
      if (length < candidate.length && !/[\s.,;!?]/.test(candidate[length])) continue;
      if (braced && length !== candidate.length) break;
      const expression = candidate.slice(0, length);
      const dateTime = parseDateTimeExpression(expression, reference, dateFormat);
      const date = dateTime?.date ?? parseDateExpression(expression, reference, dateFormat);
      if (!date) continue;
      changes.push({ from, to: from + 1 + length, insert: `[[${formatDate(date, dateFormat)}]]${dateTime?.time ? ` ${dateTime.time}` : ""}` });
      pattern.lastIndex = from + 1 + length;
      break;
    }
  }
  return changes;
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
export function noteDateInput(getDateFormat: () => string, isTaskMode: () => boolean) {
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
      const resolvedDates = noteDateChanges(text, dateFormat, reference);
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
