import { findInputDate, findInputDeadline, findInputTime, removeSpans } from "./date";
import { parseTaskInput, parseTaskLine, serializeTask, taskTextRanges, type ParsedTaskLine, type ParsedTokenRange } from "./parser";
import type { TaskDraft } from "./types";

const width = (line: string): number => [...(/^[ \t]*/.exec(line)?.[0] ?? "")].reduce((total, char) => total + (char === "\t" ? 4 : 1), 0);

/** Parse a new task batch, retaining description bullets and relative indentation. */
export function parseTaskTreeInput(input: string, destination: string, reference = new Date(), dateFormat?: string, linkDates = true): TaskDraft {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  if (/^\s*[-+*]\s+\[[ xX/?-]\]\s*$/.test(lines[0])) throw new Error("Enter a title for the main task.");
  const first = parseTaskInput(lines[0], reference, dateFormat);
  if (!first?.title) throw new Error("Enter a title for the main task.");
  const rootIndent = width(lines[0]);
  const main: TaskDraft = { ...first, indent: 0, destination: first.destination ?? destination };
  const additionalLines: string[] = [];
  let descriptionIndent: number | undefined;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { additionalLines.push(""); continue; }
    const indent = width(line) - rootIndent;
    if (indent < 0) throw new Error(`Line ${index + 1} must not be less indented than the main task.`);
    const text = line.trimStart();
    const checkbox = /^[-+*]\s+\[[ xX/?-]\](?:\s|$)/.test(text);
    const bullet = /^[-+*]\s+/.test(text);
    if (!checkbox && ((bullet && indent > 0) || (descriptionIndent !== undefined && indent > descriptionIndent))) {
      additionalLines.push(" ".repeat(indent) + text);
      if (bullet) descriptionIndent = indent;
      continue;
    }
    if (/^(?:#{1,6}\s|`{3,}|~{3,})/.test(text)) throw new Error(`Line ${index + 1}: enter a task or an indented description bullet.`);
    const taskText = checkbox ? text.replace(/^[-+*]/, "-") : text.replace(/^[-+*]\s+/, "");
    if (/^-\s+\[[ xX/?-]\]\s*$/.test(taskText)) throw new Error(`Enter a task title on line ${index + 1}.`);
    const parsed = parseTaskInput(taskText, reference, dateFormat);
    if (!parsed?.title) throw new Error(`Enter a task title on line ${index + 1}.`);
    if (parsed.destination && parsed.destination !== main.destination) throw new Error(`Line ${index + 1}: tasks in this batch must use the main task's destination.`);
    additionalLines.push(serializeTask({ ...parsed, indent, destination: main.destination }, dateFormat, linkDates));
    descriptionIndent = undefined;
  }
  if (additionalLines.length) main.additionalLines = additionalLines;
  return main;
}

/**
 * The text with its tokens (already read) masked, so no date is read inside them (a `>tomorrow` defer is no schedule)
 * and a date in words before them still ends the title. The mask keeps places, and Chrono never joins across it.
 */
function maskTokens(text: string, tokens: Array<{ from: number; to: number }>): string {
  return tokens.reduce((masked, token) => masked.slice(0, token.from) + "\u00a6".repeat(token.to - token.from) + masked.slice(token.to), text);
}

/** The span of `text` newly typed over `original`: between their shared start and shared end. */
function typedSpan(text: string, original: string): { from: number; to: number } {
  let from = 0;
  const shortest = Math.min(text.length, original.length);
  while (from < shortest && text[from] === original[from]) from++;
  let to = text.length;
  for (let originalTo = original.length; to > from && originalTo > from && text[to - 1] === original[originalTo - 1]; originalTo--) to--;
  return { from, to };
}

export type InputTokenKind = ParsedTokenRange["kind"] | "destination";
export interface InputTokenRange { kind: InputTokenKind; from: number; to: number }

/**
 * Where one line of task text sets properties, as saving reads it: the tokens at its end, and dates written in words
 * ("tomorrow 3pm", "{next friday}") in what was newly typed over `original` (a new task's text is all new).
 */
export function taskInputRanges(text: string, original = "", reference = new Date(), dateFormat?: string): InputTokenRange[] {
  const strict: InputTokenRange[] = taskTextRanges(text, reference, dateFormat).sort((a, b) => a.from - b.from);
  const within = typedSpan(text, original);
  if (!text.slice(within.from, within.to).trim()) return strict;
  const prose = maskTokens(text, strict);
  const natural: InputTokenRange[] = [];
  const add = (kind: InputTokenKind, match: { index: number; text: string } | undefined): void => {
    if (!match) return;
    const from = match.index + match.text.length - match.text.trimStart().length;
    natural.push({ kind, from, to: match.index + match.text.trimEnd().length });
  };
  if (!strict.some(range => range.kind === "deadline")) add("deadline", findInputDeadline(prose, reference, dateFormat, within));
  // A date and its time may sit apart; each part is marked on its own.
  if (!strict.some(range => range.kind === "scheduledDate")) for (const part of findInputDate(prose, reference, within)?.parts ?? []) add("scheduledDate", part);
  else if (!parseTaskLine(`- [ ] ${text}`, reference, dateFormat)?.scheduledTime) add("scheduledDate", findInputTime(prose, reference, within));
  if (!natural.length) return strict;
  // With the words read as dates taken out (blanked, so places stay put), tokens they stood in front of end the
  // line too, as saving reads them: "tomorrow p1 3pm" sets the priority as well.
  let blanked = text;
  for (const range of natural) blanked = blanked.slice(0, range.from) + " ".repeat(range.to - range.from) + blanked.slice(range.to);
  return [...taskTextRanges(blanked, reference, dateFormat), ...natural].sort((a, b) => a.from - b.from);
}

/**
 * The highlight a token gets as it is typed, by what it sets: dates, times and durations blue, the deadline red,
 * a priority its own colour, tags grey, the project green, anything else (a repeat, a defer) the accent.
 */
export function tokenHighlightClass(kind: InputTokenKind, text: string): string {
  const look = kind === "scheduledDate" || kind === "durationMinutes" ? "is-date"
    : kind === "deadline" ? "is-deadline"
    : kind === "priority" ? `is-priority is-p${/[123]/.exec(text)?.[0] ?? ""}`
    : kind === "tags" ? "is-tag"
    : kind === "destination" ? "is-project"
    : "is-other";
  return `tm-nlp-token ${look}`;
}

/**
 * Takes the tokens of `kinds` out of the first line of task text (words read as a date too) and adds `replacement`
 * at its end. A line with no title yet keeps a leading space, so a title typed at the start stays apart.
 */
export function replaceTaskTokens(text: string, kinds: InputTokenKind[], replacement: string, original = "", reference = new Date(), dateFormat?: string): string {
  const newline = text.indexOf("\n");
  let line = newline < 0 ? text : text.slice(0, newline);
  const rest = newline < 0 ? "" : text.slice(newline);
  const originalLine = original.split("\n")[0];
  const removed = taskInputRanges(line, originalLine, reference, dateFormat).filter(range => kinds.includes(range.kind)).sort((a, b) => b.from - a.from);
  for (const range of removed) {
    const before = line.slice(0, range.from).trimEnd();
    const after = line.slice(range.to).trimStart();
    line = before && after ? `${before} ${after}` : before || (after ? ` ${after}` : "");
  }
  if (replacement) line = `${line.trimEnd()} ${replacement}`;
  return line + rest;
}

/**
 * Re-parse an edited task line strictly; natural-language dates are read only from text the user
 * newly typed (the span between the unchanged prefix and suffix), so existing prose such as
 * "Buy sun cream" or "Done last Friday" is never reinterpreted.
 */
export function parseEditedTaskInput(text: string, original: string, reference = new Date(), dateFormat?: string, checkbox = "- [ ] "): ParsedTaskLine | undefined {
  const ranges: ParsedTokenRange[] = [];
  const strict = parseTaskLine(checkbox + text, reference, dateFormat, false, ranges);
  const within = typedSpan(text, original);
  if (!strict || !text.slice(within.from, within.to).trim()) return strict;
  const prose = maskTokens(text, ranges.map(range => ({ ...range, from: range.from - checkbox.length, to: range.to - checkbox.length })));
  const deadline = strict.deadline ? undefined : findInputDeadline(prose, reference, dateFormat, within);
  const scheduled = strict.scheduledDate ? undefined : findInputDate(prose, reference, within);
  // A time typed apart from a date token gives that date its time.
  const time = strict.scheduledDate && !strict.scheduledTime ? findInputTime(prose, reference, within) : undefined;
  if (!deadline && !scheduled && !time) return strict;
  const cleaned = removeSpans(text, [...(deadline ? [deadline] : []), ...(scheduled?.parts ?? []), ...(time ? [time] : [])]);
  const parsed = parseTaskInput(checkbox + cleaned, reference, dateFormat, false);
  if (!parsed) return parsed;
  if (deadline && !parsed.deadline) Object.assign(parsed, { deadline: deadline.date }, deadline.time ? { deadlineTime: deadline.time } : {});
  if (scheduled && !parsed.scheduledDate) Object.assign(parsed, { scheduledDate: scheduled.date }, scheduled.time ? { scheduledTime: scheduled.time } : {});
  if (time && parsed.scheduledDate && !parsed.scheduledTime) parsed.scheduledTime = time.time;
  return parsed;
}
