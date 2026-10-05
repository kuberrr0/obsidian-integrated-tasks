import { checkboxLabel, statusClass } from "./task-status";
import { taskTitleLabel } from "./task-title";
import { repeatIcon } from "./things-task-card";
import type { Task } from "./types";

/** A task row's parts, for its list to fill in (its properties) and bind (its clicks, drags and keys). */
export interface TaskRowParts {
  row: HTMLElement;
  checkbox: HTMLInputElement;
  primary: HTMLElement;
  title: HTMLButtonElement;
  /** The Things style's lead (the Today star, a subtask mark…), before the title. */
  lead?: HTMLElement;
  /** The properties' line: the Things style's secondary line, or the metadata line. */
  metadata: HTMLElement;
}

export interface TaskRowOptions {
  /** The row's own class: tm-task-item for a list's rows, tm-query-row for a task-query block's. */
  cls: string;
  depth: number;
  /** In the Things style, a recurring task's checkbox is its repeat icon (the checkbox stays, unseen, beneath it). */
  repeatCheckbox?: boolean;
  /** The checkbox's label, when not the task's own (with its priority). */
  checkboxLabel?: string;
  /** The project's colour, and whether the row is marked with it (a board card's edge) or only passes it on. */
  color?: string;
  markColor?: boolean;
  /** The Things style's secondary line for the properties, rather than the metadata line. */
  things?: boolean;
  /** The Things style's lead before the title (not on a board's card). */
  lead?: boolean;
  attr?: Record<string, string>;
  focusKeys?: { checkbox?: string; title?: string };
}

/** A task's row as every list draws it: its checkbox, then its title and the line for its properties. */
export function createTaskRow(list: HTMLElement, task: Task, options: TaskRowOptions): TaskRowParts {
  const row = list.createDiv({ cls: `tm-task-row ${options.cls}${task.completed ? " is-completed" : ""}${task.status === "cancelled" ? " is-cancelled" : ""}`, attr: { role: "listitem", ...options.attr } });
  row.style.setProperty("--tm-depth", String(options.depth));
  const repeat = options.repeatCheckbox;
  const target = row.createEl("label", { cls: `tm-checkbox-target${repeat ? ` tm-repeat-target${task.priority ? ` is-p${task.priority}` : ""}` : ""}` });
  const checkbox = target.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: {
    "aria-label": options.checkboxLabel ?? checkboxLabel(task), ...(options.focusKeys?.checkbox ? { "data-tm-focus-key": options.focusKeys.checkbox } : {})
  } });
  if (repeat) repeatIcon(target);
  // A cancelled task shows checked, so clicking it reopens it (to do).
  checkbox.checked = task.completed;
  const content = row.createDiv({ cls: "tm-task-content" });
  const primary = content.createDiv({ cls: "tm-task-primary" });
  if (options.color) {
    if (options.markColor) row.addClass("has-project-color");
    row.style.setProperty("--tm-project-color", options.color);
  }
  const lead = options.lead ? primary.createSpan({ cls: "tm-things-lead" }) : undefined;
  const label = taskTitleLabel(task.title);
  const title = primary.createEl("button", { cls: "tm-task-title", text: label, attr: { title: label, ...(options.focusKeys?.title ? { "data-tm-focus-key": options.focusKeys.title } : {}) } });
  const metadata = content.createDiv({ cls: options.things ? "tm-things-secondary" : "tm-task-metadata" });
  return { row, checkbox, primary, title, lead, metadata };
}

/** Once the properties are drawn, a lead or properties' line left empty goes. */
export function dropEmptyRowParts(parts: Pick<TaskRowParts, "lead" | "metadata">): void {
  if (parts.lead && !parts.lead.childElementCount) parts.lead.remove();
  if (!parts.metadata.childElementCount) parts.metadata.remove();
}
