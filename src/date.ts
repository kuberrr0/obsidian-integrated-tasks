import * as chrono from "chrono-node";
import { moment as obsidianMoment } from "obsidian";
import type momentFactory from "moment";

// Obsidian provides the callable factory, but declares it as a module namespace.
const moment = obsidianMoment as unknown as typeof momentFactory;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(now = new Date()): string {
  return formatLocalDate(now);
}

export function tomorrowIso(now = new Date()): string {
  const result = new Date(now);
  result.setDate(result.getDate() + 1);
  return formatLocalDate(result);
}

/** Only ISO or the configured date format(s); never natural language. Link text and frontmatter use this. */
export function parseStrictDateExpression(value: string, dateFormat: string | string[] = DEFAULT_DATE_FORMAT): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (ISO_DATE.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const candidate = new Date(year, month - 1, day);
    if (
      candidate.getFullYear() === year &&
      candidate.getMonth() === month - 1 &&
      candidate.getDate() === day
    ) {
      return trimmed;
    }
    return undefined;
  }

  const formatted = moment(trimmed, dateFormat, true);
  return formatted.isValid() ? formatted.format(DEFAULT_DATE_FORMAT) : undefined;
}

/** Chrono reads 5/10/2026 day-first when the date format puts the day before the month, as in DD/MM/YYYY. */
function chronoFor(dateFormat: string | string[]): chrono.Chrono {
  const format = [dateFormat].flat()[0] ?? DEFAULT_DATE_FORMAT;
  const day = format.indexOf("D");
  return day >= 0 && day < format.indexOf("M") ? chrono.en.GB : chrono.casual;
}

export function parseDateExpression(
  value: string,
  reference = new Date(),
  dateFormat: string | string[] = DEFAULT_DATE_FORMAT
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (ISO_DATE.test(trimmed)) return parseStrictDateExpression(trimmed, dateFormat);
  const strict = parseStrictDateExpression(trimmed, dateFormat);
  if (strict) return strict;

  const parsed = chronoFor(dateFormat).parse(trimmed, reference, { forwardDate: true }).find((result) =>
    result.index === 0 && result.text.length === trimmed.length
  );
  return parsed ? formatLocalDate(parsed.start.date()) : undefined;
}

export function formatDate(iso: string, dateFormat = DEFAULT_DATE_FORMAT): string {
  const parsed = moment(iso, DEFAULT_DATE_FORMAT, true);
  return parsed.isValid() ? parsed.format(dateFormat) : iso;
}

export function actionDate(task: { scheduledDate?: string; deadline?: string }): string | undefined {
  if (task.scheduledDate && task.deadline) {
    return task.scheduledDate < task.deadline ? task.scheduledDate : task.deadline;
  }
  return task.scheduledDate ?? task.deadline;
}

/** Text range of an edited value; natural dates are only read from text inside it. */
export interface InputRange { from: number; to: number }

/** Blank everything outside `within`, after the full value's own masking kept links and code intact. */
function onlyWithin(prose: string, within?: InputRange): string {
  if (!within) return prose;
  return " ".repeat(within.from) + prose.slice(within.from, within.to) + " ".repeat(Math.max(0, prose.length - within.to));
}

/** A match inside `within` must not be part of a longer word that continues outside it. */
function boundedMatch(value: string, index: number, length: number, outside: RegExp): boolean {
  const text = value.slice(index, index + length);
  const start = index + text.search(/\S/);
  const end = index + text.trimEnd().length;
  return !outside.test(value[start - 1] ?? "") && !outside.test(value[end] ?? "");
}

/** A date (and time) typed in prose, possibly in two places: "tomorrow p1 3pm" reads as tomorrow at 3pm. */
export interface InputDate { date: string; time?: string; parts: Array<{ index: number; text: string }> }

/**
 * Editor prose for Chrono: deadlines, links, code, URLs and durations are covered with a mark it neither reads
 * nor joins a date and a time across (spaces would let "3pm {friday} tomorrow" read as one date).
 */
function inputProse(value: string, within?: InputRange): string {
  return onlyWithin(value.replace(/\{[^}]*\}?|\[\[[\s\S]*?\]\]|`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\b(?:\d+h(?:\d+m)?|\d+m)\b/g, match => "\u00a6".repeat(match.length))
    // `every …` repeats too: "every friday today 9pm" would otherwise read as one (repeat's) date.
    .replace(REPEAT_TEXT, match => "\u00a6".repeat(match.length)), within);
}

const REPEAT_TEXT = /\bevery\s+(?:(?:other|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+)?(?:day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi;

/** A bare weekday abbreviation is far more often a word ("sun cream") than a date; "5/10" is a fraction. */
const NOT_A_DATE = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|\d{1,2}\/\d{1,2})$/i;

/**
 * Chrono's readings of editor prose that may set a schedule: whole words, inside `within`, not a repeat's
 * ("every Friday") or the past's ("last Friday"), and never a bare weekday abbreviation or a fraction.
 */
function inputResults(value: string, reference: Date, within?: InputRange): chrono.ParsedResult[] {
  const prose = inputProse(value, within);
  return chrono.parse(prose, reference, { forwardDate: true }).filter(match =>
    !match.end && (!within || boundedMatch(value, match.index, match.text.length, /[\p{L}\p{N}]/u))
    && !/(?:^|\s)(?:every|each|last|past|previous)\s*$/i.test(prose.slice(0, match.index))
    && !/^(?:last|past|previous)\b/i.test(match.text) && !NOT_A_DATE.test(match.text.trim())
    // A time right after a repeat is the repeat's ("every friday at 5pm"), not today's.
    && (certainDay(match) || !REPEAT_BEFORE.test(value.slice(0, match.index))));
}

const REPEAT_BEFORE = /\bevery\s+(?:(?:other|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+)?(?:day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\s*$/i;

/** A task's properties as typed after its title: tags, a project, a duration, a priority, a repeat, dates, times. */
const PROPERTY_TEXT = new RegExp([
  String.raw`\{[^{}]*\}`, String.raw`[#~]\[\[[^\]]*\]\]`, String.raw`#[^\s#\[]\S*`, String.raw`(?:\d+h(?:\d+m)?|\d+m)`, String.raw`[pP][123]`,
  String.raw`every\s+(?:(?:other|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+)?(?:day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?`,
  String.raw`>\S+`, String.raw`(?:✓|✅\s*)\S+`,
  String.raw`(?:at\s+)?(?:(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]m)?|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?[ap]m|noon|midnight)`
].map(part => `(?:${part})`).join("|"), "giu");

/**
 * Whether a date typed in words ends the title: after it (and the other parts of it, such as its time) come only
 * properties. "Call mom tomorrow about dinner" keeps its "tomorrow"; "tomorrow {sunday} 5m 9:30pm p2" does not.
 */
function endsTitle(value: string, parts: Array<{ index: number; text: string }>): boolean {
  const from = Math.min(...parts.map(part => part.index));
  const rest = removeSpans(value.slice(from), parts.map(part => ({ index: part.index - from, text: part.text })));
  // Tokens the caller already read are masked with ¦.
  return !rest.replace(/\u00a6+/g, " ").replace(PROPERTY_TEXT, " ").trim();
}

const certainDay = (result: chrono.ParsedResult): boolean => result.start.isCertain("day") || result.start.isCertain("weekday");

/**
 * Find a date in editor prose without interpreting links or inline code as dates. A date and a time written apart
 * ("tomorrow p1 3pm") make one schedule; a time alone counts too, for its next occurrence.
 */
export function findInputDate(value: string, reference = new Date(), within?: InputRange): InputDate | undefined {
  const results = inputResults(value, reference, within);
  const dated = results.find(certainDay);
  const timed = results.find(result => result !== dated && result.start.isCertain("hour") && !certainDay(result));
  const first = dated ?? timed;
  if (!first) return undefined;
  const extra = dated && !resultTime(dated) ? timed : undefined;
  const time = resultTime(first) ?? (extra && resultTime(extra));
  const parts = [first, extra].filter((result): result is chrono.ParsedResult => Boolean(result)).map(result => ({ index: result.index, text: result.text })).sort((a, b) => a.index - b.index);
  // A date in the middle of the title is part of it.
  if (!endsTitle(value, parts)) return undefined;
  return { date: formatLocalDate(first.start.date()), ...(time ? { time } : {}), parts };
}

/** A time alone in editor prose ("3pm", "at 9"), for a date given by a token. */
export function findInputTime(value: string, reference = new Date(), within?: InputRange): { index: number; text: string; time: string } | undefined {
  const result = inputResults(value, reference, within).find(item => item.start.isCertain("hour") && !certainDay(item));
  const time = result && resultTime(result);
  return result && time && endsTitle(value, [result]) ? { index: result.index, text: result.text, time } : undefined;
}

/** Takes the given spans out of text, closing up the spaces around each. */
export function removeSpans(text: string, spans: Array<{ index: number; text: string }>): string {
  let result = text;
  for (const span of [...spans].sort((a, b) => b.index - a.index)) {
    const before = result.slice(0, span.index).trimEnd();
    const after = result.slice(span.index + span.text.length).trimStart();
    result = before && after ? `${before} ${after}` : before + after;
  }
  return result;
}


/** Curly braces route editor dates to Deadline, even in the middle of a title. */
export function findInputDeadline(value: string, reference = new Date(), dateFormat?: string, within?: InputRange): { index: number; text: string; date: string; time?: string } | undefined {
  const prose = onlyWithin(value.replace(/`[^`]*`|\[\[[\s\S]*?\]\]|\[[^\]]*\]\([^)]*\)/g, (match) => " ".repeat(match.length)), within);
  const pattern = /(?:^|\s)\{([^{}[\]]+)\}(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose))) {
    if (within && !boundedMatch(value, match.index, match[0].length, /\S/)) continue;
    const date = parseDateTimeExpression(match[1], reference, dateFormat);
    if (date) return { index: match.index, text: match[0], ...date };
  }
  return undefined;
}

/** Local wall-clock time; never inferred from Chrono's default hour. */
function resultTime(result: chrono.ParsedResult): string | undefined {
  if (!result.start.isCertain("hour")) return undefined;
  return `${String(result.start.get("hour")).padStart(2, "0")}:${String(result.start.get("minute") ?? 0).padStart(2, "0")}`;
}

export function parseTimeExpression(value: string, reference = new Date()): string | undefined {
  const text = value.trim().replace(/^at\s+/i, "");
  const result = chrono.parse(text, reference).find((match) =>
    match.index === 0 && match.text.length === text.length && !match.end &&
    !match.start.isCertain("day") && !match.start.isCertain("weekday")
  );
  return result ? resultTime(result) : undefined;
}

/** `strict` skips natural-language dates, for callers that only accept exact date formats. */
export function parseDateTimeExpression(value: string, reference = new Date(), dateFormat: string | string[] = DEFAULT_DATE_FORMAT, strict = false): { date: string; time?: string } | undefined {
  const text = value.trim();
  const link = /^\[\[([^\]]+)\]\](?:\s+(.+))?$/.exec(text);
  if (link) {
    // Note links are only dates when they name a date exactly: [[April]] or [[Friday]] stay note links.
    const date = parseStrictDateExpression(link[1], dateFormat);
    const time = link[2] ? parseTimeExpression(link[2], reference) : undefined;
    return date && (!link[2] || time) ? { date, ...(time ? { time } : {}) } : undefined;
  }
  // Try strict dates first so custom Daily Notes formats retain their meaning.
  for (let index = text.length; index > 0; index--) {
    if (index !== text.length && text[index] !== " ") continue;
    const prefix = text.slice(0, index);
    const strict = moment(prefix, [DEFAULT_DATE_FORMAT, ...[dateFormat].flat()], true);
    if (!strict.isValid()) continue;
    const suffix = text.slice(index).trim();
    const time = suffix ? parseTimeExpression(suffix, reference) : undefined;
    if (!suffix || time) return { date: strict.format(DEFAULT_DATE_FORMAT), ...(time ? { time } : {}) };
  }
  if (strict) return undefined;
  const result = chronoFor(dateFormat).parse(text, reference, { forwardDate: true }).find((match) =>
    match.index === 0 && match.text.length === text.length && !match.end &&
    (match.start.isCertain("day") || match.start.isCertain("weekday"))
  );
  return result ? { date: formatLocalDate(result.start.date()), ...(resultTime(result) ? { time: resultTime(result) } : {}) } : undefined;
}

export function formatDateTime(date: string, time?: string, dateFormat?: string): string {
  return `${formatDate(date, dateFormat)}${time ? ` ${time}` : ""}`;
}
