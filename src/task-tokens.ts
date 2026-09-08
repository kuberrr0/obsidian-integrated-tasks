import { formatDate, todayIso } from "./date";
import { formatDuration, parseTaskLine, type ParsedTokenRange } from "./parser";

export interface TaskToken extends ParsedTokenRange {
  label: string;
  description: string;
  linkText?: string;
  priority?: number;
  dateLabel?: string;
  time?: string;
  overdue?: boolean;
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
      const original = link?.[1] ?? source.slice(1, -1).trim();
      const label = link ? dateLabel : value;
      const display = original === label ? undefined : {
        from: range.from + (link?.index ?? 1),
        to: link ? range.from + link.index + link[0].length : range.to - 1,
        label,
        linkText: link?.[1]
      };
      return { ...range, label: `${range.kind === "deadline" ? "Due " : ""}${value}`,
        description: `${range.kind === "deadline" ? "Deadline" : "Scheduled"}: ${value}`,
        dateLabel, time, linkText: link?.[1], display,
        overdue: !parsed.completed && (range.kind === "scheduledDate" ? parsed.scheduledDate! : parsed.deadline!) < todayIso() };
    }
    switch (range.kind) {
      case "tags": return { ...range, label: link![1].trim(), description: `Tag: ${link![1].trim()}`, linkText: link![1] };
      case "durationMinutes": return { ...range, label: formatDuration(parsed.durationMinutes!), description: `Duration: ${formatDuration(parsed.durationMinutes!)}` };
      case "priority": return { ...range, label: `P${parsed.priority}`, description: `Priority ${parsed.priority}`, priority: parsed.priority };
    }
  });
}

export function tokenClass(token: TaskToken): string {
  return `tm-note-token tm-note-token-${token.kind}${token.priority ? ` is-p${token.priority}` : ""}${token.overdue ? " is-danger" : ""}`;
}
