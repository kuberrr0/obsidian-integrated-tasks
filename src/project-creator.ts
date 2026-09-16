import { Modal, type App } from "obsidian";
import { formatDate, parseDateExpression } from "./date";
import { trackModalViewport } from "./mobile-layout";
import type { Project } from "./types";

export interface ProjectDraft {
  name: string;
  date: string;
  endDate: string;
  deadline: string;
  priority: string;
  parent: string;
  tags: string;
  archived: boolean;
}
interface ProjectCreatorOptions {
  projects: Project[];
  dateFormat: string;
  linkDates: boolean;
  createProject: (draft: ProjectDraft) => Promise<void>;
  initial?: ProjectDraft;
  focusProperty?: keyof ProjectDraft;
}

export class ProjectCreatorModal extends Modal {
  private actions?: HTMLElement;
  private focusTimer?: ReturnType<typeof setTimeout>;
  private stopViewportTracking?: () => void;
  constructor(app: App, private readonly options: ProjectCreatorOptions) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal");
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: this.options.initial ? "Edit project" : "Create project" });
    const field = (label: string, kind: "input" | "select" = "input", placeholder?: string): HTMLInputElement | HTMLSelectElement => {
      const row = content.createDiv({ cls: "tm-editor-field" });
      const caption = row.createEl("label", { text: label });
      const input = kind === "select" ? row.createEl("select") : row.createEl("input", { type: "text", attr: { placeholder: placeholder ?? "" } });
      input.setAttribute("aria-label", label);
      caption.addEventListener("click", () => input.focus());
      return input;
    };
    const name = field("Project name", "input", "New project");
    const date = field("Start date", "input", "Tomorrow or a formatted date");
    const endDate = field("End date", "input", "Next Friday or a formatted date");
    const deadline = field("Deadline", "input", "Next Friday or a formatted date");
    const priority = field("Priority", "select");
    for (const [value, text] of [["", "No priority"], ["1", "P1 — High"], ["2", "P2 — Medium"], ["3", "P3 — Low"]]) priority.createEl("option", { value, text });
    const parent = field("Parent project", "select");
    parent.createEl("option", { value: "", text: "No parent" });
    for (const project of this.options.projects) parent.createEl("option", { value: project.path, text: project.path.replace(/\.md$/i, "") });
    const tags = field("Tags", "input", "project, work");
    tags.value = "project";
    const archiveRow = content.createEl("label", { cls: "tm-toggle" });
    const archived = archiveRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Archived" } });
    archiveRow.createSpan({ text: "Archived" });
    const fields = { name, date, endDate, deadline, priority, parent, tags, archived };
    if (this.options.initial) {
      const initial = this.options.initial;
      for (const key of ["name", "date", "endDate", "deadline", "priority", "parent", "tags"] as const) fields[key].value = initial[key];
      archived.checked = initial.archived;
    }
    const error = content.createDiv({ cls: "tm-editor-error", attr: { role: "alert" } });
    this.actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    const cancel = this.actions.createEl("button", { text: "Cancel" });
    const create = this.actions.createEl("button", { text: this.options.initial ? "Save project" : "Create project", cls: "mod-cta" });
    const submit = async (): Promise<void> => {
      if (create.disabled) return;
      const draft = { name: name.value, date: date.value, endDate: endDate.value, deadline: deadline.value,
        priority: priority.value, parent: parent.value, tags: tags.value, archived: archived.checked };
      create.disabled = cancel.disabled = true;
      try {
        if (this.options.initial) projectDraftProperties(draft, this.options.dateFormat, this.options.linkDates);
        else projectNoteContent(draft, this.options.dateFormat, this.options.linkDates);
        await this.options.createProject(draft);
        this.close();
      } catch (cause) {
        error.setText(cause instanceof Error ? cause.message : String(cause));
        create.disabled = cancel.disabled = false;
      }
    };
    create.addEventListener("click", () => { void submit(); });
    cancel.addEventListener("click", () => this.close());
    content.onkeydown = event => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.isComposing || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) void submit();
    };
    this.stopViewportTracking = trackModalViewport(this.modalEl, content);
    this.focusTimer = setTimeout(() => {
      const input = fields[this.options.focusProperty ?? "name"];
      input.focus();
      if ("select" in input && input.type !== "checkbox") input.select();
    }, 0);
  }
  onClose(): void {
    clearTimeout(this.focusTimer);
    this.stopViewportTracking?.();
    this.actions?.remove();
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }
}

/** Validate everything before creating a file; JSON values are valid YAML scalars/lists. */
export function projectNoteContent(draft: ProjectDraft, dateFormat: string, linkDates: boolean, reference = new Date()): string {
  if (draft.parent === projectNotePath(draft.name)) throw new Error("A project cannot be its own parent.");
  const frontmatter = projectDraftProperties(draft, dateFormat, linkDates, reference);
  return `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n`;
}

export function projectDraftProperties(draft: ProjectDraft, dateFormat: string, linkDates: boolean, reference = new Date()): Record<string, unknown> {
  projectNotePath(draft.name);
  const date = (value: string, label: string): string | null => {
    if (!value.trim()) return null;
    const text = value.trim().replace(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/, "$1");
    const parsed = parseDateExpression(text, reference, dateFormat);
    if (!parsed) throw new Error(`Could not understand the ${label}.`);
    const formatted = formatDate(parsed, dateFormat);
    return linkDates ? `[[${formatted}]]` : formatted;
  };
  if (draft.priority && !/^[123]$/.test(draft.priority)) throw new Error("Select a valid priority.");
  const tags = [...new Set(["project", ...draft.tags.split(/[,\s]+/).map(tag => tag.replace(/^#/, "")).filter(tag => Boolean(tag) && tag !== "archived")])];
  if (draft.archived && !tags.includes("archived")) tags.push("archived");
  return {
    tags, date: date(draft.date, "start date"), "end date": date(draft.endDate, "end date"),
    deadline: date(draft.deadline, "deadline"), priority: draft.priority ? Number(draft.priority) : null,
    parent: draft.parent ? `[[${draft.parent.replace(/\.md$/i, "")}]]` : null
  };
}

export function projectNotePath(name: string): string {
  const title = name.trim().replace(/\.md$/i, "");
  if (!title || title === "." || title === ".." || /[\\/:*?"<>|#^[\]\r\n]/.test(title)) {
    throw new Error("Enter a project name without path separators or special filename characters.");
  }
  return `${title}.md`;
}
