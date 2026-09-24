import { TaskLineEditor, inlineTaskTokens } from "./task-line-editor";
import type { TaskEditorProperty } from "./task-editor";
import { formatTags, parseTags } from "./task-tags";
import { Modal, Notice, setIcon, type App } from "obsidian";
import { formatDateTime, parseDateTimeExpression } from "./date";
import { durationToMinutes, formatDuration, parseTaskInput, serializeTask, serializeTaskInput } from "./parser";
import { destinationString } from "./structure";
import { trackModalViewport } from "./mobile-layout";
import type { BulkTaskPatch } from "./bulk-tasks";
import type { Project, Task } from "./types";

type Field = "tags" | "scheduled" | "deadline" | "duration" | "priority" | "destination" | "description";
interface BulkEditorOptions {
  focusProperty?: TaskEditorProperty;
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
    tags: formatTags(task.tags),
    priority: task.priority ? String(task.priority) : "",
    description: task.description ?? "",
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
  if ("tags" in values) patch.tags = parseTags(values.tags ?? "");
  if ("description" in values) patch.description = values.description ?? "";
  return patch;
}

const labels: Record<Field, string> = { scheduled: "Scheduled date", deadline: "Deadline", duration: "Duration", priority: "Priority", tags: "Tags", destination: "Project", description: "Description" };
const propertyKeys = ["scheduledDate", "scheduledTime", "deadline", "deadlineTime", "durationMinutes", "priority", "tags", "destination"] as const;

export function commonBulkValues(tasks: Task[], dateFormat: string): Partial<Record<Field, string>> {
  const snapshots = tasks.map(task => bulkPropertyValues(task, dateFormat));
  const values: Partial<Record<Field, string>> = {};
  if (!snapshots.length) return values;
  for (const key of Object.keys(labels) as Field[]) {
    if (snapshots.every(value => value[key] === snapshots[0][key])) values[key] = snapshots[0][key];
  }
  return values;
}

export function bulkInlineText(values: Partial<Record<Field, string>>, dateFormat: string): string {
  const properties = bulkPropertyPatch(values, dateFormat);
  const draft = { ...properties, title: "", completed: false, indent: 0, destination: properties.destination ?? "" };
  return (draft.destination ? serializeTaskInput(draft, dateFormat) : serializeTask(draft, dateFormat)).replace(/^- \[ \]\s*/, "");
}

/** Compare parsed properties, so rendering/reordering never applies mixed values. */
export function bulkInlinePatch(text: string, initial: string, dateFormat: string, inboxPath: string): BulkTaskPatch {
  const parse = (value: string) => {
    if (/[\r\n]/.test(value)) throw new Error("Enter task properties on one line.");
    const parsed = parseTaskInput(`Properties ${value}`, new Date(), dateFormat);
    if (!parsed || parsed.title !== "Properties") throw new Error("Use task property syntax for dates, duration, priority, tags, and project.");
    return parsed;
  };
  const before = parse(initial);
  const after = parse(text);
  const patch: BulkTaskPatch = {};
  for (const key of propertyKeys) {
    const previous = key === "tags" ? before.tags ?? [] : before[key];
    const next = key === "tags" ? after.tags ?? [] : after[key];
    if (JSON.stringify(previous) !== JSON.stringify(next)) Object.assign(patch, { [key]: key === "destination" ? next ?? inboxPath : next });
  }
  if ("scheduledDate" in patch || "scheduledTime" in patch) { patch.scheduledDate = after.scheduledDate; patch.scheduledTime = after.scheduledTime; }
  if ("deadline" in patch || "deadlineTime" in patch) { patch.deadline = after.deadline; patch.deadlineTime = after.deadlineTime; }
  return patch;
}

export class BulkTaskEditorModal extends Modal {
  private editor!: TaskLineEditor;
  private initialText = "";
  private actions?: HTMLElement;
  private focusTimer?: number;
  private stopViewportTracking?: () => void;
  private handleKeydown?: (event: KeyboardEvent) => void;
  constructor(app: App, private readonly options: BulkEditorOptions) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal", "tm-bulk-editor-modal");
    this.modalEl.setAttribute("aria-label", "Edit task properties");
    const content = this.contentEl;
    content.empty();
    const common = commonBulkValues(this.options.tasks, this.options.dateFormat);
    this.initialText = bulkInlineText(common, this.options.dateFormat);
    const host = content.createDiv({ cls: "tm-editor-inline tm-editor-raw-field" });
    const error = content.createDiv({ cls: "tm-editor-error", attr: { role: "alert" } });
    this.editor = new TaskLineEditor(host, this.initialText, this.options.dateFormat, () => error.empty(), "Add a date, duration, p1–p3, #[[tag]], or ~[[Project]]");

    this.actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    const remove = this.actions.createEl("button", { cls: "tm-delete-task tm-editor-icon-action", attr: { "aria-label": "Delete task", title: "Delete selected tasks and their subtasks" } });
    const save = this.actions.createEl("button", { cls: "mod-cta tm-editor-icon-action", attr: { "aria-label": "Save task", title: "Save task properties" } });
    setIcon(remove, "trash-2");
    setIcon(save, "check");
    const run = async (deleting: boolean): Promise<void> => {
      if (save.disabled) return;
      try {
        const patch = deleting ? {} : bulkInlinePatch(this.editor.value, this.initialText, this.options.dateFormat, this.options.inboxPath);
        save.disabled = remove.disabled = true;
        if (deleting) await this.options.onDelete();
        else await this.options.onSave(patch);
        this.close();
      } catch (cause) {
        save.disabled = remove.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not update selected tasks.";
        error.setText(message);
        new Notice(message);
      }
    };
    remove.addEventListener("click", () => { void run(true); });
    save.addEventListener("click", () => { void run(false); });
    this.handleKeydown = event => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
      if ((event.target as HTMLElement)?.tagName === "BUTTON") return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void run(false);
    };
    content.addEventListener("keydown", this.handleKeydown, true);
    this.stopViewportTracking = trackModalViewport(this.modalEl, content);
    this.focusTimer = window.setTimeout(() => {
      this.editor.focus();
      const token = this.options.focusProperty ? inlineTaskTokens(this.editor.value, this.options.dateFormat).find(item => item.token?.kind === this.options.focusProperty) : undefined;
      const start = token?.from ?? this.editor.value.length;
      this.editor.setSelectionRange(start, token?.to ?? start);
    }, 0);
  }

  onClose(): void {
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.editor.destroy();
    this.stopViewportTracking?.();
    this.actions?.remove();
    if (this.handleKeydown) this.contentEl.removeEventListener("keydown", this.handleKeydown, true);
    this.contentEl.empty();
  }
}
