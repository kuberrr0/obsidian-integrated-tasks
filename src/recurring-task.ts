import { parseYaml, type App, TFile } from "obsidian";
import { formatDate, formatLocalDate, todayIso } from "./date";
import { findLiveLine } from "./markdown";
import { parseTaskLine, repeatRuleList, type ParsedTokenRange } from "./parser";
import type { Task } from "./types";

export type RecurringOutcome = "COMPLETED" | "SKIPPED" | "FAILED";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const isIsoDate = (value: string | undefined): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

export function recurringFile(app: App, task: Task): TFile | undefined {
    const files = new Map<string, TFile>();
    const prose = task.title.replace(/`[^`]*`/g, "");
    // No lookbehind: it fails to parse on iOS Safari before 16.4. Embeds (![[x]]) are excluded.
    const links = /(^|[^!])\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = links.exec(prose))) {
        // Step back onto the closing bracket so an adjacent link keeps its non-"!" prefix.
        links.lastIndex = match.index + match[0].length - 1;
        const file = app.metadataCache?.getFirstLinkpathDest(match[2], task.path);
        if (!file) continue;
        const cache = app.metadataCache.getFileCache(file);
        const tags: unknown = cache?.frontmatter?.tags;
        const frontmatterTags: unknown[] = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[\s,]+/) : [];
        const all: unknown[] = [...frontmatterTags, ...(cache?.tags ?? []).map(tag => tag.tag)];
        if (all.some(tag => String(tag).replace(/^#/, "") === "recurring-task")) files.set(file.path, file);
    }
    if (files.size > 1) throw new Error("A task must link to only one recurring-task note.");
    return [...files.values()][0];
}

/** A routine-note task or one with an inline `every …` rule. Never throws: an ambiguous routine link counts only with an inline rule. */
export function isRepeatingTask(app: App, task: Task): boolean {
    if (task.repeat) return true;
    try { return Boolean(recurringFile(app, task)); } catch { return false; }
}

const addDays = (date: string, days: number): string => {
    const [year, month, day] = date.split("-").map(Number);
    return formatLocalDate(new Date(year, month - 1, day + days, 12));
};
const dayDistance = (from: string, to: string): number => {
    const utc = (date: string): number => { const [year, month, day] = date.split("-").map(Number); return Date.UTC(year, month - 1, day); };
    return Math.round((utc(to) - utc(from)) / 86400000);
};

/**
 * The next instance of an inline repeat: the scheduled date (or today, when unscheduled) moves to the
 * next occurrence and a deadline moves by the same number of days; times are kept. A task with only
 * a deadline repeats from its deadline, so completing it never adds a scheduled date.
 */
export function advanceInlineRepeat(task: Pick<Task, "repeat" | "scheduledDate" | "deadline">, today = todayIso()): Pick<Task, "scheduledDate" | "deadline"> {
    if (!task.repeat) throw new Error("Task has no repeat rule.");
    const rules = repeatRuleList(task.repeat);
    if (!task.scheduledDate && task.deadline) return { scheduledDate: undefined, deadline: nextRepeatDate(rules, task.deadline) };
    const from = task.scheduledDate ?? today;
    const next = nextRepeatDate(rules, from);
    return { scheduledDate: next, deadline: task.deadline ? addDays(task.deadline, dayDistance(from, next)) : undefined };
}

function frontmatter(content: string): unknown {
    const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
    return match ? parseYaml(match[1]) : undefined;
}

export function repeatRules(content: string): string[] {
    const parsed = frontmatter(content);
    const repeat: unknown = parsed && typeof parsed === "object" && "repeat" in parsed ? parsed.repeat : undefined;
    const rules: unknown[] = Array.isArray(repeat) ? repeat : [repeat];
    if (!rules.length || rules.some(rule => typeof rule !== "string" || !rule.trim())) throw new Error("Recurring task needs a repeat property containing text or a list of rules.");
    return rules as string[];
}

export const REPEAT_ANCHOR = "repeat-anchor";

/** The stored `repeat-anchor` ISO date, if the note has a valid one. */
export function storedRepeatAnchor(content: string): string | undefined {
    const parsed = frontmatter(content);
    const value: unknown = parsed && typeof parsed === "object" && REPEAT_ANCHOR in parsed ? (parsed as Record<string, unknown>)[REPEAT_ANCHOR] : undefined;
    const iso = value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "string" ? value.trim() : "";
    return isIsoDate(iso) ? iso : undefined;
}

function parseRule(raw: string): { count: number; unit: string } {
    const rule = raw.trim().toLowerCase().replace(/\s+/g, " ");
    const match = /^(?:every )?(?:(other|second|third|fourth|\d+(?:st|nd|rd|th)?) )?(day|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?$/.exec(rule);
    if (!match) throw new Error(`Unsupported repeat rule: ${raw}`);
    const count = match[1] ? ({ other: 2, second: 2, third: 3, fourth: 4 }[match[1]] ?? parseInt(match[1], 10)) : 1;
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error(`Invalid repeat interval: ${raw}`);
    return { count, unit: match[2] };
}

const monthLength = (year: number, month: number): number => new Date(year, month, 0).getDate();

/** An anchor holds only while the scheduled date is what it yields for that month (and, yearly, that month is the anchor's). */
function anchorFits(anchor: string, scheduled: string, yearly: boolean): boolean {
    const [, anchorMonth, anchorDay] = anchor.split("-").map(Number);
    const [year, month, day] = scheduled.split("-").map(Number);
    return (!yearly || anchorMonth === month) && day === Math.min(anchorDay, monthLength(year, month));
}

/** The anchor to use (and persist) for month/year rules: the stored one while it still fits, else the scheduled date. */
export function repeatAnchor(rules: string[], scheduled: string, stored?: string): string | undefined {
    const units = new Set(rules.map(rule => parseRule(rule).unit));
    if (!units.has("month") && !units.has("year")) return undefined;
    return isIsoDate(stored) && anchorFits(stored, scheduled, units.has("year")) ? stored : scheduled;
}

/**
 * Resolve strictly after the scheduled instance, choosing the earliest rule result.
 * Month/year steps take their day (and yearly month) from a fitting anchor, clamped to the target month.
 */
export function nextRepeatDate(rules: string[], scheduled: string, anchor?: string): string {
    const [year, month, day] = scheduled.split("-").map(Number);
    const base = new Date(year, month - 1, day, 12);
    if (formatLocalDate(base) !== scheduled) throw new Error("Recurring task needs a valid scheduled date.");
    if (!rules.length) throw new Error("Recurring task needs at least one repeat rule.");
    const dates = rules.map(raw => {
        const { count, unit } = parseRule(raw);
        const next = new Date(base);
        const weekday = weekdays.indexOf(unit);
        if (weekday >= 0) next.setDate(next.getDate() + ((weekday - next.getDay() + 7) % 7 || 7) + (count - 1) * 7);
        else if (unit === "day" || unit === "week") next.setDate(next.getDate() + count * (unit === "week" ? 7 : 1));
        else {
            const anchorDay = isIsoDate(anchor) && anchorFits(anchor, scheduled, unit === "year") ? Number(anchor.slice(8, 10)) : day;
            next.setDate(1);
            next.setMonth(next.getMonth() + count * (unit === "year" ? 12 : 1));
            next.setDate(Math.min(anchorDay, monthLength(next.getFullYear(), next.getMonth() + 1)));
        }
        return formatLocalDate(next);
    });
    return dates.sort()[0];
}

export function advanceRecurringTask(content: string, task: Task, next: string, dateFormat: string, sectionHeadingLevel = 1): string {
    const lines = content.split(/(\r?\n)/);
    const line = findLiveLine(content.split(/\r?\n/), task, sectionHeadingLevel);
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
    // The next instance starts afresh, so an in-progress or waiting status resets to `[ ]`.
    lines[line * 2] = (raw.slice(0, range.from) + replacement + raw.slice(range.to)).replace(/^(\s*-\s+\[)[/?](\])/, "$1 $2");
    return lines.join("");
}

export function appendRecurringLog(content: string, outcome: RecurringOutcome, date: string, dateFormat = "YYYY-MM-DD", linkDates = false): string {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const label = formatDate(date, dateFormat);
    return content + (content.endsWith("\n") ? "" : eol) + `${outcome}: ${linkDates ? `[[${label}]]` : label}${eol}`;
}
