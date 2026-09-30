import { formatTags, normalizeTags, tagFormat, trailingTag } from "./task-tags";
import { bodyLines, scanSections, splitDestination, destinationString } from "./structure";
import { findInputDate, findInputDeadline, findInputTime, formatDate, formatLocalDate, parseDateTimeExpression, parseTimeExpression, removeSpans } from "./date";
import { STATUS_CHARS, draftStatus, isClosedStatus, statusFromChar } from "./task-status";
import type { ParsedTaskMetadata, Priority, Task, TaskDraft, TaskStatus } from "./types";

// ` ` to do, `/` in progress, `?` waiting, `x`/`X` done, `-` cancelled; other characters are not tasks.
const CHECKBOX = /^(\s*)-\s+\[([ xX/?-])\]\s+(.*)$/;
const PRIORITY = /(?:^|\s)p([123])\s*$/i;
const DEADLINE = /(?:^|\s)\{([^{}]+)\}\s*$/;
// `>` directly followed by a date, a date link or `someday`; `a > b` stays prose.
const DEFER = /(?:^|\s)>([^\s>][^>]*?)\s*$/;
const SCHEDULED = /(?:^|\s)(\[\[([^\]]+)\]\](?:\s+([^{}[\]]+))?)\s*$/;
const DURATION = /(?:^|\s)((?:\d+h)?(?:\d+m)?)\s*$/i;
// A time on its own, such as 21:30 or at 9:30pm: the scheduled time, when a date without one comes before it.
const LONE_TIME = /(?:^|\s)((?:at\s+)?(?:(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]m)?|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?[ap]m))\s*$/i;
// A heading may hold balanced [[links]]; the path part holds no brackets or '#'.
const DESTINATION = /(?:^|\s)~\[\[([^[\]#\r\n]+(?:#(?:[^[\]\r\n]|\[\[[^[\]\r\n]*\]\])*)?)\]\]\s*$/;
const BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
// Only a whole trailing rule after some title text; "every time" stays prose.
const REPEAT = /\s(every\s+(?:(?:other|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+)?(?:day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?)\s*$/i;
// `✓` directly followed by a date; the Tasks plugin's `✅ YYYY-MM-DD` is read too.
const COMPLETED = /(?:^|\s)(?:✓([^\s✓][^✓]*?)|✅\s*(\d{4}-\d{2}-\d{2}))\s*$/;
const REPEAT_RULE = /^every (?:(other|second|third|fourth|\d+(?:st|nd|rd|th)?) )?(day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/;

/** A normalised `every …` rule (lower case, single spaces), or undefined when it is not one. */
export function parseRepeatRule(value: string): string | undefined {
  const rule = value.trim().toLowerCase().replace(/\s+/g, " ");
  const match = REPEAT_RULE.exec(rule);
  if (!match) return undefined;
  const count = match[1] ? ({ other: 2, second: 2, third: 3, fourth: 4 }[match[1]] ?? parseInt(match[1], 10)) : 1;
  return Number.isInteger(count) && count >= 1 && count <= 1000 ? rule : undefined;
}

const REPEAT_WORDS: Record<string, string> = {
  daily: "every day", weekly: "every week", fortnightly: "every 2 weeks", biweekly: "every 2 weeks",
  monthly: "every month", yearly: "every year", annually: "every year"
};

/**
 * A repeat typed loosely: "every 3 days", "weekly", "monday", "2 weeks"; several at once too, apart or joined by
 * commas or "and" ("every monday every friday", "monday, friday"). Undefined when any part is not a rule.
 */
export function parseRepeatInput(value: string): string | undefined {
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return undefined;
  const parts = text.split(/\s*,\s*|\s+and\s+|\s+(?=every\s)/).filter(Boolean);
  const rules = parts.map(part => parseRepeatRule(REPEAT_WORDS[part] ?? (part.startsWith("every ") ? part : `every ${part}`)));
  return rules.length && rules.every(Boolean) ? [...new Set(rules)].join(" ") : undefined;
}

/** A task's repeat as its rules: "every monday every friday" repeats on both days, whichever comes first. */
export function repeatRuleList(repeat: string): string[] {
  return repeat.split(/\s+(?=every\s)/i).map(rule => rule.trim()).filter(Boolean);
}

/** Display text for a repeat, e.g. "Every Monday", or "Every Monday, every Friday" for several rules. */
export function repeatLabel(repeat: string): string {
  return repeatRuleList(repeat).map((rule, index) => (index ? rule : rule.replace(/^every/, "Every"))
    .replace(/\b(sun|mon|tues|wednes|thurs|fri|satur)day/g, day => day[0].toUpperCase() + day.slice(1))).join(", ");
}

interface PlainDateShape { wordCounts: Set<number>; needsDigit: boolean }
const plainDateShapes = new Map<string, PlainDateShape>();

/** Word counts (and whether a digit is required) of every date these formats can produce, plus ISO. */
function plainDateShape(dateFormat: string[]): PlainDateShape {
  const key = dateFormat.join("\u0000");
  let shape = plainDateShapes.get(key);
  if (!shape) {
    shape = { wordCounts: new Set([1]), needsDigit: true };
    // One sample per month, on varying weekdays, covers every month and day name.
    for (let month = 0; month < 12; month++) {
      const sample = formatLocalDate(new Date(2026, month, 1 + (month * 5) % 28));
      for (const format of dateFormat) {
        const label = formatDate(sample, format).trim();
        shape.wordCounts.add(label.split(/\s+/).length);
        if (!/\d/.test(label)) shape.needsDigit = false;
      }
    }
    plainDateShapes.set(key, shape);
  }
  return shape;
}

/** Plain metadata must exactly match the configured date format (or ISO), optionally followed by an HH:mm time. */
function plainScheduled(text: string, reference: Date, dateFormat: string[]): RegExpExecArray | null {
  const { wordCounts, needsDigit } = plainDateShape(dateFormat);
  const words = [...text.matchAll(/(?:^|\s)\S+/g)];
  const timed = /^\s*\d{2}:\d{2}$/.test(words[words.length - 1]?.[0] ?? "");
  for (let word = 0; word < words.length; word++) {
    // Skip suffixes whose shape cannot be a formatted date, before any date parsing.
    const count = words.length - word;
    if (!wordCounts.has(count) && !(timed && wordCounts.has(count - 1))) continue;
    const index = words[word].index ?? 0;
    const value = text.slice(index).trim();
    if ((needsDigit && !/\d/.test(value)) || /[[\]{}]/.test(value)) continue;
    const parsed = parseDateTimeExpression(value, reference, dateFormat, true);
    if (!parsed) continue;
    const time = parsed.time ? ` ${parsed.time}` : "";
    if (!dateFormat.some(format => value === `${formatDate(parsed.date, format)}${time}`) && value !== `${parsed.date}${time}`) continue;
    const match: RegExpExecArray = Object.assign([text.slice(index), value] as [string, string], { index, input: text });
    return match;
  }
  return null;
}

export interface ParsedTokenRange {
  kind: "tags" | "scheduledDate" | "deadline" | "defer" | "durationMinutes" | "priority" | "repeat" | "completedDate";
  from: number;
  to: number;
}

/** Internal ranges, including the destination and block ID that public callers never style. */
interface LineRange { kind: ParsedTokenRange["kind"] | "destination" | "blockId"; from: number; to: number }

export interface ParsedTaskLine extends ParsedTaskMetadata {
  indent: number;
  status: TaskStatus;
  completed: boolean;
  destination?: string;
}

function normalizeDestination(value: string): string | undefined {
  try {
    const { path, heading } = splitDestination(value);
    return destinationString(path, heading);
  } catch { return undefined; }
}

function indentWidth(value: string): number {
  return [...value].reduce((total, character) => total + (character === "\t" ? 4 : 1), 0);
}

export function durationToMinutes(value: string): number | undefined {
  if (!value || !/^((\d+)h)?((\d+)m)?$/i.test(value)) return undefined;
  const hours = /([0-9]+)h/i.exec(value)?.[1];
  const minutes = /([0-9]+)m/i.exec(value)?.[1];
  const total = Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return total > 0 ? total : undefined;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h` : ""}${remainder ? `${remainder}m` : ""}`;
}

export function parseTaskLine(
  line: string,
  reference = new Date(),
  dateFormat?: string,
  naturalDates = false,
  tokenRanges?: ParsedTokenRange[],
  fallbackDateFormats: string[] = []
): ParsedTaskLine | undefined {
  return parseLine(line, reference, dateFormat, naturalDates, tokenRanges, fallbackDateFormats, false);
}

function parseLine(
  line: string,
  reference: Date,
  dateFormat: string | undefined,
  naturalDates: boolean,
  tokenRanges: LineRange[] | undefined,
  fallbackDateFormats: string[],
  internalRanges: boolean
): ParsedTaskLine | undefined {
  const dateFormats = [dateFormat ?? "YYYY-MM-DD", ...fallbackDateFormats];
  const checkbox = CHECKBOX.exec(line);
  if (!checkbox) return undefined;

  const offset = line.length - checkbox[3].length;
  let remainder = checkbox[3].trimEnd();
  // A trailing Obsidian block ID stays outside the title; metadata before it still parses.
  const blockId = BLOCK_ID.exec(remainder);
  if (blockId) {
    if (internalRanges) tokenRanges?.push({ kind: "blockId", from: offset + blockId.index + 1, to: offset + remainder.length });
    remainder = remainder.slice(0, blockId.index).trimEnd();
  }
  const metadata: Omit<ParsedTaskLine, "title" | "indent" | "status" | "completed"> = {};
  const consumed = new Set<string>();
  const recordToken = (kind: LineRange["kind"], match: RegExpExecArray): void => {
    if (kind !== "destination" || internalRanges) tokenRanges?.push({ kind, from: offset + match.index + match[0].search(/\S/), to: offset + remainder.trimEnd().length });
  };

  // A lone time held for a date further left, with the parse as it stood before it, to go back to if none comes.
  // (Reading natural language, the time is found with its date instead: "tomorrow p1 3pm".)
  let pendingTime: { time: string; remainder: string; metadata: typeof metadata; ranges: number } | undefined;
  for (;;) {
    let match: RegExpExecArray | null;
    let defer: ReturnType<typeof parseDefer>;
    let text: string | undefined;
    let changed = false;

    if ((match = trailingTag().exec(remainder)) && match[1].trim()) {
      metadata.tags = [match[1].trim(), ...(metadata.tags ?? [])];
      recordToken("tags", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      changed = true;
    } else if (!consumed.has("destination") && (match = DESTINATION.exec(remainder))) {
      const destination = normalizeDestination(match[1]);
      if (destination) {
        metadata.destination = destination;
        recordToken("destination", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("destination");
        changed = true;
      }
    } else if (!consumed.has("completedDate") && (match = COMPLETED.exec(remainder)) && (text = parseCompletedDate(match[1] ?? match[2], reference, dateFormats))) {
      metadata.completedDate = text;
      recordToken("completedDate", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      consumed.add("completedDate");
      changed = true;
    } else if (!consumed.has("priority") && (match = PRIORITY.exec(remainder))) {
      metadata.priority = Number(match[1]) as Priority;
      recordToken("priority", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      consumed.add("priority");
      changed = true;
    } else if (!consumed.has("deadline") && (match = DEADLINE.exec(remainder))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormats);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        recordToken("deadline", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("deadline");
        changed = true;
      }
    } else if (!consumed.has("defer") && (match = DEFER.exec(remainder)) && (defer = parseDefer(match[1], reference, dateFormats))) {
      Object.assign(metadata, defer);
      recordToken("defer", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      consumed.add("defer");
      changed = true;
    } else if (!consumed.has("duration") && (match = DURATION.exec(remainder))) {
      const minutes = durationToMinutes(match[1]);
      if (minutes) {
        metadata.durationMinutes = minutes;
        recordToken("durationMinutes", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("duration");
        changed = true;
      }
    } else if ((match = REPEAT.exec(remainder)) && (text = parseRepeatRule(match[1]))) {
      // Several `every …` rules may follow one another; the task repeats on each (they are read from the end).
      if (!repeatRuleList(metadata.repeat ?? "").includes(text)) metadata.repeat = metadata.repeat ? `${text} ${metadata.repeat}` : text;
      recordToken("repeat", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      changed = true;
    } else if (!consumed.has("scheduled") && (match = ((match = SCHEDULED.exec(remainder)) && parseDateTimeExpression(match[1], reference, dateFormats))
      ? match : plainScheduled(remainder, reference, dateFormats))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormats);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        recordToken("scheduledDate", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("scheduled");
        changed = true;
      }
    } else if (!naturalDates && !pendingTime && !consumed.has("scheduled") && (match = LONE_TIME.exec(remainder)) && (text = parseTimeExpression(match[1], reference))) {
      pendingTime = { time: text, remainder, metadata: { ...metadata }, ranges: tokenRanges?.length ?? 0 };
      recordToken("scheduledDate", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      changed = true;
    }

    if (!changed && naturalDates && !consumed.has("deadline")) {
      const date = findInputDeadline(remainder, reference, dateFormat);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        remainder = `${remainder.slice(0, date.index)} ${remainder.slice(date.index + date.text.length)}`.replace(/ {2,}/g, " ").trim();
        consumed.add("deadline");
        changed = true;
      }
    }

    if (!changed && naturalDates && !consumed.has("scheduled")) {
      // A date and a time may be written apart ("tomorrow p1 3pm"); both parts come out of the title.
      const date = findInputDate(remainder, reference);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        remainder = removeSpans(remainder, date.parts).replace(/ {2,}/g, " ").trim();
        consumed.add("scheduled");
        changed = true;
      }
    }

    // A time typed apart from a date token gives that date its time.
    if (!changed && naturalDates && metadata.scheduledDate && !metadata.scheduledTime && !consumed.has("time")) {
      const time = findInputTime(remainder, reference);
      if (time) {
        metadata.scheduledTime = time.time;
        remainder = removeSpans(remainder, [time]).replace(/ {2,}/g, " ").trim();
        consumed.add("time");
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (pendingTime) {
    // The time belongs to the date before it; with none (or one that has its own time), it is title text, and so is
    // everything before it.
    if (metadata.scheduledDate && !metadata.scheduledTime) metadata.scheduledTime = pendingTime.time;
    else {
      remainder = pendingTime.remainder;
      for (const key of Object.keys(metadata) as (keyof typeof metadata)[]) delete metadata[key];
      Object.assign(metadata, pendingTime.metadata);
      if (tokenRanges) tokenRanges.length = pendingTime.ranges;
    }
  }

  if (metadata.tags) metadata.tags = [...new Set(metadata.tags)];
  const status = statusFromChar(checkbox[2])!;
  return {
    title: remainder.trim(),
    indent: indentWidth(checkbox[1]),
    status,
    completed: isClosedStatus(status),
    ...metadata
  };
}

/** A defer is a date without a time, or `someday`. */
function parseDefer(value: string, reference: Date, dateFormats: string[]): Pick<ParsedTaskMetadata, "deferDate" | "someday"> | undefined {
  if (/^someday$/i.test(value)) return { someday: true };
  const date = parseDateTimeExpression(value, reference, dateFormats);
  return date && !date.time ? { deferDate: date.date } : undefined;
}

function parseCompletedDate(value: string, reference: Date, dateFormats: string[]): string | undefined {
  const date = parseDateTimeExpression(value, reference, dateFormats, true);
  return date && !date.time ? date.date : undefined;
}

function deferText(draft: Pick<ParsedTaskMetadata, "deferDate" | "someday">, dateText: (date: string) => string): string {
  return draft.someday ? ">someday" : draft.deferDate ? `>${dateText(draft.deferDate)}` : "";
}

/** Where each metadata token sits in a task's text (without its "- [ ] "), the destination included. */
export function taskTextRanges(text: string, reference = new Date(), dateFormat?: string): Array<{ kind: ParsedTokenRange["kind"] | "destination"; from: number; to: number }> {
  const prefix = "- [ ] ";
  return taskLineRanges(prefix + text, reference, dateFormat).map(range => ({ ...range, from: range.from - prefix.length, to: range.to - prefix.length }));
}

/** Where a whole task line (checkbox and indent included) sets properties, its destination too; empty for other lines. */
export function taskLineRanges(line: string, reference = new Date(), dateFormat?: string): Array<{ kind: ParsedTokenRange["kind"] | "destination"; from: number; to: number }> {
  const ranges: LineRange[] = [];
  parseLine(line, reference, dateFormat, false, ranges, [], true);
  return ranges.filter((range): range is LineRange & { kind: ParsedTokenRange["kind"] | "destination" } => range.kind !== "blockId");
}

export function parseTaskInput(
  input: string,
  reference = new Date(),
  dateFormat?: string,
  naturalDates = true
): ParsedTaskLine | undefined {
  const normalized = CHECKBOX.test(input) ? input : `- [ ] ${input}`;
  return parseTaskLine(normalized, reference, dateFormat, naturalDates);
}

export function serializeTask(draft: TaskDraft, dateFormat?: string, linkDates = true): string {
  const indent = " ".repeat(Math.max(0, draft.indent));
  const title = draft.title.trim();
  const dateText = (date: string): string => linkDates ? `[[${formatDate(date, dateFormat)}]]` : formatDate(date, dateFormat);
  const metadata = [
    draft.scheduledDate ? `${dateText(draft.scheduledDate)}${draft.scheduledTime ? ` ${draft.scheduledTime}` : ""}` : "",
    draft.durationMinutes ? formatDuration(draft.durationMinutes) : "",
    draft.deadline ? `{${dateText(draft.deadline)}${draft.deadlineTime ? ` ${draft.deadlineTime}` : ""}}` : "",
    draft.repeat ?? "",
    deferText(draft, dateText),
    draft.priority ? `p${draft.priority}` : "",
    formatTags(draft.tags),
    draft.completedDate ? `✓${dateText(draft.completedDate)}` : ""
  ].filter(Boolean);
  const metadataGap = metadata.length ? " " : "";
  return `${indent}- [${STATUS_CHARS[draftStatus(draft)]}] ${title}${metadataGap}${metadata.join(" ")}`;
}

const CANONICAL_ORDER: LineRange["kind"][] = ["scheduledDate", "durationMinutes", "deadline", "repeat", "defer", "priority", "tags", "completedDate", "destination"];

/**
 * Edit an existing task line in place: keep indentation, checkbox spacing, title spelling,
 * unchanged tokens, `~[[destination]]` and a trailing `^blockid`; replace or remove changed
 * tokens where they stand and add new ones in serializeTask's canonical order.
 */
export function rewriteTaskLine(raw: string, draft: TaskDraft, dateFormat?: string, linkDates = true, reference = new Date()): string {
  const checkbox = CHECKBOX.exec(raw);
  const ranges: LineRange[] = [];
  const parsed = checkbox && parseLine(raw, reference, dateFormat, false, ranges, [], true);
  if (!checkbox || !parsed) return serializeTask(draft, dateFormat, linkDates);
  const offset = raw.length - checkbox[3].length;
  const leading = checkbox[1];
  const indent = indentWidth(leading) === draft.indent ? leading : " ".repeat(Math.max(0, draft.indent));
  let marker = raw.slice(leading.length, offset);
  const status = draftStatus(draft);
  if (parsed.status !== status) marker = marker.replace(/\[.\]/, `[${STATUS_CHARS[status]}]`);

  ranges.sort((a, b) => a.from - b.from);
  const blockId = ranges.find(range => range.kind === "blockId");
  const tokens = ranges.filter(range => range !== blockId);
  const contentEnd = offset + checkbox[3].trimEnd().length;
  const titleText = raw.slice(offset, tokens[0]?.from ?? blockId?.from ?? contentEnd).trimEnd();
  const title = draft.title.trim() === parsed.title ? titleText : draft.title.trim();

  const dateText = (date: string): string => linkDates ? `[[${formatDate(date, dateFormat)}]]` : formatDate(date, dateFormat);
  const scheduledTime = draft.scheduledDate ? draft.scheduledTime ?? "" : "";
  const deadlineTime = draft.deadline ? draft.deadlineTime ?? "" : "";
  const draftTags = normalizeTags(draft.tags);
  const parsedTags = parsed.tags ?? [];
  const wanted: Partial<Record<LineRange["kind"], string | undefined>> = {
    scheduledDate: parsed.scheduledDate === draft.scheduledDate && (parsed.scheduledTime ?? "") === scheduledTime ? undefined
      : draft.scheduledDate ? `${dateText(draft.scheduledDate)}${scheduledTime ? ` ${scheduledTime}` : ""}` : "",
    repeat: (parsed.repeat ?? "") === (draft.repeat ?? "") ? undefined : draft.repeat ?? "",
    durationMinutes: (parsed.durationMinutes ?? 0) === (draft.durationMinutes ?? 0) ? undefined : draft.durationMinutes ? formatDuration(draft.durationMinutes) : "",
    deadline: parsed.deadline === draft.deadline && (parsed.deadlineTime ?? "") === deadlineTime ? undefined
      : draft.deadline ? `{${dateText(draft.deadline)}${deadlineTime ? ` ${deadlineTime}` : ""}}` : "",
    defer: deferText(parsed, dateText) === deferText(draft, dateText) ? undefined : deferText(draft, dateText),
    priority: (parsed.priority ?? 0) === (draft.priority ?? 0) ? undefined : draft.priority ? `p${draft.priority}` : "",
    tags: draftTags.length === parsedTags.length && draftTags.every(tag => parsedTags.includes(tag)) ? undefined : formatTags(draftTags),
    completedDate: parsed.completedDate === draft.completedDate ? undefined : draft.completedDate ? `✓${dateText(draft.completedDate)}` : ""
  };

  // Each part carries the whitespace that preceded it; undefined `wanted` keeps the source text.
  const parts: Array<{ kind: LineRange["kind"]; gap: string; text: string }> = [];
  const present = new Set<LineRange["kind"]>();
  let previous = offset + titleText.length;
  for (const token of tokens) {
    const gap = raw.slice(previous, token.from);
    previous = token.to;
    const replacement = wanted[token.kind];
    const first = !present.has(token.kind);
    present.add(token.kind);
    if (replacement === undefined) parts.push({ kind: token.kind, gap, text: raw.slice(token.from, token.to) });
    else if (first && replacement) parts.push({ kind: token.kind, gap, text: replacement });
  }
  for (const kind of CANONICAL_ORDER) {
    const text = wanted[kind];
    if (present.has(kind) || !text) continue;
    const rank = CANONICAL_ORDER.indexOf(kind);
    let index = 0;
    parts.forEach((part, position) => { if (CANONICAL_ORDER.indexOf(part.kind) < rank) index = position + 1; });
    parts.splice(index, 0, { kind, gap: " ", text });
  }
  if (blockId) parts.push({ kind: "blockId", gap: raw.slice(previous, blockId.from), text: raw.slice(blockId.from, blockId.to) });
  const body = parts.reduce((text, part) => text + (text ? part.gap || " " : "") + part.text, title);
  const line = indent + marker + body + raw.slice(blockId?.to ?? contentEnd);
  return draft.sortProperties ? sortTaskProperties(line, dateFormat, reference) : line;
}

/**
 * A task line with its properties in the usual order (date and time, duration, deadline, repeat, defer, priority,
 * tags, completion date), each keeping its spelling; the spacing between them and a destination stay put.
 */
export function sortTaskProperties(line: string, dateFormat?: string, reference = new Date()): string {
  const ranges: ParsedTokenRange[] = [];
  parseTaskLine(line, reference, dateFormat, false, ranges);
  ranges.sort((a, b) => a.from - b.from);
  const tokens = [...ranges].sort((a, b) => CANONICAL_ORDER.indexOf(a.kind) - CANONICAL_ORDER.indexOf(b.kind))
    .map(range => line.slice(range.from, range.to));
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    line = line.slice(0, range.from) + tokens[index] + line.slice(range.to);
  }
  return line;
}

/** Add, replace or (with no date) remove a line's completion date in place. */
export function withCompletedDate(raw: string, date: string | undefined, dateFormat?: string, linkDates = true, reference = new Date()): string {
  const parsed = parseTaskLine(raw, reference, dateFormat);
  if (!parsed || parsed.completedDate === date) return raw;
  return rewriteTaskLine(raw, { ...parsed, destination: "", completedDate: date }, dateFormat, linkDates, reference);
}

export function serializeTaskInput(draft: TaskDraft, dateFormat?: string, linkDates = true): string {
  const { path, heading } = splitDestination(draft.destination);
  const destination = destinationString(path.replace(/\.md$/i, ""), heading);
  return `${serializeTask(draft, dateFormat, linkDates)} ~[[${destination}]]`;
}

// scanTasks reparses whole notes on every change; unchanged lines reuse their parse.
// Keyed by the reference day, so relative dates resolve afresh each day.
let parseCacheContext = "";
const parseCache = new Map<string, ParsedTaskLine | null>();

function cachedParseTaskLine(line: string, reference: Date, dateFormat?: string): ParsedTaskLine | undefined {
  if (!CHECKBOX.test(line)) return undefined;
  // The Tag format decides what counts as a tag, so a switch reads every line again.
  const context = `${dateFormat ?? ""}\u0000${formatLocalDate(reference)}\u0000${tagFormat()}`;
  if (context !== parseCacheContext) { parseCache.clear(); parseCacheContext = context; }
  let parsed = parseCache.get(line);
  if (parsed === undefined) {
    if (parseCache.size >= 250_000) parseCache.clear();
    parsed = parseTaskLine(line, reference, dateFormat) ?? null;
    parseCache.set(line, parsed);
  }
  return parsed ?? undefined;
}

export function scanTasks(path: string, content: string, reference = new Date(), dateFormat?: string, sectionHeadingLevel = 1): Task[] {
  const tasks: Task[] = [];
  const stack: Task[] = [];
  const sourceLines = content.split(/\r?\n/);
  const descriptions = new Map<Task, { lines: string[]; lineNumbers: number[]; bulletIndent: number }>();
  const headings = new Map(scanSections(content, sectionHeadingLevel).map((heading) => [heading.line, heading]));
  let section: ReturnType<typeof scanSections>[number] | undefined;

  for (const { text: line, line: lineNumber } of bodyLines(content)) {
    const heading = headings.get(lineNumber);
    if (heading) { section = heading; stack.length = 0; }
    const parsed = cachedParseTaskLine(line, reference, dateFormat);
    if (!parsed) {
      if (!line.trim()) continue;
      const indent = indentWidth(/^[ \t]*/.exec(line)?.[0] ?? "");
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const owner = stack[stack.length - 1];
      if (!owner) continue;
      const marker = /^[ \t]*[-+*][ \t]+(.*)$/.exec(line);
      if (marker && /^\[[^\]]\](?:\s|$)/.test(marker[1])) continue;
      const bullet = Boolean(marker);
      const description = descriptions.get(owner);
      if (bullet || (description && indent > description.bulletIndent)) {
        const entry = description ?? { lines: [], lineNumbers: [], bulletIndent: indent };
        const previous = entry.lineNumbers[entry.lineNumbers.length - 1];
        if (previous !== undefined && sourceLines.slice(previous + 1, lineNumber).every(text => !text.trim())) {
          for (let blank = previous + 1; blank < lineNumber; blank++) { entry.lines.push(""); entry.lineNumbers.push(blank); }
        }
        entry.lineNumbers.push(lineNumber);
        entry.lines.push(" ".repeat(indent) + line.trimStart());
        if (bullet) entry.bulletIndent = indent;
        descriptions.set(owner, entry);
      }
      continue;
    }

    while (stack.length && stack[stack.length - 1].indent >= parsed.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const task: Task = {
      id: `${path}:${lineNumber}`,
      path,
      line: lineNumber,
      endLine: lineNumber,
      raw: line,
      section: section?.name,
      sectionLine: section?.line,
      childIds: [],
      parentId: parent?.id,
      ...parsed,
      // Cached parses are shared between identical lines; give each task its own array.
      ...(parsed.tags ? { tags: [...parsed.tags] } : {})
    };
    parent?.childIds.push(task.id);
    tasks.push(task);
    stack.push(task);
  }

  for (const [task, { lines, lineNumbers }] of descriptions) {
    const margin = Math.min(...lines.filter(line => line.trim()).map(line => indentWidth(/^[ ]*/.exec(line)?.[0] ?? "")));
    task.descriptionLines = lineNumbers;
    task.description = lines.map(line => line.slice(margin)).join("\n");
  }

  // A subtree ends at its last descendant; children always follow their parent.
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const task = tasks[index];
    for (const child of task.childIds) task.endLine = Math.max(task.endLine, byId.get(child)!.endLine);
  }

  return tasks;
}
