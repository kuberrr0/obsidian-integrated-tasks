import { parseYaml, type App, TFile } from "obsidian";
import { formatDate, formatLocalDate } from "./date";
import { findLiveLine } from "./markdown";
import { parseTaskLine, type ParsedTokenRange } from "./parser";
import type { Task } from "./types";

export type RecurringOutcome = "COMPLETED" | "SKIPPED" | "FAILED";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function recurringFile(app: App, task: Task): TFile | undefined {
    const files = new Map<string, TFile>();
    const prose = task.title.replace(/`[^`]*`/g, "");
    const links = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = links.exec(prose))) {
        const file = app.metadataCache?.getFirstLinkpathDest(match[1], task.path);
        if (!file) continue;
        const cache = app.metadataCache.getFileCache(file);
        const tags = cache?.frontmatter?.tags;
        const all = [...(Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[\s,]+/) : []), ...(cache?.tags ?? []).map(tag => tag.tag)];
        if (all.some(tag => String(tag).replace(/^#/, "") === "recurring-task")) files.set(file.path, file);
    }
    if (files.size > 1) throw new Error("A task must link to only one recurring-task note.");
    return [...files.values()][0];
}

export function repeatRules(content: string): string[] {
    const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
    const repeat: unknown = match ? parseYaml(match[1])?.repeat : undefined;
    const rules = Array.isArray(repeat) ? repeat : [repeat];
    if (!rules.length || rules.some(rule => typeof rule !== "string" || !rule.trim())) throw new Error("Recurring task needs a repeat property containing text or a list of rules.");
    return rules as string[];
}

/** Resolve strictly after the scheduled instance, choosing the earliest rule result. */
export function nextRepeatDate(rules: string[], scheduled: string): string {
    const [year, month, day] = scheduled.split("-").map(Number);
    const base = new Date(year, month - 1, day, 12);
    if (formatLocalDate(base) !== scheduled) throw new Error("Recurring task needs a valid scheduled date.");
    if (!rules.length) throw new Error("Recurring task needs at least one repeat rule.");
    const dates = rules.map(raw => {
        const rule = raw.trim().toLowerCase().replace(/\s+/g, " ");
        const match = /^(?:every )?(?:(other|second|third|fourth|\d+(?:st|nd|rd|th)?) )?(day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/.exec(rule);
        if (!match) throw new Error(`Unsupported repeat rule: ${raw}`);
        const count = match[1] ? ({ other: 2, second: 2, third: 3, fourth: 4 }[match[1]] ?? parseInt(match[1], 10)) : 1;
        if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error(`Invalid repeat interval: ${raw}`);
        const next = new Date(base);
        const weekday = weekdays.indexOf(match[2]);
        if (weekday >= 0) next.setDate(next.getDate() + ((weekday - next.getDay() + 7) % 7 || 7) + (count - 1) * 7);
        else if (match[2] === "day" || match[2] === "week") next.setDate(next.getDate() + count * (match[2] === "week" ? 7 : 1));
        else {
            next.setDate(1);
            next.setMonth(next.getMonth() + count * (match[2] === "year" ? 12 : 1));
            const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
            next.setDate(Math.min(day, last));
        }
        return formatLocalDate(next);
    });
    return dates.sort()[0];
}

export function advanceRecurringTask(content: string, task: Task, next: string, dateFormat: string): string {
    const lines = content.split(/(\r?\n)/);
    const line = findLiveLine(content.split(/\r?\n/), task);
    const raw = lines[line * 2];
    const ranges: ParsedTokenRange[] = [];
    const parsed = parseTaskLine(raw, new Date(), dateFormat, false, ranges);
    const range = ranges.find(range => range.kind === "scheduledDate");
    if (!parsed || parsed.completed || !range) throw new Error("Select an open recurring task with a scheduled date.");
    const token = raw.slice(range.from, range.to);
    const linked = token.startsWith("[[");
    const originalDate = linked ? /^\[\[([^\]]+)\]\]/.exec(token)![1] : token.slice(0, parsed.scheduledTime ? token.search(/\s+\d{1,2}:\d{2}\s*$/) : token.length);
    const label = formatDate(next, /^\d{4}-\d{2}-\d{2}$/.test(originalDate) ? "YYYY-MM-DD" : dateFormat);
    const dateLength = linked ? originalDate.length + 4 : originalDate.length;
    const replacement = (linked ? `[[${label}]]` : label) + token.slice(dateLength);
    lines[line * 2] = raw.slice(0, range.from) + replacement + raw.slice(range.to);
    return lines.join("");
}

export function appendRecurringLog(content: string, outcome: RecurringOutcome, date: string): string {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    return content + (content.endsWith("\n") ? "" : eol) + `${outcome}: ${date}${eol}`;
}
