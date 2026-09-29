import { deadlineIsDistant } from "./task-row-details";
import { parseRecurringLog } from "./recurring-log";
import { formatDate, todayIso } from "./date";
import { formatDuration, parseTaskLine, repeatLabel, type ParsedTokenRange } from "./parser";
import { isDeferred } from "./query";

export interface TaskToken extends Omit<ParsedTokenRange, "kind"> {
  kind: ParsedTokenRange["kind"] | "completed" | "skipped" | "failed";
  label: string;
  description: string;
  linkText?: string;
  priority?: number;
  dateLabel?: string;
  time?: string;
  overdue?: boolean;
  distant?: boolean;
  /** A defer that currently hides the task. */
  active?: boolean;
  display?: { from: number; to: number; label: string; linkText?: string };
}

/** Ranges come from the task parser so ordinary prose never gets styled as metadata. */
export function taskTokens(line: string, dateFormat?: string): TaskToken[] {
  const ranges: ParsedTokenRange[] = [];
  const parsed = parseTaskLine(line, new Date(), dateFormat, false, ranges);
  if (!parsed) return [];
  return ranges.sort((a, b) => a.from - b.from).map((range) => {
    const source = line.slice(range.from, range.to);
    const link = /\[\[([^\]]+)\]\]/.exec(source);
    if (range.kind === "scheduledDate" || range.kind === "deadline") {
      const dateLabel = formatDate((range.kind === "scheduledDate" ? parsed.scheduledDate : parsed.deadline)!, dateFormat);
      const time = range.kind === "scheduledDate" ? parsed.scheduledTime : parsed.deadlineTime;
      const value = `${dateLabel}${time ? ` ${time}` : ""}`;
      const braced = range.kind === "deadline";
      const original = link?.[1] ?? (braced ? source.slice(1, -1).trim() : source);
      const label = link ? dateLabel : value;
      const display = original === label ? undefined : {
        from: range.from + (link?.index ?? (braced ? 1 : 0)),
        to: link ? range.from + link.index + link[0].length : range.to - (braced ? 1 : 0),
        label,
        linkText: link?.[1]
      };
      return { ...range, label: `${range.kind === "deadline" ? "Due " : ""}${value}`,
        description: `${range.kind === "deadline" ? "Deadline" : "Scheduled"}: ${value}`,
        distant: range.kind === "deadline" && deadlineIsDistant(parsed.deadline),
        dateLabel, time, linkText: link?.[1], display,
        overdue: !parsed.completed && (range.kind === "scheduledDate" ? parsed.scheduledDate! : parsed.deadline!) < todayIso() };
    }
    if (range.kind === "defer") {
      const active = isDeferred(parsed);
      if (parsed.someday) return { ...range, label: "Someday", description: "Hidden until someday", active };
      const dateLabel = formatDate(parsed.deferDate!, dateFormat);
      const original = link?.[1] ?? source.slice(1);
      const display = original === dateLabel ? undefined : {
        from: range.from + (link?.index ?? 1), to: link ? range.from + link.index + link[0].length : range.to, label: dateLabel, linkText: link?.[1]
      };
      return { ...range, label: `Hidden until ${dateLabel}`, description: `Hidden until: ${dateLabel}`, dateLabel, linkText: link?.[1], display, active };
    }
    if (range.kind === "completedDate") {
      const dateLabel = formatDate(parsed.completedDate!, dateFormat);
      const prefix = /^(?:✓|✅\s*)/.exec(source)![0].length;
      // Always displayed, so Live Preview can hide the prefix behind the pill's icon.
      const display = { from: range.from + (link?.index ?? prefix), to: link ? range.from + link.index + link[0].length : range.to, label: dateLabel, linkText: link?.[1] };
      return { ...range, label: `Done ${dateLabel}`, description: `Completed: ${dateLabel}`, dateLabel, linkText: link?.[1], display };
    }
    switch (range.kind) {
      case "repeat": return { ...range, label: repeatLabel(parsed.repeat!), description: `Repeats ${parsed.repeat}` };
      // A #[[tag]] links to its note; a #tag is Obsidian's own tag.
      case "tags": {
        const name = link ? link[1].trim() : source.trim().replace(/^#/, "");
        return { ...range, label: name, description: `Tag: ${name}`, ...(link ? { linkText: link[1] } : {}) };
      }
      case "durationMinutes": return { ...range, label: formatDuration(parsed.durationMinutes!), description: `Duration: ${formatDuration(parsed.durationMinutes!)}` };
      case "priority": return { ...range, label: `P${parsed.priority}`, description: `Priority ${parsed.priority}`, priority: parsed.priority };
    }
  });
}

export function tokenClass(token: TaskToken): string {
  return `tm-note-token tm-note-token-${token.kind}${token.priority ? ` is-p${token.priority}` : ""}${token.overdue ? " is-danger" : ""}${token.distant ? " is-distant" : ""}${token.active ? " is-active" : ""}`;
}

/** Standalone recurrence history entries, outside checklist metadata. */
export function recurringLogTokens(line: string, dateFormat?: string): TaskToken[] {
  const entry = parseRecurringLog(line, [dateFormat ?? "YYYY-MM-DD"]);
  if (!entry) return [];
  const { from, to } = entry;
  const dateLabel = formatDate(entry.date, dateFormat);
  const label = `${entry.outcome}: ${dateLabel}`;
  return [{ from, to, kind: entry.outcome.toLowerCase() as "completed" | "skipped" | "failed", label, description: label, dateLabel,
    display: entry.linked || line.slice(entry.dateFrom, entry.dateTo) !== dateLabel
      ? { from: entry.dateFrom, to: entry.dateTo, label: dateLabel, linkText: entry.linkText } : undefined }];
}
