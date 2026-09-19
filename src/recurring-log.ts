import { moment as obsidianMoment } from "obsidian";
import type momentFactory from "moment";
import { formatDate } from "./date";
import { bodyLines } from "./structure";

const moment = obsidianMoment as unknown as typeof momentFactory;

export function parseRecurringLog(line: string, formats: string[] = ["YYYY-MM-DD"]) {
    const match = /^([ \t]*)(COMPLETED|SKIPPED|FAILED):([ \t]+)(\[\[[^\]\r\n]+\]\]|\S(?:.*?\S)?)([ \t]*)$/.exec(line);
    if (!match) return undefined;
    const linked = match[4].startsWith("[[");
    const value = linked ? match[4].slice(2, -2) : match[4];
    // Strict parsing prevents ordinary prose from becoming a history entry.
    let date: string | undefined;
    for (const format of [...new Set([...formats, "YYYY-MM-DD"])]) {
        const parsed = moment(value, format, true);
        if (parsed.isValid()) { date = parsed.format("YYYY-MM-DD"); break; }
    }
    if (!date) return undefined;
    return { outcome: match[2] as "COMPLETED" | "SKIPPED" | "FAILED", date, linked,
        linkText: linked ? value : undefined, from: match[1].length, to: line.length - match[5].length,
        dateFrom: match[1].length + match[2].length + 1 + match[3].length, dateTo: line.length - match[5].length };
}

export function updateRecurringLogDates(content: string, sourceFormats: string[], targetFormat: string, linkDates: boolean): string {
    const lines = content.split(/(\r?\n)/);
    for (const { text, line } of bodyLines(content)) {
        const entry = parseRecurringLog(text, [...sourceFormats, targetFormat]);
        if (!entry) continue;
        const label = formatDate(entry.date, targetFormat);
        lines[line * 2] = text.slice(0, entry.dateFrom) + (linkDates ? `[[${label}]]` : label) + text.slice(entry.dateTo);
    }
    return lines.join("");
}
