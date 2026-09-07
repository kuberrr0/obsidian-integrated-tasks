import { EditorState, type ChangeSpec } from "@codemirror/state";
import { formatDate, parseDateExpression } from "./date";
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
      const date = parseDateExpression(candidate.slice(0, length), reference, dateFormat);
      if (!date) continue;
      changes.push({ from, to: from + 1 + length, insert: `[[${formatDate(date, dateFormat)}]]` });
      pattern.lastIndex = from + 1 + length;
      break;
    }
  }
  return changes;
}

/** Commit a task's date expressions when the caret leaves its line (including Enter). */
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
      for (const change of noteDateChanges(text, getDateFormat(), reference)) {
        changes.push({ ...change, from: from + change.from, to: from + change.to });
      }
    }
    return changes.length ? [transaction, { changes, sequential: true }] : transaction;
  });
}
