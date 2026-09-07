import { formatTags, parseTags } from "./task-tags";
import { newTaskLines } from "./task-description";
import { parseTaskTreeInput } from "./task-input";
import type { TaskEditorPreset } from "./types";
import { trackModalViewport } from "./mobile-layout";
import { destinationLabel, destinationString } from "./structure";
import { Modal, Notice, setIcon, type App } from "obsidian";
import { formatDate, formatDateTime, parseDateTimeExpression, todayIso, tomorrowIso } from "./date";
import { formatDuration, scanTasks, parseTaskInput, parseTaskLine, serializeTask, serializeTaskInput } from "./parser";
import type { Project, Task, TaskDraft, TaskManagerSettings, TaskViewMode } from "./types";

export interface TaskEditorOptions {
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

function field(parent: HTMLElement, label: string, input: HTMLElement): void {
  const row = parent.createDiv({ cls: "tm-editor-field" });
  const caption = row.createEl("label", { text: label });
  input.setAttribute("aria-label", label);
  caption.addEventListener("click", () => input.focus());
  row.appendChild(input);
}

export class TaskEditorModal extends Modal {
  private draft: TaskDraft;
  private rawDirty = false;
  private descriptionDirty = false;
  private lastRawDescription = "";
  private descriptionInput!: HTMLTextAreaElement;
  private stopViewportTracking?: () => void;
  private actions?: HTMLElement;
  private focusTimer?: number;
  private rawInput!: HTMLTextAreaElement;
  private titleInput!: HTMLInputElement;
  private scheduledInput!: HTMLInputElement;
  private deadlineInput!: HTMLInputElement;
  private durationInput!: HTMLInputElement;
  private tagsInput!: HTMLInputElement;
  private priorityInput!: HTMLSelectElement;
  private destinationInput!: HTMLSelectElement;

  constructor(app: App, private readonly options: TaskEditorOptions) {
    super(app);
    this.draft = initialDraft(options);
  }

  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal");
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "tm-editor-header" });
    header.createEl("h2", { text: this.options.task ? "Edit task" : "New task" });

    const rawField = contentEl.createDiv({ cls: "tm-editor-raw-field" });
    this.rawInput = rawField.createEl("textarea", { cls: "tm-editor-raw" });
    this.rawInput.setAttribute("aria-label", "Task text");
    this.rawInput.placeholder = "Task today at 9pm 30m {tomorrow at noon} p1 ~[[Project#Heading]]";
    this.rawInput.rows = this.options.task ? 2 : 5;
    rawField.createDiv({ cls: "tm-editor-raw-help", text: this.options.task
      ? "Cmd/Ctrl+Enter to save."
      : "One task per line. Indent subtasks; use indented bullets for descriptions. Cmd/Ctrl+Enter to save." });
    this.rawInput.value = this.serializeDraft(this.draft);

    this.titleInput = contentEl.createEl("input", { type: "text", cls: "tm-editor-title" });
    this.titleInput.placeholder = "What needs to be done?";
    this.titleInput.value = this.draft.title;
    field(contentEl, "Title", this.titleInput);

    this.scheduledInput = contentEl.createEl("input", { type: "text" });
    this.scheduledInput.placeholder = `Tomorrow, next Friday, or ${formatDate(todayIso(), this.options.dateFormat)}`;
    this.scheduledInput.value = this.draft.scheduledDate ? formatDateTime(this.draft.scheduledDate, this.draft.scheduledTime, this.options.dateFormat) : "";
    field(contentEl, "Scheduled date and time", this.scheduledInput);

    this.durationInput = contentEl.createEl("input", { type: "text" });
    this.durationInput.placeholder = "For example 1h30m";
    this.durationInput.value = this.draft.durationMinutes ? formatDuration(this.draft.durationMinutes) : "";
    field(contentEl, "Duration", this.durationInput);

    this.deadlineInput = contentEl.createEl("input", { type: "text" });
    this.deadlineInput.placeholder = "Tomorrow at noon";
    this.deadlineInput.value = this.draft.deadline ? formatDateTime(this.draft.deadline, this.draft.deadlineTime, this.options.dateFormat) : "";
    field(contentEl, "Deadline", this.deadlineInput);

    this.priorityInput = contentEl.createEl("select");
    for (const [value, label] of [["", "No priority"], ["1", "P1 — High"], ["2", "P2 — Medium"], ["3", "P3 — Low"]]) {
      this.priorityInput.createEl("option", { value, text: label });
    }
    this.priorityInput.value = this.draft.priority ? String(this.draft.priority) : "";
    field(contentEl, "Priority", this.priorityInput);

    this.tagsInput = contentEl.createEl("input", { type: "text" });
    this.tagsInput.placeholder = "#[[work]] #[[client notes]]";
    this.tagsInput.value = formatTags(this.draft.tags);
    field(contentEl, "Tags", this.tagsInput);

    this.destinationInput = contentEl.createEl("select");
    const destinations = new Set([this.options.settings.inboxPath, this.draft.destination]);
    for (const project of this.options.projects) {
      destinations.add(project.path);
      for (const heading of project.headings ?? []) destinations.add(destinationString(project.path, heading.name));
    }
    for (const path of [...destinations].sort()) this.destinationInput.createEl("option", { value: path, text: destinationLabel(path) });
    this.destinationInput.value = this.draft.destination;
    field(contentEl, "Destination", this.destinationInput);

    const description = contentEl.createDiv({ cls: "tm-description-field" });
    const descriptionLabel = description.createEl("label", { text: "Description" });
    this.descriptionInput = description.createEl("textarea", { cls: "tm-description-input", attr: { "aria-label": "Description", placeholder: "Add a description…" } });
    this.descriptionInput.rows = 4;
    this.descriptionInput.value = this.options.task?.description ?? this.draft.description ?? "";
    descriptionLabel.addEventListener("click", () => this.descriptionInput.focus());
    this.descriptionInput.addEventListener("input", () => {
      this.descriptionDirty = true;
      if (this.options.task) return;
      try {
        const draft = parseTaskTreeInput(this.rawInput.value, this.options.settings.inboxPath, new Date(), this.options.dateFormat);
        const lines = newTaskLines({ ...draft, description: this.descriptionInput.value }, this.options.dateFormat);
        this.rawInput.value = [this.serializeDraft(draft), ...lines.slice(1)].join("\n");
        this.lastRawDescription = scanTasks("", lines.join("\n"), new Date(), this.options.dateFormat)[0]?.description ?? "";
        this.rawDirty = true;
      } catch { /* Keep the description while the main task title is incomplete. */ }
    });

    const error = contentEl.createDiv({ cls: "tm-editor-error" });
    const syncFromStructured = (): void => {
      this.rawDirty = false;
      error.empty();
      const next = this.readStructured(false);
      if (next) {
        this.draft = next;
        const remaining = this.rawInput.value.split(/\r?\n/).slice(1);
        this.rawInput.value = [this.serializeDraft(next), ...remaining].join("\n");
      }
    };
    const structuredInputs: Array<HTMLInputElement | HTMLSelectElement> = [
      this.titleInput,
      this.scheduledInput,
      this.durationInput,
      this.deadlineInput,
      this.priorityInput,
      this.tagsInput,
      this.destinationInput
    ];
    for (const input of structuredInputs) {
      input.addEventListener("input", syncFromStructured);
    }
    for (const [input, label] of [
      [this.scheduledInput, "scheduled date"],
      [this.deadlineInput, "deadline"]
    ] as const) {
      input.addEventListener("blur", () => {
        if (!input.value.trim()) return;
        const resolved = parseDateTimeExpression(input.value, new Date(), this.options.dateFormat);
        if (!resolved) {
          error.setText(`Could not understand the ${label}.`);
          return;
        }
        input.value = formatDateTime(resolved.date, resolved.time, this.options.dateFormat);
        syncFromStructured();
      });
    }
    this.rawInput.addEventListener("input", () => {
      this.rawDirty = true;
      const parsed = parseTaskInput(this.rawInput.value.split(/\r?\n/)[0], new Date(), this.options.dateFormat, true);
      if (!parsed) {
        error.setText("Enter a valid main task on the first line.");
        return;
      }
      error.empty();
      if (!this.options.task) {
        try {
          const draft = parseTaskTreeInput(this.rawInput.value, this.options.settings.inboxPath, new Date(), this.options.dateFormat);
          const description = scanTasks("", newTaskLines(draft, this.options.dateFormat).join("\n"), new Date(), this.options.dateFormat)[0]?.description ?? "";
          if (!this.descriptionDirty || description !== this.lastRawDescription) {
            this.descriptionInput.value = description;
            this.descriptionDirty = false;
          }
          this.lastRawDescription = description;
        } catch { /* Incomplete task lines should not discard description edits. */ }
      }
      this.draft = { ...parsed, destination: parsed.destination ?? this.options.settings.inboxPath };
      this.titleInput.value = parsed.title;
      this.scheduledInput.value = parsed.scheduledDate ? formatDateTime(parsed.scheduledDate, parsed.scheduledTime, this.options.dateFormat) : "";
      this.deadlineInput.value = parsed.deadline ? formatDateTime(parsed.deadline, parsed.deadlineTime, this.options.dateFormat) : "";
      this.durationInput.value = parsed.durationMinutes ? formatDuration(parsed.durationMinutes) : "";
      this.priorityInput.value = parsed.priority ? String(parsed.priority) : "";
      this.tagsInput.value = formatTags(parsed.tags);
      const destination = parsed.destination ?? this.options.settings.inboxPath;
      if (destination) {
        if (!Array.from(this.destinationInput.options).some((option) => option.value === destination)) {
          this.destinationInput.createEl("option", { value: destination, text: destinationLabel(destination) });
        }
        this.destinationInput.value = destination;
      }
    });

    const actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    this.actions = actions;
    const deleteButton = this.options.task && this.options.onDelete
      ? actions.createEl("button", { text: "Delete task", cls: "tm-delete-task", attr: { title: this.options.task.childIds.length ? "Delete this task and its subtasks" : "Delete this task" } })
      : undefined;
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "Save task", cls: "mod-cta" });
    const saveIcon = save.createSpan({ cls: "tm-button-icon" });
    setIcon(saveIcon, "check");
    const saveTask = async (): Promise<void> => {
      if (save.disabled) return;
      try {
        const next = this.rawDirty ? this.readRaw() : this.readStructured(true);
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

    contentEl.onkeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      // Keep native keyboard activation for explicit actions such as Cancel.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !save.disabled) save.click();
    };

    this.stopViewportTracking = trackModalViewport(this.modalEl, contentEl);
    this.focusTimer = window.setTimeout(() => {
      this.rawInput.focus();
      const titleStart = this.rawInput.value.indexOf("] ") + 2;
      this.rawInput.setSelectionRange(titleStart, titleStart + this.draft.title.length);
    }, 0);
  }

  onClose(): void {
    window.clearTimeout(this.focusTimer);
    this.stopViewportTracking?.();
    this.actions?.remove();
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }

  private serializeDraft(draft: TaskDraft): string {
    return draft.destination === this.options.settings.inboxPath
      ? serializeTask(draft, this.options.dateFormat)
      : serializeTaskInput(draft, this.options.dateFormat);
  }

  private readRaw(): TaskDraft | undefined {
    if (!this.options.task) return { ...parseTaskTreeInput(this.rawInput.value, this.options.settings.inboxPath, new Date(), this.options.dateFormat), ...this.descriptionPatch() };
    const parsed = parseTaskInput(this.rawInput.value.trimEnd(), new Date(), this.options.dateFormat, true);
    if (!parsed || !parsed.title) {
      new Notice("Raw text must be one valid checklist line with a title.");
      return undefined;
    }
    return { ...parsed, destination: parsed.destination ?? this.options.settings.inboxPath, ...this.descriptionPatch() };
  }

  private readStructured(notify: boolean): TaskDraft | undefined {
    if (notify && this.options.task && /\n[^\n]*\S/.test(this.rawInput.value)) {
      throw new Error("Edit one task at a time; use New task to add multiple tasks.");
    }
    const title = this.titleInput.value.trim();
    if (!title) {
      if (notify) new Notice("Enter a task title.");
      return undefined;
    }
    const scheduledDate = this.readDate(this.scheduledInput.value, "scheduled date", notify);
    if (this.scheduledInput.value.trim() && !scheduledDate) return undefined;
    const deadline = this.readDate(this.deadlineInput.value, "deadline", notify);
    if (this.deadlineInput.value.trim() && !deadline) return undefined;

    let durationMinutes: number | undefined;
    if (this.durationInput.value.trim()) {
      durationMinutes = parseTaskLine(`- [ ] Task ${this.durationInput.value.trim()}`, new Date(), this.options.dateFormat)?.durationMinutes;
      if (!durationMinutes) {
        if (notify) new Notice("Use a duration such as 45m, 2h, or 1h30m.");
        return undefined;
      }
    }
    let tags: string[];
    try { tags = parseTags(this.tagsInput.value); }
    catch (cause) {
      if (notify) new Notice(cause instanceof Error ? cause.message : "Invalid tags.");
      return undefined;
    }
    const additionalLines = notify && !this.options.task
      ? parseTaskTreeInput(this.rawInput.value, this.options.settings.inboxPath, new Date(), this.options.dateFormat).additionalLines
      : undefined;
    return {
      ...(additionalLines ? { additionalLines } : {}),
      ...this.descriptionPatch(),
      title,
      scheduledDate: scheduledDate?.date,
      scheduledTime: scheduledDate?.time,
      deadline: deadline?.date,
      deadlineTime: deadline?.time,
      durationMinutes,
      tags,
      priority: this.priorityInput.value ? Number(this.priorityInput.value) as 1 | 2 | 3 : undefined,
      completed: this.draft.completed,
      destination: this.destinationInput.value,
      indent: this.draft.indent
    };
  }

  private descriptionPatch(): Partial<TaskDraft> {
    return this.descriptionDirty ? { description: this.descriptionInput.value } : {};
  }

  private readDate(value: string, label: string, notify: boolean): { date: string; time?: string } | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseDateTimeExpression(value, new Date(), this.options.dateFormat);
    if (!parsed && notify) new Notice(`Could not understand the ${label}.`);
    return parsed;
  }
}
