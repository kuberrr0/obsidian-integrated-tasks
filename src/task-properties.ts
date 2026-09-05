import { formatDuration } from "./parser";
import type { FilterOperator, Task, TaskFilter, TaskProperty } from "./types";

export const TASK_PROPERTIES: { key: TaskProperty; label: string; kind: "text" | "choice" | "date" | "time" | "number" }[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "status", label: "Status", kind: "choice" },
  { key: "priority", label: "Priority", kind: "choice" },
  { key: "scheduledDate", label: "Scheduled date", kind: "date" },
  { key: "scheduledTime", label: "Scheduled time", kind: "time" },
  { key: "deadline", label: "Deadline", kind: "date" },
  { key: "deadlineTime", label: "Deadline time", kind: "time" },
  { key: "duration", label: "Duration", kind: "number" },
  { key: "source", label: "Source note / list", kind: "choice" },
  { key: "section", label: "Section", kind: "choice" }
];

export function propertyValue(task: Task, property: TaskProperty): string | number | undefined {
  if (property === "status") return task.completed ? "Completed" : "Open";
  if (property === "source") return task.path;
  if (property === "duration") return task.durationMinutes;
  return task[property];
}

export function propertyLabel(property: TaskProperty, value: string | number): string {
  return property === "priority" ? `P${value}` : property === "duration" ? formatDuration(Number(value)) : String(value);
}

export function filterOperators(kind: string): [FilterOperator, string][] {
  const common: [FilterOperator, string][] = [["has", "Has a value"], ["missing", "Doesn't have a value"], ["is", "Is"], ["isNot", "Is not"]];
  if (kind === "text") common.push(["contains", "Contains"]);
  if (["date", "time", "number"].includes(kind)) common.push(["before", kind === "number" ? "Less than" : "Before"], ["after", kind === "number" ? "Greater than" : "After"], ["between", "Between (inclusive)"]);
  return common;
}

export function matchesFilter(task: Task, filter: TaskFilter): boolean {
  const value = propertyValue(task, filter.property);
  const present = value !== undefined && value !== "";
  if (filter.operator === "has") return present;
  if (filter.operator === "missing") return !present;
  if (!present) return false;
  const normalized = String(value).toLocaleLowerCase();
  const values = filter.values.map(item => item.toLocaleLowerCase());
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
