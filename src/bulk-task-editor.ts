import { Modal, Notice, type App } from "obsidian";
import { formatDateTime, parseDateTimeExpression } from "./date";
import { durationToMinutes, formatDuration } from "./parser";
import { destinationString } from "./structure";
import { trackModalViewport } from "./mobile-layout";
import type { BulkTaskPatch } from "./bulk-tasks";
import type { Project, Task } from "./types";

type Field = "scheduled" | "deadline" | "duration" | "priority" | "destination";
interface BulkEditorOptions {
  tasks: Task[];
  projects: Project[];
  dateFormat: string;
  inboxPath: string;
  onSave: (patch: BulkTaskPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function bulkPropertyValues(task: Task, dateFormat: string): Record<Field, string> {
  return {
    scheduled: task.scheduledDate ? formatDateTime(task.scheduledDate, task.scheduledTime, dateFormat) : "",
    deadline: task.deadline ? formatDateTime(task.deadline, task.deadlineTime, dateFormat) : "",
    duration: task.durationMinutes ? formatDuration(task.durationMinutes) : "",
    priority: task.priority ? String(task.priority) : "",
    destination: destinationString(task.path, task.section)
  };
}

/** Presence in this patch means apply, including an explicit undefined to clear a field. */
export function bulkPropertyPatch(values: Partial<Record<Field, string>>, dateFormat: string, reference = new Date()): BulkTaskPatch {
  const patch: BulkTaskPatch = {};
  for (const field of ["scheduled", "deadline"] as const) {
    if (!(field in values)) continue;
    const value = values[field]!.trim();
    const parsed = value ? parseDateTimeExpression(value, reference, dateFormat) : undefined;
    if (value && !parsed) throw new Error(`Could not understand the ${field === "scheduled" ? "scheduled date and time" : "deadline date and time"}.`);
    if (field === "scheduled") { patch.scheduledDate = parsed?.date; patch.scheduledTime = parsed?.time; }
    else { patch.deadline = parsed?.date; patch.deadlineTime = parsed?.time; }
  }
  if ("duration" in values) {
    const value = values.duration!.trim();
    const duration = durationToMinutes(value.replace(/\s+/g, ""));
    if (value && !duration) throw new Error("Use a duration such as 45m, 2h, or 1h30m.");
    patch.durationMinutes = duration;
  }
  if ("priority" in values) {
    if (values.priority && !/^[123]$/.test(values.priority)) throw new Error("Select a valid priority.");
    patch.priority = values.priority ? Number(values.priority) as 1 | 2 | 3 : undefined;
  }
  if ("destination" in values) {
    if (!values.destination?.trim()) throw new Error("Select a destination note.");
    patch.destination = values.destination;
  }
  return patch;
}

export class BulkTaskEditorModal extends Modal {
  private inputs = new Map<Field, HTMLInputElement | HTMLSelectElement>();
  private initial = new Map<Field, string | undefined>();
  private changed = new Set<Field>();
  private actions?: HTMLElement;
  private stopViewportTracking?: () => void;
  constructor(app: App, private readonly options: BulkEditorOptions) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal");
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "Edit task properties" });
    content.createEl("p", { cls: "tm-bulk-help", text: `${this.options.tasks.length} selected. Only changed fields are applied. Delete task also deletes their subtasks.` });
    const snapshots = this.options.tasks.map(task => bulkPropertyValues(task, this.options.dateFormat));
    for (const [key, label] of [["scheduled", "Date and time"], ["deadline", "Deadline date and time"], ["duration", "Duration"], ["priority", "Priority"], ["destination", "Destination"]] as const) {
      const common = snapshots.every(value => value[key] === snapshots[0][key]) ? snapshots[0][key] : undefined;
      this.initial.set(key, common);
      const row = content.createDiv({ cls: "tm-editor-field tm-bulk-field" });
      const caption = row.createEl("label", { text: label });
      const input = key === "priority" || key === "destination" ? row.createEl("select") : row.createEl("input", { type: "text" });
      input.setAttribute("aria-label", label);
      caption.addEventListener("click", () => input.focus());
      if (input.tagName === "SELECT") {
        const select = input as HTMLSelectElement;
        if (common === undefined) select.createEl("option", { value: "__mixed__", text: "Mixed — unchanged" });
        if (key === "priority") {
          for (const [value, text] of [["", "No priority"], ["1", "P1 — High"], ["2", "P2 — Medium"], ["3", "P3 — Low"]]) select.createEl("option", { value, text });
        } else {
          const destinations = new Set([this.options.inboxPath, ...snapshots.map(value => value.destination)]);
          for (const project of this.options.projects) {
            destinations.add(project.path);
            for (const heading of project.headings ?? []) destinations.add(destinationString(project.path, heading.name));
          }
          for (const destination of [...destinations].sort()) select.createEl("option", { value: destination, text: destination });
        }
        input.value = common ?? "__mixed__";
      } else {
        (input as HTMLInputElement).placeholder = common === undefined ? "Mixed — unchanged" : key === "duration" ? "45m or 1h30m" : "Tomorrow at 9am";
        input.value = common ?? "";
      }
      this.inputs.set(key, input);
      const update = (): void => {
        if (input.value === "__mixed__" || input.value === this.initial.get(key)) this.changed.delete(key);
        else this.changed.add(key);
      };
      input.addEventListener("input", update);
      input.addEventListener("change", update);
      if (key !== "destination") {
        const clear = row.createEl("button", { text: "Clear", attr: { "aria-label": `Clear ${label.toLowerCase()}` } });
        clear.addEventListener("click", () => { input.value = ""; this.changed.add(key); });
      }
    }
    const error = content.createDiv({ cls: "tm-editor-error", attr: { role: "alert" } });
    this.actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    const remove = this.actions.createEl("button", { text: "Delete task", cls: "tm-delete-task" });
    const cancel = this.actions.createEl("button", { text: "Cancel" });
    const save = this.actions.createEl("button", { text: "Save task", cls: "mod-cta", attr: { title: "Cmd/Ctrl+Enter" } });
    const run = async (deleting: boolean): Promise<void> => {
      if (save.disabled) return;
      try {
        const values = Object.fromEntries([...this.changed].map(key => [key, this.inputs.get(key)!.value]));
        const patch = deleting ? {} : bulkPropertyPatch(values, this.options.dateFormat);
        save.disabled = remove.disabled = cancel.disabled = true;
        if (deleting) await this.options.onDelete();
        else await this.options.onSave(patch);
        this.close();
      } catch (cause) {
        save.disabled = remove.disabled = cancel.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not update selected tasks.";
        error.setText(message);
        new Notice(message);
      }
    };
    remove.addEventListener("click", () => { void run(true); });
    save.addEventListener("click", () => { void run(false); });
    cancel.addEventListener("click", () => this.close());
    content.onkeydown = event => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void run(false);
    };
    this.stopViewportTracking = trackModalViewport(this.modalEl, content);
  }

  onClose(): void {
    this.stopViewportTracking?.();
    this.actions?.remove();
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }
}
