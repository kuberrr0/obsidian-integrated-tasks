import { parseDateExpression } from "./date";
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
    deadline: date(values.get("enddate") ?? values.get("deadline")),
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
    ["end date", ["enddate", "deadline"]],
    ["priority", ["priority"]],
    ["duration", ["duration"]]
  ] as const) {
    if (!aliases.some((alias) => keys.has(alias))) frontmatter[name] = null;
  }
}
