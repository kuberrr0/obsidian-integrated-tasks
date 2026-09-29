import { taskLineRanges } from "./parser";
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
  const ranges = taskLineRanges(line, new Date(), dateFormat);
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

/** A recurring task's log entries on a line ("Completed: [[2026-09-20]]"), highlighted as dates. */
export function logHighlights(line: string, dateFormat?: string): NoteHighlight[] {
  const entry = parseRecurringLog(line, [dateFormat ?? "YYYY-MM-DD"]);
  return entry ? [{ from: entry.from, to: entry.to, cls: "tm-nlp-token is-date" }] : [];
}
