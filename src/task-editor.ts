import { TaskLineEditor } from "./task-line-editor";
import { parseEditedTaskInput, parseTaskTreeInput, replaceTaskTokens, taskTokenText, type InputTokenKind } from "./task-input";
import type { TaskEditorPreset } from "./types";
import { presentAsBottomSheet, trackModalViewport } from "./mobile-layout";
import { draftFromTask, draftWithTitle } from "./task-draft";
import { formatTags } from "./task-tags";
import { Modal, Notice, Platform, setIcon, type App } from "obsidian";
import { todayIso, tomorrowIso } from "./date";
import { repeatLabel, serializeTask, serializeTaskInput } from "./parser";
import { openDatePopover } from "./date-popover";
import { openChoicePopover, PRIORITY_CHOICES, projectChoices, repeatChoices, REPEAT_INPUT } from "./choice-popover";
import { openTagsPopover } from "./task-menu";
import { thingsDateLabel } from "./things-row-details";
import { taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import { STATUS_CHARS, STATUS_ICONS, STATUS_LABELS, TASK_STATUSES, draftStatus, isClosedStatus, statusClass, statusFromChar } from "./task-status";
import type { Project, Task, TaskDraft, TaskManagerSettings, TaskStatus, TaskViewMode } from "./types";

export type TaskEditorProperty = "scheduledDate" | "deadline" | "defer" | "durationMinutes" | "priority" | "tags" | "repeat";

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
  /** Existing tags, offered by the Tags button. */
  tagSuggestions?: string[];
  /** Creates a project note named as typed in the Project button's search; returns its path. */
  createProject?: (name: string) => Promise<string>;
}

/** A new task's starting values: the view's preset, its project, and Today's or Upcoming's date. */
export function initialDraft(options: Pick<TaskEditorOptions, "task" | "mode" | "projectPath" | "settings" | "preset">): TaskDraft {
  if (options.task) return draftFromTask(options.task);
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
  private stopBottomSheet?: () => void;
  private actions?: HTMLElement;
  private focusTimer?: number;
  private handleKeydown?: (event: KeyboardEvent) => void;
  /** The task's status, set from the Status button (or a pasted checkbox). */
  private chosenStatus: TaskStatus = "todo";
  private taskIndent = "";
  private rawInput!: TaskLineEditor;
  /** Shows the values the text now sets on the property buttons. */
  private paintProperties?: () => void;
  /** The property buttons, by the property each edits. */
  private propertyButtons = new Map<TaskEditorProperty, HTMLElement>();

  constructor(app: App, private readonly options: TaskEditorOptions) {
    super(app);
    this.draft = initialDraft(options);
  }

  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal");
    // On phones the editor hangs from the top of the screen, clear of the keyboard, with its popovers above it.
    this.stopBottomSheet = presentAsBottomSheet(this.modalEl, () => this.close(), Platform.isMobile);
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.setAttribute("aria-label", this.options.task ? "Edit task" : "New task");

    const rawField = contentEl.createDiv({ cls: "tm-editor-raw-field" });
    const taskLine = rawField.createDiv({ cls: "tm-editor-task-line tm-note-task-line" });
    // The status is the last property button, below the text.
    this.chosenStatus = draftStatus(this.draft);
    this.taskIndent = " ".repeat(this.draft.indent);
    // Editing, the field holds the title alone, as a card's does: the task's properties are on the buttons below,
    // and a token typed into the title sets its property. A new task's field starts with its context as tokens
    // (a tag, date or project), after a space so the title typed at the start stays apart.
    const stripped = this.serializeDraft(this.draft).replace(/^([ \t]*)[-+*]\s+\[([ xX/?-])\][ \t]*/, "");
    const source = this.options.task ? this.options.task.title : stripped.trim() && !this.draft.title ? ` ${stripped.trimStart()}` : stripped;
    const editorHost = taskLine.createDiv({ cls: "tm-editor-inline" });
    const properties = contentEl.createDiv({ cls: "tm-editor-properties", attr: { role: "toolbar", "aria-label": "Task properties" } });
    const error = contentEl.createDiv({ cls: "tm-editor-error", attr: { role: "alert", "aria-live": "assertive" } });
    const updatePriority = (): void => {
      taskLine.setAttribute("data-tm-priority", String(this.readLine()?.priority ?? ""));
      error.empty();
      this.paintProperties?.();
    };
    this.rawInput = new TaskLineEditor(editorHost, source, this.options.dateFormat, updatePriority, `Call the dentist next Tuesday 3pm 30m {next Friday 5pm} >Monday every month p2 ${formatTags(["Health"])} ~[[Errands]]`, !this.options.task);
    this.renderProperties(properties);
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
      this.rawInput.setSelectionRange(0, 0);
      // Opened for one property, its button's popover opens too.
      if (this.options.focusProperty) this.propertyButtons.get(this.options.focusProperty)?.click();
    }, 0);
  }

  /** Escape (or a click outside) first closes a property popover the modal opened, then the modal. */
  close(): void {
    const popover = this.contentEl.ownerDocument?.querySelector?.<HTMLElement>(".tm-date-popover, .tm-choice-popover, .tm-tags-popover");
    if (popover) { popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return; }
    super.close();
  }

  onClose(): void {
    this.rawInput.destroy();
    window.clearTimeout(this.focusTimer);
    this.stopViewportTracking?.();
    this.stopBottomSheet?.();
    this.actions?.remove();
    if (this.handleKeydown) this.contentEl.removeEventListener("keydown", this.handleKeydown, true);
    this.contentEl.empty();
  }

  /**
   * An edited task as it would now save: its values (the buttons change them) with what is typed into the title
   * applied, as in a card: a typed date or priority replaces the value, typed tags join the task's, `~[[Note]]` moves it.
   */
  private preview(): TaskDraft {
    const task = this.options.task!;
    const text = this.rawInput.value.split("\n")[0];
    // An untouched title is never read again, so its words stay words.
    if (text.trim() === task.title) return { ...this.draft, title: task.title };
    return draftWithTitle(this.draft, task.title, text, new Date(), this.options.dateFormat);
  }

  /** What the task now has, for the property buttons: an edited task's preview, or a new task's typed tokens. */
  private readLine(): Partial<TaskDraft> | undefined {
    if (this.options.task) return this.preview();
    return parseEditedTaskInput(this.rawInput.value.split("\n")[0], "", new Date(), this.options.dateFormat);
  }

  /**
   * Applies a property button's choice (`values`, the fields of `kinds`; undefined clears one). An edited task takes the
   * value directly, and a token typed into its title for the same property comes out, so it cannot override the choice.
   * A new task's text gets the value's token in place of the old one.
   */
  private rewrite(kinds: InputTokenKind[], values: Partial<TaskDraft>): void {
    const text = this.rawInput.value;
    let next: string;
    if (this.options.task) {
      Object.assign(this.draft, values, "destination" in values && !values.destination ? { destination: this.options.settings.inboxPath } : {});
      next = replaceTaskTokens(text, kinds, "", this.options.task.title, new Date(), this.options.dateFormat);
    } else {
      const token = taskTokenText(values, this.options.dateFormat, this.options.settings.linkDates);
      next = replaceTaskTokens(text, kinds, token, "", new Date(), this.options.dateFormat);
    }
    if (next !== text) this.rawInput.value = next;
    else this.paintProperties?.();
  }

  /**
   * Buttons below the text for the date (with time and duration), deadline, priority, project, tags and repeat.
   * Each shows the value the text sets and opens its popover; a choice there rewrites that token in the text.
   */
  private renderProperties(parent: HTMLElement): void {
    /** `unset`: what the button reads without a value (the project's is "Inbox"). */
    const button = (icon: string, name: string, open: (anchor: HTMLElement) => void, unset = name, properties: TaskEditorProperty[] = []): { set(value: string | undefined, cls?: string, icon?: string): void } => {
      const element = parent.createEl("button", { cls: "tm-editor-property", attr: { type: "button" } });
      for (const property of properties) this.propertyButtons.set(property, element);
      const iconEl = element.createSpan({ cls: "tm-editor-property-icon", attr: { "aria-hidden": "true" } });
      setIcon(iconEl, icon);
      let shownIcon = icon;
      const label = element.createSpan({ cls: "tm-editor-property-label" });
      element.addEventListener("click", () => open(element));
      return {
        set: (value, cls = "", nextIcon = icon) => {
          if (nextIcon !== shownIcon) { iconEl.empty(); setIcon(iconEl, nextIcon); shownIcon = nextIcon; }
          label.setText(value ?? unset);
          element.className = `tm-editor-property${value ? " is-set" : ""}${cls ? ` ${cls}` : ""}`;
          element.setAttribute("aria-label", value || unset !== name ? `${name}: ${value ?? unset}` : name);
        }
      };
    };
    const format = this.options.dateFormat;
    const inbox = this.options.settings.inboxPath;
    const day = (date: string): string => date === todayIso() ? "Today" : thingsDateLabel(date);
    const when = button("calendar", "When", anchor => {
      const line = this.readLine();
      openDatePopover({
        anchor, kind: "scheduled", dateFormat: format, value: { date: line?.scheduledDate, time: line?.scheduledTime, duration: line?.durationMinutes },
        save: value => this.rewrite(["scheduledDate", "durationMinutes"], { scheduledDate: value.date, scheduledTime: value.date ? value.time : undefined, durationMinutes: value.duration })
      });
    }, "When", ["scheduledDate", "durationMinutes"]);
    const deadline = button("flag", "Deadline", anchor => {
      const line = this.readLine();
      openDatePopover({
        anchor, kind: "deadline", dateFormat: format, value: { date: line?.deadline, time: line?.deadlineTime },
        save: value => this.rewrite(["deadline"], { deadline: value.date, deadlineTime: value.date ? value.time : undefined })
      });
    }, "Deadline", ["deadline"]);
    const priority = button("signal", "Priority", anchor => openChoicePopover({
      anchor, label: "Priority", choices: PRIORITY_CHOICES, cycleKey: "p", selected: String(this.readLine()?.priority ?? ""),
      choose: value => this.rewrite(["priority"], { priority: value ? Number(value) as TaskDraft["priority"] : undefined })
    }), "Priority", ["priority"]);
    const project = button("folder", "Project", anchor => {
      const current = (this.readLine()?.destination ?? inbox).split("#")[0];
      // Inbox needs no token: a task without one goes there.
      const move = (path: string): void => this.rewrite(["destination"], { destination: path === inbox ? undefined : path });
      const create = this.options.createProject;
      openChoicePopover({
        anchor, label: "Project", choices: projectChoices(this.options.projects, inbox, current), selected: current, choose: move,
        input: { placeholder: create ? "Find or create a project" : "Find a project", filter: true, create: create && {
          label: text => `Create project “${text}”`, icon: "folder-plus",
          run: text => { create(text).then(move).catch((cause: unknown) => { new Notice(cause instanceof Error ? cause.message : "Could not create the project."); }); }
        } }
      });
    }, "Inbox");
    const tags = button("tag", "Tags", anchor => {
      const own = this.readLine()?.tags ?? [];
      const write = (next: string[]): void => this.rewrite(["tags"], { tags: next.length ? next : undefined });
      openTagsPopover({
        anchor, tags: [...own.map(name => ({ name, state: "all" as const })), ...(this.options.tagSuggestions ?? []).filter(name => !own.includes(name)).map(name => ({ name, state: "none" as const }))],
        toggle: (tag, on) => { const current = this.readLine()?.tags ?? []; write(on ? [...new Set([...current, tag])] : current.filter(item => item !== tag)); },
        add: added => write([...new Set([...(this.readLine()?.tags ?? []), ...added])])
      });
    }, "Tags", ["tags"]);
    const repeat = button("repeat", "Repeat", anchor => {
      const current = this.readLine()?.repeat ?? "";
      openChoicePopover({
        anchor, label: "Repeat", choices: repeatChoices(current), selected: current, input: REPEAT_INPUT,
        choose: value => this.rewrite(["repeat"], { repeat: value || undefined })
      });
    }, "Repeat", ["repeat"]);
    // The status comes last; in its list, S moves on to the next status, as in task views.
    const status = button("circle", "Status", anchor => openChoicePopover({
      anchor, label: "Status", cycleKey: "s", selected: this.chosenStatus,
      choices: TASK_STATUSES.map(value => ({ value, label: STATUS_LABELS[value], icon: STATUS_ICONS[value] })),
      choose: value => this.setStatus(value as TaskStatus)
    }));
    this.paintProperties = () => {
      status.set(STATUS_LABELS[this.chosenStatus], `is-status${statusClass(this.chosenStatus)}`, STATUS_ICONS[this.chosenStatus]);
      const line = this.readLine();
      const time = taskTimeDurationLabel(line?.scheduledTime, line?.durationMinutes);
      when.set(line?.scheduledDate ? [day(line.scheduledDate), time].filter(Boolean).join(", ") : time || undefined);
      deadline.set(line?.deadline ? [day(line.deadline), line.deadlineTime && taskTimeLabel(line.deadlineTime)].filter(Boolean).join(", ") : undefined);
      priority.set(line?.priority ? `P${line.priority}` : undefined, line?.priority ? `is-p${line.priority}` : "");
      const destination = line?.destination;
      project.set(destination && destination.split("#")[0] !== inbox ? destination.replace(/\.md(?=#|$)/i, "").split("/").pop()!.replace("#", " › ") : undefined);
      tags.set(line?.tags?.length ? line.tags.join(", ") : undefined);
      repeat.set(line?.repeat ? repeatLabel(line.repeat) : undefined);
    };
  }

  private serializeDraft(draft: TaskDraft): string {
    return draft.destination === this.options.settings.inboxPath
      ? serializeTask(draft, this.options.dateFormat, this.options.settings.linkDates)
      : serializeTaskInput(draft, this.options.dateFormat, this.options.settings.linkDates);
  }

  private status(): TaskStatus { return this.chosenStatus; }

  private setStatus(status: TaskStatus): void {
    this.chosenStatus = status;
    this.paintProperties?.();
  }

  /** Accept pasted Markdown while keeping its checkbox out of the text field. */
  private normalizeChecklist(): void {
    const prefix = /^([ \t]*)[-+*]\s+\[([ xX/?-])\][ \t]*/.exec(this.rawInput.value);
    if (!prefix) return;
    this.taskIndent = prefix[1];
    this.setStatus(statusFromChar(prefix[2])!);
    const start = this.rawInput.selectionStart;
    const end = this.rawInput.selectionEnd;
    this.rawInput.value = this.rawInput.value.slice(prefix[0].length);
    this.rawInput.setSelectionRange(Math.max(0, start - prefix[0].length), Math.max(0, end - prefix[0].length));
  }

  private readRaw(): TaskDraft {
    this.normalizeChecklist();
    const status = this.status();
    const checkbox = `${this.taskIndent}- [${STATUS_CHARS[status]}] `;
    if (!this.options.task) return parseTaskTreeInput(checkbox + this.rawInput.value, this.options.settings.inboxPath, new Date(), this.options.dateFormat, this.options.settings.linkDates);
    if (/\n[^\n]*\S/.test(this.rawInput.value)) {
      throw new Error("Edit one task at a time; use New task to add multiple tasks.");
    }
    if (!this.rawInput.value.trim()) throw new Error("Enter a task title.");
    return { ...this.preview(), status, completed: isClosedStatus(status) };
  }
}
