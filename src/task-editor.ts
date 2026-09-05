import { destinationString } from "./structure";
import { Modal, Notice, setIcon, type App } from "obsidian";
import { formatDate, formatDateTime, parseDateTimeExpression, todayIso, tomorrowIso } from "./date";
import { formatDuration, parseTaskInput, parseTaskLine, serializeTaskInput } from "./parser";
import type { Project, Task, TaskDraft, TaskManagerSettings, TaskViewMode } from "./types";

export interface TaskEditorOptions {
  task?: Task;
  mode: TaskViewMode;
  projectPath?: string;
  projects: Project[];
  settings: TaskManagerSettings;
  dateFormat: string;
  onSave: (draft: TaskDraft) => Promise<void>;
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
    indent: 0
  };
}

function field(parent: HTMLElement, label: string, input: HTMLElement): void {
  const row = parent.createDiv({ cls: "tm-editor-field" });
  row.createEl("label", { text: label });
  row.appendChild(input);
}

export class TaskEditorModal extends Modal {
  private draft: TaskDraft;
  private rawDirty = false;
  private rawInput!: HTMLTextAreaElement;
  private titleInput!: HTMLInputElement;
  private scheduledInput!: HTMLInputElement;
  private deadlineInput!: HTMLInputElement;
  private durationInput!: HTMLInputElement;
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
    this.rawInput.placeholder = "Task today at 9pm {tomorrow at noon} 30m p1 ~[[Project#Heading]]";
    this.rawInput.rows = 2;
    this.rawInput.value = serializeTaskInput(this.draft, this.options.dateFormat);

    this.titleInput = contentEl.createEl("input", { type: "text", cls: "tm-editor-title" });
    this.titleInput.placeholder = "What needs to be done?";
    this.titleInput.value = this.draft.title;
    field(contentEl, "Title", this.titleInput);

    this.scheduledInput = contentEl.createEl("input", { type: "text" });
    this.scheduledInput.placeholder = `Tomorrow, next Friday, or ${formatDate(todayIso(), this.options.dateFormat)}`;
    this.scheduledInput.value = this.draft.scheduledDate ? formatDateTime(this.draft.scheduledDate, this.draft.scheduledTime, this.options.dateFormat) : "";
    field(contentEl, "Scheduled date and time", this.scheduledInput);

    this.deadlineInput = contentEl.createEl("input", { type: "text" });
    this.deadlineInput.placeholder = "Tomorrow at noon";
    this.deadlineInput.value = this.draft.deadline ? formatDateTime(this.draft.deadline, this.draft.deadlineTime, this.options.dateFormat) : "";
    field(contentEl, "Deadline", this.deadlineInput);

    this.durationInput = contentEl.createEl("input", { type: "text" });
    this.durationInput.placeholder = "For example 1h30m";
    this.durationInput.value = this.draft.durationMinutes ? formatDuration(this.draft.durationMinutes) : "";
    field(contentEl, "Duration", this.durationInput);

    this.priorityInput = contentEl.createEl("select");
    for (const [value, label] of [["", "No priority"], ["1", "P1 — High"], ["2", "P2 — Medium"], ["3", "P3 — Low"]]) {
      this.priorityInput.createEl("option", { value, text: label });
    }
    this.priorityInput.value = this.draft.priority ? String(this.draft.priority) : "";
    field(contentEl, "Priority", this.priorityInput);

    this.destinationInput = contentEl.createEl("select");
    const destinations = new Set([this.options.settings.inboxPath, this.draft.destination]);
    for (const project of this.options.projects) {
      destinations.add(project.path);
      for (const heading of project.headings ?? []) destinations.add(destinationString(project.path, heading.name));
    }
    for (const path of [...destinations].sort()) this.destinationInput.createEl("option", { value: path, text: path });
    this.destinationInput.value = this.draft.destination;
    field(contentEl, "Destination", this.destinationInput);

    const error = contentEl.createDiv({ cls: "tm-editor-error" });
    const syncFromStructured = (): void => {
      this.rawDirty = false;
      error.empty();
      const next = this.readStructured(false);
      if (next) {
        this.draft = next;
        this.rawInput.value = serializeTaskInput(next, this.options.dateFormat);
      }
    };
    const structuredInputs: Array<HTMLInputElement | HTMLSelectElement> = [
      this.titleInput,
      this.scheduledInput,
      this.deadlineInput,
      this.durationInput,
      this.priorityInput,
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
      const parsed = parseTaskInput(this.rawInput.value, new Date(), this.options.dateFormat, !this.options.task);
      if (!parsed) {
        error.setText("Raw text must be one valid checklist line.");
        return;
      }
      error.empty();
      this.titleInput.value = parsed.title;
      this.scheduledInput.value = parsed.scheduledDate ? formatDateTime(parsed.scheduledDate, parsed.scheduledTime, this.options.dateFormat) : "";
      this.deadlineInput.value = parsed.deadline ? formatDateTime(parsed.deadline, parsed.deadlineTime, this.options.dateFormat) : "";
      this.durationInput.value = parsed.durationMinutes ? formatDuration(parsed.durationMinutes) : "";
      this.priorityInput.value = parsed.priority ? String(parsed.priority) : "";
      if (parsed.destination) {
        if (!Array.from(this.destinationInput.options).some((option) => option.value === parsed.destination)) {
          this.destinationInput.createEl("option", { value: parsed.destination, text: parsed.destination });
        }
        this.destinationInput.value = parsed.destination;
      }
    });

    const actions = contentEl.createDiv({ cls: "tm-editor-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "Save task", cls: "mod-cta" });
    const saveIcon = save.createSpan({ cls: "tm-button-icon" });
    setIcon(saveIcon, "check");
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      try {
        const next = this.rawDirty ? this.readRaw() : this.readStructured(true);
        if (!next) return;
        save.disabled = true;
        await this.options.onSave(next);
        this.close();
      } catch (cause) {
        save.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not save the task.";
        error.setText(message);
        new Notice(message);
      }
    });

    contentEl.onkeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.isComposing) return;
      // Keep native keyboard activation for explicit actions such as Cancel.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !save.disabled) save.click();
    };

    window.setTimeout(() => {
      this.rawInput.focus();
      const titleStart = this.rawInput.value.indexOf("] ") + 2;
      this.rawInput.setSelectionRange(titleStart, titleStart + this.draft.title.length);
    }, 0);
  }

  onClose(): void {
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }

  private readRaw(): TaskDraft | undefined {
    const parsed = parseTaskInput(this.rawInput.value, new Date(), this.options.dateFormat, !this.options.task);
    if (!parsed || !parsed.title) {
      new Notice("Raw text must be one valid checklist line with a title.");
      return undefined;
    }
    return { ...parsed, destination: parsed.destination ?? this.destinationInput.value };
  }

  private readStructured(notify: boolean): TaskDraft | undefined {
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
    return {
      title,
      scheduledDate: scheduledDate?.date,
      scheduledTime: scheduledDate?.time,
      deadline: deadline?.date,
      deadlineTime: deadline?.time,
      durationMinutes,
      priority: this.priorityInput.value ? Number(this.priorityInput.value) as 1 | 2 | 3 : undefined,
      completed: this.draft.completed,
      destination: this.destinationInput.value,
      indent: this.draft.indent
    };
  }

  private readDate(value: string, label: string, notify: boolean): { date: string; time?: string } | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseDateTimeExpression(value, new Date(), this.options.dateFormat);
    if (!parsed && notify) new Notice(`Could not understand the ${label}.`);
    return parsed;
  }
}
