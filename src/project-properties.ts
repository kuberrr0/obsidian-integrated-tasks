import type { ProjectDateField } from "./gantt";
import { formatDate, parseDateExpression } from "./date";
import { durationToMinutes } from "./parser";
import type { Priority, ProjectProperties } from "./types";

/** Normalize note properties to the same display values used by tasks. */
export function parseProjectProperties(frontmatter: Record<string, unknown> | undefined, dateFormat?: string): ProjectProperties {
  const values = new Map(Object.entries(frontmatter ?? {}).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ""), value]));
  const scalar = (value: unknown): string | undefined => {
    if (Array.isArray(value) && value.length === 1) value = value[0];
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;
  };
  const date = (value: unknown): string | undefined => {
    const text = scalar(value);
    if (!text) return undefined;
    const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
    return parseDateExpression(link?.[1] ?? text, new Date(), dateFormat);
  };
  const rawPriority = scalar(values.get("priority"))?.toLowerCase();
  const priorities: Record<string, Priority> = { "1": 1, p1: 1, high: 1, "2": 2, p2: 2, medium: 2, "3": 3, p3: 3, low: 3 };
  const rawDuration = scalar(values.get("duration"));
  const minutes = rawDuration && /^\d+$/.test(rawDuration) ? Number(rawDuration) : undefined;
  const durationMinutes = minutes !== undefined
    ? (Number.isSafeInteger(minutes) && minutes > 0 ? minutes : undefined)
    : durationToMinutes(rawDuration?.replace(/\s+/g, "") ?? "");
  return {
    scheduledDate: date(values.get("date") ?? values.get("startdate") ?? values.get("scheduleddate")),
    endDate: date(values.get("enddate")),
    deadline: date(values.get("deadline")),
    priority: rawPriority && Object.prototype.hasOwnProperty.call(priorities, rawPriority) ? priorities[rawPriority] : undefined,
    durationMinutes
  };
}

/** Add editable project fields without replacing existing values or aliases. */
export function addProjectProperties(frontmatter: Record<string, unknown>): void {
  const rawTags = frontmatter.tags;
  const tags: unknown[] = Array.isArray(rawTags) ? [...(rawTags as unknown[])] : typeof rawTags === "string" ? rawTags.split(/[,\s]+/).filter(Boolean) : [];
  if (!tags.some((tag) => typeof tag === "string" && /^#?project(?:\/|$)/.test(tag))) tags.push("project");
  frontmatter.tags = tags;
  const keys = new Set(Object.keys(frontmatter).map((key) => key.toLowerCase().replace(/[\s_-]/g, "")));
  for (const [name, aliases] of [
    ["date", ["date", "startdate", "scheduleddate"]],
    ["end date", ["enddate"]],
    ["deadline", ["deadline"]],
    ["priority", ["priority"]],
    ["duration", ["duration"]]
  ] as const) {
    if (!aliases.some((alias) => keys.has(alias))) frontmatter[name] = null;
  }
}

/** Obsidian text or single-link list property, optionally using a wikilink alias. */
export function parseProjectParent(frontmatter?: Record<string, unknown>): string | undefined {
  let value = Object.entries(frontmatter ?? {}).find(([key]) => key.trim().toLowerCase() === "parent")?.[1];
  if (Array.isArray(value)) value = value.length === 1 ? value[0] : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const link = /^\[\[([^\]]+)\]\]$/.exec(text);
  const path = (link?.[1] ?? text).split(/[|#]/, 1)[0].trim();
  return path && !/[\r\n\[\]]/.test(path) ? path : undefined;
}


/** Preserve property names and date-link formatting when saving a Gantt handle. */
export function updateProjectDate(frontmatter: Record<string, unknown>, field: ProjectDateField, value: string, expected: ProjectProperties, dateFormat?: string): void {
  if (!parseDateExpression(value)) throw new Error("Invalid project date.");
  const current = parseProjectProperties(frontmatter, dateFormat);
  for (const key of ["scheduledDate", "endDate", "deadline"] as const) {
    if (current[key] !== expected[key]) throw new Error("Project dates changed while dragging. Refresh and try again.");
  }
  const aliases = field === "scheduledDate" ? ["date", "startdate", "scheduleddate"] : field === "endDate" ? ["enddate"] : ["deadline"];
  const keys = Object.keys(frontmatter);
  const matches = aliases.map(alias => keys.find(key => key.toLowerCase().replace(/[\s_-]/g, "") === alias)).filter((key): key is string => Boolean(key));
  const key = matches.find(key => frontmatter[key] !== null && frontmatter[key] !== undefined) ?? matches[0] ?? (field === "scheduledDate" ? "date" : field === "endDate" ? "end date" : "deadline");
  const original = frontmatter[key];
  const raw = Array.isArray(original) ? original[0] : original;
  const link = typeof raw === "string" ? /^\[\[[^\]|]+(\|[^\]]*)?\]\]$/.exec(raw.trim()) : undefined;
  const formatted = link ? `[[${formatDate(value, dateFormat)}${link[1] ?? ""}]]` : value;
  frontmatter[key] = Array.isArray(original) && original.length === 1 ? [formatted] : formatted;
}


/** Apply a selected date range in one frontmatter transaction. */
export function updateProjectDates(frontmatter: Record<string, unknown>, changes: Partial<Record<ProjectDateField, string>>, expected: ProjectProperties, dateFormat?: string): void {
  const next = { ...frontmatter };
  let snapshot = expected;
  for (const field of ["scheduledDate", "endDate", "deadline"] as const) {
    const value = changes[field];
    if (value === undefined) continue;
    updateProjectDate(next, field, value, snapshot, dateFormat);
    snapshot = parseProjectProperties(next, dateFormat);
  }
  Object.assign(frontmatter, next);
}
