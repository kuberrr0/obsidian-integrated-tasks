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

export function parseDateExpression(
  value: string,
  reference = new Date(),
  dateFormat = DEFAULT_DATE_FORMAT
): string | undefined {
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
  if (formatted.isValid()) return formatted.format(DEFAULT_DATE_FORMAT);

  const parsed = chrono.parse(trimmed, reference, { forwardDate: true }).find((result) =>
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

/** Find a date in editor prose without interpreting links or inline code as dates. */
export function findInputDate(value: string, reference = new Date()): { index: number; text: string; date: string; time?: string } | undefined {
  const prose = value.replace(/\{[^}]*\}?|\[\[[\s\S]*?\]\]|`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\b(?:\d+h(?:\d+m)?|\d+m)\b/g, (match) => " ".repeat(match.length));
  const result = chrono.parse(prose, reference, { forwardDate: true }).find((match) =>
    !match.end && (match.start.isCertain("day") || match.start.isCertain("weekday") || match.start.isCertain("hour"))
  );
  return result ? { index: result.index, text: result.text, date: formatLocalDate(result.start.date()), ...(resultTime(result) ? { time: resultTime(result) } : {}) } : undefined;
}


/** Curly braces route editor dates to Deadline, even in the middle of a title. */
export function findInputDeadline(value: string, reference = new Date(), dateFormat?: string): { index: number; text: string; date: string; time?: string } | undefined {
  const prose = value.replace(/`[^`]*`|\[\[[\s\S]*?\]\]|\[[^\]]*\]\([^)]*\)/g, (match) => " ".repeat(match.length));
  const pattern = /(?:^|\s)\{([^{}[\]]+)\}(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose))) {
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

export function parseDateTimeExpression(value: string, reference = new Date(), dateFormat = DEFAULT_DATE_FORMAT): { date: string; time?: string } | undefined {
  const text = value.trim();
  const link = /^\[\[([^\]]+)\]\](?:\s+(.+))?$/.exec(text);
  if (link) {
    const date = parseDateExpression(link[1], reference, dateFormat);
    const time = link[2] ? parseTimeExpression(link[2], reference) : undefined;
    return date && (!link[2] || time) ? { date, ...(time ? { time } : {}) } : undefined;
  }
  // Try strict dates first so custom Daily Notes formats retain their meaning.
  for (let index = text.length; index > 0; index--) {
    if (index !== text.length && text[index] !== " ") continue;
    const prefix = text.slice(0, index);
    const strict = moment(prefix, [DEFAULT_DATE_FORMAT, dateFormat], true);
    if (!strict.isValid()) continue;
    const suffix = text.slice(index).trim();
    const time = suffix ? parseTimeExpression(suffix, reference) : undefined;
    if (!suffix || time) return { date: strict.format(DEFAULT_DATE_FORMAT), ...(time ? { time } : {}) };
  }
  const result = chrono.parse(text, reference, { forwardDate: true }).find((match) =>
    match.index === 0 && match.text.length === text.length && !match.end &&
    (match.start.isCertain("day") || match.start.isCertain("weekday"))
  );
  return result ? { date: formatLocalDate(result.start.date()), ...(resultTime(result) ? { time: resultTime(result) } : {}) } : undefined;
}

export function formatDateTime(date: string, time?: string, dateFormat?: string): string {
  return `${formatDate(date, dateFormat)}${time ? ` ${time}` : ""}`;
}
