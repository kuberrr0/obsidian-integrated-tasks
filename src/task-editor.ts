import { TaskLineEditor } from "./task-line-editor";
import { parseTaskTreeInput } from "./task-input";
import type { TaskEditorPreset } from "./types";
import { trackModalViewport } from "./mobile-layout";
import { destinationString } from "./structure";
import { Modal, Notice, setIcon, type App } from "obsidian";
import { todayIso, tomorrowIso } from "./date";
import { parseTaskInput, parseTaskLine, serializeTask, serializeTaskInput } from "./parser";
import type { Project, Task, TaskDraft, TaskManagerSettings, TaskViewMode } from "./types";

export type TaskEditorProperty = "scheduledDate" | "deadline" | "durationMinutes" | "priority" | "tags";

export interface TaskEditorOptions {
  focusProperty?: TaskEditorProperty;
  task?: Task;
  preset?: TaskEditorPreset;
  mode: TaskViewMode;
  projectPath?: string;
  projects: Project[];
  settings: TaskManagerSettings;
  dateFormat: string;
  onSave: (draft: TaskDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
}

function initialDraft(options: TaskEditorOptions): TaskDraft {
  if (options.task) {
    return {
      title: options.task.title,
      scheduledDate: options.task.scheduledDate,
      scheduledTime: options.task.scheduledTime,
      deadline: options.task.deadline,
      deadlineTime: options.task.deadlineTime,
      durationMinutes: options.task.durationMinutes,
      priority: options.task.priority,
      tags: options.task.tags,
      completed: options.task.completed,
      destination: destinationString(options.task.path, options.task.section),
      indent: options.task.indent
    };
  }
  return {
    title: "",
    scheduledDate: options.mode === "today" ? todayIso() : options.mode === "upcoming" ? tomorrowIso() : undefined,
    completed: false,
    destination: options.projectPath ?? options.settings.inboxPath,
    indent: 0,
    ...options.preset
  };
}

export class TaskEditorModal extends Modal {
  private draft: TaskDraft;
  private stopViewportTracking?: () => void;
  private actions?: HTMLElement;
  private focusTimer?: number;
  private handleKeydown?: (event: KeyboardEvent) => void;
  private completedInput!: HTMLInputElement;
  private taskIndent = "";
  private rawInput!: TaskLineEditor;

  constructor(app: App, private readonly options: TaskEditorOptions) {
    super(app);
    this.draft = initialDraft(options);
  }

  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal");
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.setAttribute("aria-label", this.options.task ? "Edit task" : "New task");

    const rawField = contentEl.createDiv({ cls: "tm-editor-raw-field" });
    const taskLine = rawField.createDiv({ cls: "tm-editor-task-line tm-note-task-line" });
    this.completedInput = taskLine.createEl("input", { type: "checkbox", cls: "tm-editor-checkbox", attr: { "aria-label": "Completed" } });
    this.completedInput.checked = this.draft.completed;
    this.taskIndent = " ".repeat(this.draft.indent);
    const initial = this.options.task
      ? this.options.task.raw + this.serializeDraft(this.draft).slice(serializeTask(this.draft, this.options.dateFormat, this.options.settings.linkDates).length)
      : this.serializeDraft(this.draft);
    const source = initial.replace(/^([ \t]*)[-+*]\s+\[([ xX])\][ \t]*/, "");
    const editorHost = taskLine.createDiv({ cls: "tm-editor-inline" });
    const error = contentEl.createDiv({ cls: "tm-editor-error" });
    const updatePriority = (): void => {
      const parsed = parseTaskInput(this.rawInput.value, new Date(), this.options.dateFormat);
      taskLine.setAttribute("data-tm-priority", String(parsed?.priority ?? ""));
      error.empty();
    };
    this.rawInput = new TaskLineEditor(editorHost, source, this.options.dateFormat, updatePriority);
    updatePriority();

    const actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    this.actions = actions;
    const deleteButton = this.options.task && this.options.onDelete
      ? actions.createEl("button", { cls: "tm-delete-task tm-editor-icon-action", attr: { "aria-label": "Delete task", title: this.options.task.childIds.length ? "Delete this task and its subtasks" : "Delete this task" } })
      : undefined;
    if (deleteButton) setIcon(deleteButton, "trash-2");
    const save = actions.createEl("button", { cls: "mod-cta tm-editor-icon-action", attr: { "aria-label": "Save task", title: "Save task" } });
    setIcon(save, "check");
    const saveTask = async (): Promise<void> => {
      if (save.disabled) return;
      try {
        const next = this.readRaw();
        if (!next) return;
        save.disabled = true;
        if (deleteButton) deleteButton.disabled = true;
        await this.options.onSave(next);
        this.close();
      } catch (cause) {
        save.disabled = false;
        if (deleteButton) deleteButton.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not save the task.";
        error.setText(message);
        new Notice(message);
      }
    };
    save.addEventListener("click", () => { void saveTask(); });
    const deleteTask = async (): Promise<void> => {
      if (!deleteButton || deleteButton.disabled || save.disabled || !this.options.onDelete) return;
      deleteButton.disabled = true;
      save.disabled = true;
      try {
        await this.options.onDelete();
        this.close();
      } catch (cause) {
        deleteButton.disabled = false;
        save.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not delete the task.";
        error.setText(message);
        new Notice(message);
      }
    };
    deleteButton?.addEventListener("click", () => { void deleteTask(); });

    this.handleKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
      // Keep native keyboard activation for explicit action buttons.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !save.disabled) save.click();
    };

    // Capture Enter before CodeMirror can insert a newline.
    contentEl.addEventListener("keydown", this.handleKeydown, true);

    this.stopViewportTracking = trackModalViewport(this.modalEl, contentEl);
    this.focusTimer = window.setTimeout(() => {
      this.rawInput.focus();
      if (this.options.focusProperty) {
        const ranges: import("./parser").ParsedTokenRange[] = [];
        parseTaskLine(`- [ ] ${this.rawInput.value}`, new Date(), this.options.dateFormat, false, ranges);
        const token = ranges.find(range => range.kind === this.options.focusProperty);
        const start = token ? token.from - 6 : this.rawInput.value.length;
        this.rawInput.setSelectionRange(start, token ? token.to - 6 : start);
        return;
      }
      this.rawInput.setSelectionRange(0, 0);
    }, 0);
  }

  onClose(): void {
    this.rawInput.destroy();
    window.clearTimeout(this.focusTimer);
    this.stopViewportTracking?.();
    this.actions?.remove();
    if (this.handleKeydown) this.contentEl.removeEventListener("keydown", this.handleKeydown, true);
    this.contentEl.empty();
  }

  private serializeDraft(draft: TaskDraft): string {
    return draft.destination === this.options.settings.inboxPath
      ? serializeTask(draft, this.options.dateFormat, this.options.settings.linkDates)
      : serializeTaskInput(draft, this.options.dateFormat, this.options.settings.linkDates);
  }

  /** Accept pasted Markdown while keeping its checkbox out of the text field. */
  private normalizeChecklist(): void {
    const prefix = /^([ \t]*)[-+*]\s+\[([ xX])\][ \t]*/.exec(this.rawInput.value);
    if (!prefix) return;
    this.taskIndent = prefix[1];
    this.completedInput.checked = prefix[2].toLowerCase() === "x";
    const start = this.rawInput.selectionStart;
    const end = this.rawInput.selectionEnd;
    this.rawInput.value = this.rawInput.value.slice(prefix[0].length);
    this.rawInput.setSelectionRange(Math.max(0, start - prefix[0].length), Math.max(0, end - prefix[0].length));
  }

  private readRaw(): TaskDraft {
    this.normalizeChecklist();
    const markdown = `${this.taskIndent}- [${this.completedInput.checked ? "x" : " "}] ${this.rawInput.value}`;
    if (!this.options.task) return parseTaskTreeInput(markdown, this.options.settings.inboxPath, new Date(), this.options.dateFormat, this.options.settings.linkDates);
    if (/\n[^\n]*\S/.test(this.rawInput.value)) {
      throw new Error("Edit one task at a time; use New task to add multiple tasks.");
    }
    const value = markdown.trimEnd();
    if (/^\s*[-+*]\s+\[[ xX]\]\s*$/.test(value)) throw new Error("Enter a task title.");
    // Saving an untouched note line must not reinterpret prose as natural dates.
    if (this.rawInput.value === this.rawInput.defaultValue) return { ...this.draft, completed: this.completedInput.checked };
    const parsed = parseTaskInput(value, new Date(), this.options.dateFormat, true);
    if (!parsed?.title) throw new Error("Enter a task title.");
    return { ...parsed, destination: parsed.destination ?? this.options.settings.inboxPath };
  }
}
