import { lineEnding } from "./markdown";
import { parseRepeatRule, parseTaskLine, rewriteTaskLine } from "./parser";
import { nonBodyLines } from "./structure";
import type { Priority, TaskDraft } from "./types";

/** Converting notes written for the Tasks plugin (emoji or Dataview-style fields) into this plugin's syntax. */
export interface TasksImportOptions {
  dateFormat: string;
  linkDates: boolean;
  /** Turn `#tag` into this plugin's `#[[tag]]` tags. */
  convertTags: boolean;
  /** Remove ➕ created dates, which have no equivalent here. */
  dropCreatedDates: boolean;
  /** The Tasks plugin's global filter, such as `#task`; removed from converted tasks. */
  globalFilter?: string;
  reference?: Date;
}

export type TasksImportSkip = "status" | "numbered" | "repeat" | "dependency" | "cancelled";

const SKIP_LABELS: Record<TasksImportSkip, [string, string, string]> = {
  status: ["task", "tasks", "with an unsupported status, such as [!] or [>], left unchanged"],
  numbered: ["numbered-list task", "numbered-list tasks", "left unchanged"],
  repeat: ["repeat rule", "repeat rules", "this plugin doesn't support, kept as text"],
  dependency: ["task", "tasks", "with IDs, dependencies, or on-completion actions, kept as text"],
  cancelled: ["cancelled date", "cancelled dates", "kept as text"]
};

/** For example "2 tasks with an unsupported status, such as [!] or [>], left unchanged." */
export function skipLabel(skip: TasksImportSkip, count: number): string {
  const [one, many, rest] = SKIP_LABELS[skip];
  return `${count} ${count === 1 ? one : many} ${rest}.`;
}

export interface TasksLineResult { line: string; changed: boolean; skips: TasksImportSkip[] }
export interface TasksNoteResult { content: string; converted: number; skips: Map<TasksImportSkip, number>; examples: Array<{ before: string; after: string }> }

const TASK = /^(\s*)([-*+]|\d+[.)])(\s+)\[(.)\](\s+)(.*)$/;
const VS = "\\uFE0F?";
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const SIGNIFIERS = "📅⏳🛫✅➕❌🔁🔺⏫🔼🔽⏬🆔⛔🏁";
const DATE_FIELDS: Array<[string, "deadline" | "scheduledDate" | "deferDate" | "completedDate" | "created" | "cancelled"]> = [
  ["📅", "deadline"], ["⏳", "scheduledDate"], ["🛫", "deferDate"], ["✅", "completedDate"], ["➕", "created"], ["❌", "cancelled"]
];
const PRIORITIES: Array<[string, Priority]> = [["🔺", 1], ["⏫", 1], ["🔼", 2], ["🔽", 3], ["⏬", 3]];
const PRIORITY_WORDS: Record<string, Priority> = { highest: 1, high: 1, medium: 2, low: 3, lowest: 3 };
const DATAVIEW_FIELDS: Record<string, "deadline" | "scheduledDate" | "deferDate" | "completedDate" | "created" | "cancelled" | "priority" | "repeat"> = {
  due: "deadline", scheduled: "scheduledDate", start: "deferDate", completion: "completedDate", created: "created", cancelled: "cancelled", priority: "priority", repeat: "repeat"
};

/** Convert one checklist line; lines without Tasks-plugin syntax come back unchanged. */
export function convertTasksLine(line: string, options: TasksImportOptions): TasksLineResult {
  const match = TASK.exec(line);
  if (!match) return { line, changed: false, skips: [] };
  const [, indent, marker, , status, , text] = match;
  let body = text;
  const skips: TasksImportSkip[] = [];
  const found: Partial<Record<"deadline" | "scheduledDate" | "deferDate" | "completedDate", string>> & { priority?: Priority; repeat?: string } = {};
  let touched = false;
  // `use` returns true to remove the matched text (converted), false to keep it, or replacement text to keep.
  const take = (pattern: RegExp, use: (...groups: string[]) => boolean | string): void => {
    body = body.replace(pattern, (whole: string, ...groups: string[]) => {
      const outcome = use(...groups);
      if (outcome === false) return whole;
      if (typeof outcome === "string") return ` ${outcome} `;
      touched = true;
      return " ";
    });
  };
  // A kept date stays joined to its emoji (the Tasks plugin accepts both), so it is never read as a scheduled date.
  const keepDate = (emoji: string, date: string): string => `${emoji}${date}`;

  take(/[[(](due|scheduled|start|completion|created|cancelled|priority|repeat)::\s*([^\])]+)[\])]/gi, (key, value) => {
    const field = DATAVIEW_FIELDS[key.toLowerCase()];
    const trimmed = value.trim();
    if (field === "priority") {
      const priority = PRIORITY_WORDS[trimmed.toLowerCase()];
      if (priority) found.priority = priority;
      return Boolean(priority);
    }
    if (field === "repeat") {
      const rule = parseRepeatRule(trimmed.replace(/\s+when done$/i, ""));
      if (rule) found.repeat = rule; else skips.push("repeat");
      return Boolean(rule);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
    if (field === "created") return options.dropCreatedDates || keepDate("➕", trimmed);
    if (field === "cancelled") { skips.push("cancelled"); return keepDate("❌", trimmed); }
    found[field] = trimmed;
    return true;
  });
  for (const [emoji, field] of DATE_FIELDS) {
    take(new RegExp(`${emoji}${VS}\\s*${DATE}`, "gu"), date => {
      if (field === "created") return options.dropCreatedDates || keepDate(emoji, date);
      if (field === "cancelled") { skips.push("cancelled"); return keepDate(emoji, date); }
      found[field] = date;
      return true;
    });
  }
  // A recurrence runs until the next signifier, a tag, a block ID, or the end of the line.
  take(new RegExp(`🔁${VS}\\s*([^${SIGNIFIERS}#^\\[(]+)`, "gu"), rule => {
    const parsed = parseRepeatRule(rule.trim().replace(/\s+when done$/i, ""));
    if (parsed) found.repeat = parsed; else skips.push("repeat");
    return Boolean(parsed);
  });
  for (const [emoji, priority] of PRIORITIES) take(new RegExp(`${emoji}${VS}`, "gu"), () => { found.priority ??= priority; return true; });
  if (/[🆔⛔🏁]/u.test(body)) skips.push("dependency");

  const filter = options.globalFilter?.trim().replace(/^#/, "").toLowerCase();
  const tags: string[] = [];
  take(/(^|\s)#(?!\[\[)([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu, (_space, tag) => {
    if (filter && tag.toLowerCase() === filter) return true;
    if (!options.convertTags) return false;
    tags.push(tag);
    return true;
  });

  const listMarker = marker === "*" || marker === "+";
  if (!touched && !listMarker) return { line, changed: false, skips };
  if (/^\d/.test(marker)) return { line, changed: false, skips: [...skips, "numbered"] };
  // To do, in progress, waiting, done and cancelled convert; other statuses have no equivalent here.
  if (!/^[ xX/?-]$/.test(status)) return { line, changed: false, skips: [...skips, "status"] };

  const cleaned = body.replace(/\s{2,}/g, " ").trim();
  const rest = `${indent}- [${status}] ${cleaned}`;
  const reference = options.reference ?? new Date();
  const parsed = parseTaskLine(rest, reference, options.dateFormat);
  if (!parsed?.title) return { line, changed: false, skips };
  const draft: TaskDraft = {
    ...parsed, destination: "",
    ...(found.scheduledDate ? { scheduledDate: found.scheduledDate } : {}),
    ...(found.deadline ? { deadline: found.deadline } : {}),
    ...(found.deferDate ? { deferDate: found.deferDate, someday: undefined } : {}),
    ...(found.completedDate ? { completedDate: found.completedDate } : {}),
    ...(found.priority ? { priority: found.priority } : {}),
    ...(found.repeat ? { repeat: found.repeat } : {}),
    tags: [...new Set([...(parsed.tags ?? []), ...tags])]
  };
  const converted = rewriteTaskLine(rest, draft, options.dateFormat, options.linkDates, reference);
  return { line: converted, changed: converted !== line, skips };
}

/** Convert every checklist line outside frontmatter and code blocks (including ```tasks query blocks). */
export function convertTasksNote(content: string, options: TasksImportOptions, maxExamples = 0): TasksNoteResult {
  const lines = content.split(/\r?\n/);
  const skipped = nonBodyLines(lines);
  const result: TasksNoteResult = { content, converted: 0, skips: new Map(), examples: [] };
  lines.forEach((line, index) => {
    if (skipped.has(index)) return;
    const converted = convertTasksLine(line, options);
    for (const skip of converted.skips) result.skips.set(skip, (result.skips.get(skip) ?? 0) + 1);
    if (!converted.changed) return;
    lines[index] = converted.line;
    result.converted++;
    if (result.examples.length < maxExamples) result.examples.push({ before: line, after: converted.line });
  });
  if (result.converted) result.content = lines.join(lineEnding(content));
  return result;
}
