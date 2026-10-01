import { taskLineRanges } from "./parser";
import { noteDateWords } from "./note-date-input";
import { tokenHighlightClass } from "./task-input";
import { parseRecurringLog } from "./recurring-log";

export interface NoteHighlight { from: number; to: number; cls: string }

export interface NoteLineHighlights {
  highlights: NoteHighlight[];
  /** A task line's priority, which colours its checkbox. */
  priority?: number;
}

/**
 * What a line of a note highlights, as a task card's title and the task editor's field do: each token a task line
 * ends with (except its tags), in the colour of what it sets, and a recurring task's log entries. The text itself
 * stays as written.
 */
export function noteLineHighlights(line: string, dateFormat?: string): NoteLineHighlights | undefined {
  const reference = new Date();
  // A date still in words (which leaving the line would convert) is highlighted as the date it is, and read as one:
  // the properties before it are highlighted too.
  const words = noteDateWords(line, dateFormat ?? "YYYY-MM-DD", reference);
  const read = words.reduce((text, word) => text.slice(0, word.from) + " ".repeat(word.to - word.from) + text.slice(word.to), line);
  const ranges = [...taskLineRanges(read, reference, dateFormat), ...words.map(word => ({ ...word, kind: "scheduledDate" as const }))];
  if (ranges.length) {
    const priority = ranges.find(range => range.kind === "priority");
    // Tags keep Obsidian's own tag look in notes.
    const shown = ranges.filter(range => range.kind !== "tags");
    return {
      highlights: shown.sort((a, b) => a.from - b.from).map(({ kind, from, to }) => ({ from, to, cls: tokenHighlightClass(kind, line.slice(from, to)) })),
      priority: priority ? Number(/[123]/.exec(line.slice(priority.from, priority.to))?.[0]) : undefined
    };
  }
  const log = logHighlights(line, dateFormat);
  return log.length ? { highlights: log } : undefined;
}

/** A recurring task's log entry on a line ("COMPLETED: [[2026-09-20]]"): green when completed, red when cancelled. */
export function logHighlights(line: string, dateFormat?: string): NoteHighlight[] {
  const entry = parseRecurringLog(line, [dateFormat ?? "YYYY-MM-DD"]);
  return entry ? [{ from: entry.from, to: entry.to, cls: `tm-nlp-token ${entry.outcome === "COMPLETED" ? "is-log-completed" : "is-log-canceled"}` }] : [];
}
