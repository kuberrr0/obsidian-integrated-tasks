import type { TaskStatus } from "./types";

/** In table order: open statuses first, then the closed ones. */
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "waiting", "done", "cancelled"];
export const OPEN_STATUSES: readonly TaskStatus[] = ["todo", "doing", "waiting"];

export const STATUS_CHARS: Record<TaskStatus, string> = { todo: " ", doing: "/", waiting: "?", done: "x", cancelled: "-" };
export const STATUS_LABELS: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", waiting: "Waiting", done: "Done", cancelled: "Cancelled" };
export const STATUS_ICONS: Record<TaskStatus, string> = { todo: "circle", doing: "circle-dot", waiting: "clock", done: "circle-check", cancelled: "circle-slash" };

export function statusFromChar(char: string): TaskStatus | undefined {
  return char === "X" ? "done" : TASK_STATUSES.find(status => STATUS_CHARS[status] === char);
}

export function isClosedStatus(status: TaskStatus): boolean {
  return status === "done" || status === "cancelled";
}

/** A draft's status; one that disagrees with `completed` (a task spread and then checked or unchecked) follows `completed`. */
export function draftStatus(draft: { status?: TaskStatus; completed: boolean }): TaskStatus {
  if (draft.status && isClosedStatus(draft.status) === draft.completed) return draft.status;
  return draft.completed ? "done" : "todo";
}

/** The status a label or query word names, such as "In progress", "doing" or "completed". */
export function statusFromLabel(value: string): TaskStatus | undefined {
  const text = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^(to ?do|not started)$/.test(text)) return "todo";
  if (/^(in progress|doing|started)$/.test(text)) return "doing";
  if (/^(waiting|blocked|on hold)$/.test(text)) return "waiting";
  if (/^(done|completed?)$/.test(text)) return "done";
  if (/^cancell?ed$/.test(text)) return "cancelled";
  return undefined;
}

/** ` is-doing`, ` is-waiting` or ` is-cancelled` for a checkbox; to do and done look like any checkbox. */
export function statusClass(status: TaskStatus): string {
  return status === "todo" || status === "done" ? "" : ` is-${status}`;
}

/** A checkbox's accessible name, such as "Complete Call Sam (in progress, priority 1)". */
export function checkboxLabel(task: { title: string; status: TaskStatus; priority?: number }): string {
  const notes = [statusClass(task.status) && STATUS_LABELS[task.status].toLowerCase(), task.priority && `priority ${task.priority}`].filter(Boolean);
  return `Complete ${task.title}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}
