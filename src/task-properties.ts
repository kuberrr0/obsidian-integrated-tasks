import { formatTags } from "./task-tags";
import { formatDuration, repeatLabel } from "./parser";
import { STATUS_LABELS, statusFromLabel } from "./task-status";
import { todayIso } from "./date";
import type { FilterOperator, Task, TaskFilter, TaskProperty } from "./types";

const DATE_PROPERTIES = new Set<TaskProperty>(["scheduledDate", "deadline", "defer", "completed"]);

/**
 * Date filter values may be relative — `today`, `today+7`, `today-1` — so a saved smart list such as
 * "Next 7 days" keeps meaning the next seven days. Other values are returned unchanged.
 */
export function resolveDateToken(value: string, now = new Date()): string {
  const token = /^today(?:([+-])(\d+))?$/i.exec(value.trim());
  if (!token) return value;
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (token[2] ? Number(token[2]) * (token[1] === "-" ? -1 : 1) : 0), 12);
  return todayIso(date);
}

export const TASK_PROPERTIES: { key: TaskProperty; label: string; kind: "text" | "choice" | "date" | "time" | "number" }[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "status", label: "Status", kind: "choice" },
  { key: "scheduledDate", label: "Scheduled date", kind: "date" },
  { key: "scheduledTime", label: "Scheduled time", kind: "time" },
  { key: "duration", label: "Duration", kind: "number" },
  { key: "deadline", label: "Deadline", kind: "date" },
  { key: "deadlineTime", label: "Deadline time", kind: "time" },
  { key: "defer", label: "Hidden until", kind: "date" },
  { key: "repeat", label: "Repeat", kind: "text" },
  { key: "completed", label: "Completed date", kind: "date" },
  { key: "priority", label: "Priority", kind: "choice" },
  { key: "tags", label: "Tags", kind: "text" },
  { key: "source", label: "Source note / list", kind: "choice" },
  { key: "section", label: "Heading", kind: "choice" }
];

export function propertyValue(task: Task, property: TaskProperty): string | number | undefined {
  if (property === "tags") return task.tags?.length ? formatTags([...task.tags].sort()) : undefined;
  if (property === "status") return STATUS_LABELS[task.status];
  if (property === "source") return task.path;
  if (property === "duration") return task.durationMinutes;
  if (property === "defer") return task.someday ? "Someday" : task.deferDate;
  if (property === "completed") return task.completedDate;
  return task[property];
}

/** The priority filter's value for tasks without a priority. */
export const NO_PRIORITY = "none";
/** Priority filter choices: P1–P3, then tasks without one. */
export const PRIORITY_FILTER_VALUES = ["1", "2", "3", NO_PRIORITY];

export function propertyLabel(property: TaskProperty, value: string | number): string {
  if (property === "priority" && String(value).toLowerCase() === NO_PRIORITY) return "No priority";
  return property === "priority" ? `P${value}` : property === "duration" ? formatDuration(Number(value)) : property === "repeat" ? repeatLabel(String(value)) : String(value);
}

export function filterOperators(kind: string): [FilterOperator, string][] {
  const common: [FilterOperator, string][] = [["has", "Has a value"], ["missing", "Doesn't have a value"], ["is", "Is"], ["isNot", "Is not"]];
  if (kind === "text") common.push(["contains", "Contains"]);
  if (["date", "time", "number"].includes(kind)) common.push(["before", kind === "number" ? "Less than" : "Before"], ["after", kind === "number" ? "Greater than" : "After"], ["between", "Between (inclusive)"]);
  return common;
}

/** AND has precedence within each OR-separated group. */
export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  let group = matchesCondition(task, filter);
  let matched = false;
  for (const condition of filter.conditions ?? []) {
    const next = matchesCondition(task, { property: filter.property, ...condition });
    if (condition.join === "or") { matched ||= group; group = next; }
    else group = group && next;
  }
  return matched || group;
}

function matchesCondition(task: Task, filter: TaskFilter): boolean {
  if (filter.property === "tags") {
    const tags = (task.tags ?? []).map(tag => tag.toLocaleLowerCase());
    const values = filter.values.map(value => value.replace(/^#\[\[|\]\]$/g, "").trim().toLocaleLowerCase());
    if (filter.operator === "has") return tags.length > 0;
    if (filter.operator === "missing") return tags.length === 0;
    // A task without tags has none of the tags "is not" names.
    if (!tags.length) return filter.operator === "isNot";
    if (filter.operator === "is") return tags.some(tag => values.includes(tag));
    if (filter.operator === "isNot") return tags.every(tag => !values.includes(tag));
    if (filter.operator === "contains") return tags.some(tag => tag.includes(values[0] ?? ""));
    return false;
  }
  if (filter.property === "status") {
    if (filter.operator === "has" || filter.operator === "missing") return filter.operator === "has";
    // "Open" (from older smart lists and queries) is any open status; "Completed" is done.
    const matches = filter.values.some(value => value.toLowerCase() === "open" ? !task.completed : statusFromLabel(value) === task.status);
    return filter.operator === "is" ? matches : filter.operator === "isNot" ? !matches : false;
  }
  const value = propertyValue(task, filter.property);
  const present = value !== undefined && value !== "";
  if (filter.operator === "has") return present;
  if (filter.operator === "missing") return !present;
  // A task without the property matches "is not" (it has none of those values) and nothing else, but for "No priority",
  // which is what a task without a priority has.
  if (!present) {
    const none = filter.property === "priority" && filter.values.some(item => item.toLowerCase() === NO_PRIORITY);
    return filter.operator === "is" ? none : filter.operator === "isNot" ? !none : false;
  }
  const normalized = String(value).toLocaleLowerCase();
  const values = filter.values.map(item => (DATE_PROPERTIES.has(filter.property) ? resolveDateToken(item) : item).toLocaleLowerCase());
  if (filter.operator === "is") return values.includes(normalized);
  if (filter.operator === "isNot") return !values.includes(normalized);
  if (filter.operator === "contains") return normalized.includes(values[0] ?? "");
  const numeric = filter.property === "duration";
  const actual = numeric ? Number(value) : normalized;
  const lower = numeric ? Number(values[0]) : values[0];
  const upper = numeric ? Number(values[1]) : values[1];
  if (!values[0] || (filter.operator === "between" && !values[1])) return false;
  if (filter.operator === "before") return actual < lower;
  if (filter.operator === "after") return actual > lower;
  return actual >= lower && actual <= upper;
}
