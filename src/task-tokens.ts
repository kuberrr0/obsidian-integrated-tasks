import { formatDuration, parseTaskLine, type ParsedTokenRange } from "./parser";

export interface TaskToken extends ParsedTokenRange {
  label: string;
  description: string;
  linkText?: string;
  priority?: number;
}

/** Ranges come from the task parser so ordinary prose never gets styled as metadata. */
export function taskTokens(line: string, dateFormat?: string): TaskToken[] {
  const ranges: ParsedTokenRange[] = [];
  const parsed = parseTaskLine(line, new Date(), dateFormat, false, ranges);
  if (!parsed) return [];
  return ranges.sort((a, b) => a.from - b.from).map((range) => {
    const source = line.slice(range.from, range.to);
    const date = /\[\[([^\]]+)\]\]/.exec(source)?.[1] ?? source.replace(/^\{|\}$/g, "").trim();
    switch (range.kind) {
      case "scheduledDate": return { ...range, label: `${date}${parsed.scheduledTime ? ` ${parsed.scheduledTime}` : ""}`, description: `Scheduled: ${date}${parsed.scheduledTime ? ` ${parsed.scheduledTime}` : ""}`, linkText: date };
      case "deadline": return { ...range, label: `Due ${date}${parsed.deadlineTime && source.includes("[[") ? ` ${parsed.deadlineTime}` : ""}`, description: `Deadline: ${date}${parsed.deadlineTime && source.includes("[[") ? ` ${parsed.deadlineTime}` : ""}`, linkText: source.includes("[[") ? date : undefined };
      case "durationMinutes": return { ...range, label: formatDuration(parsed.durationMinutes!), description: `Duration: ${formatDuration(parsed.durationMinutes!)}` };
      case "priority": return { ...range, label: `P${parsed.priority}`, description: `Priority ${parsed.priority}`, priority: parsed.priority };
    }
  });
}

export function tokenClass(token: TaskToken): string {
  return `tm-note-token tm-note-token-${token.kind}${token.priority ? ` is-p${token.priority}` : ""}`;
}
