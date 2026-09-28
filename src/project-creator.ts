import { Modal, type App } from "obsidian";
import { formatDate, parseDateExpression } from "./date";
import { presentAsBottomSheet, trackModalViewport } from "./mobile-layout";
import { PROJECT_COLORS, projectColorName, projectColorValue } from "./project-properties";
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
  /** A colour name or hex; "" removes the property and undefined leaves it unchanged. */
  color?: string;
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
  private focusTimer?: number;
  private focusWindow: Window | null = null;
  private stopViewportTracking?: () => void;
  private stopBottomSheet?: () => void;
  constructor(app: App, private readonly options: ProjectCreatorOptions) { super(app); }
  onOpen(): void {
    this.stopBottomSheet = presentAsBottomSheet(this.modalEl, () => this.close());
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
    const colorRow = content.createDiv({ cls: "tm-editor-field" });
    const colorLabel = colorRow.createEl("label", { text: "Color" });
    let color = this.options.initial?.color;
    // New projects show None checked; an edit with an unreadable colour checks nothing and keeps it.
    const colorPicker = renderProjectColorPicker(colorRow, this.options.initial ? color : "", value => { color = value; });
    colorLabel.addEventListener("click", () => colorPicker.focus());
    const fields = { name, date, endDate, deadline, priority, parent, tags, archived, color: colorPicker };
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
        priority: priority.value, parent: parent.value, tags: tags.value, archived: archived.checked, color };
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
    const window = content.ownerDocument.defaultView;
    this.focusWindow = window;
    this.focusTimer = window?.setTimeout(() => {
      const input = fields[this.options.focusProperty ?? "name"];
      input.focus();
      if ("select" in input && input.type !== "checkbox") input.select();
    }, 0);
  }
  onClose(): void {
    const window = this.focusWindow;
    window?.clearTimeout(this.focusTimer);
    this.focusWindow = null;
    this.stopViewportTracking?.();
    this.stopBottomSheet?.();
    this.actions?.remove();
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }
}

const titleCase = (name: string): string => name[0].toUpperCase() + name.slice(1);

/** Swatches with radio-group semantics, plus a hex field; reports "" for None and invalid hex text as typed. */
export function renderProjectColorPicker(parent: HTMLElement, initial: string | undefined, change: (color: string) => void): { focus: () => void } {
  const container = parent.createDiv({ cls: "tm-project-color-field" });
  const group = container.createDiv({ cls: "tm-project-color-swatches", attr: { role: "radiogroup", "aria-label": "Project color" } });
  const swatches = ["", ...PROJECT_COLORS].map(name => {
    const label = name ? titleCase(name) : "None";
    const swatch = group.createEl("button", { cls: `tm-project-color-swatch${name ? "" : " is-none"}`, attr: { type: "button", role: "radio", "aria-label": label, title: label } });
    if (name) swatch.style.setProperty("--tm-project-color", projectColorValue(name)!);
    return { name, swatch };
  });
  const hex = container.createEl("input", { cls: "tm-project-color-hex", type: "text", attr: { "aria-label": "Custom color", placeholder: "#rrggbb", maxlength: "7", spellcheck: "false" } });
  const paint = (selected: string | undefined): void => {
    const index = swatches.findIndex(entry => entry.name === selected);
    swatches.forEach((entry, position) => {
      entry.swatch.setAttribute("aria-checked", String(position === index));
      // One tab stop: the checked swatch, else the first.
      entry.swatch.setAttribute("tabindex", position === Math.max(0, index) ? "0" : "-1");
    });
  };
  const select = (name: string): void => { hex.value = ""; paint(name); change(name); };
  const initialName = initial === undefined ? undefined : projectColorName(initial) ?? "";
  if (initialName?.startsWith("#")) hex.value = initialName;
  paint(initialName);
  swatches.forEach(({ name, swatch }, index) => {
    swatch.addEventListener("click", () => select(name));
    swatch.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const last = swatches.length - 1;
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;
      if (next === undefined) return;
      event.preventDefault();
      select(swatches[next].name);
      swatches[next].swatch.focus();
    });
  });
  hex.addEventListener("input", () => {
    const text = hex.value.trim();
    const name = projectColorName(text);
    paint(text ? (name ?? "#") : "");
    change(text ? (name ?? text) : "");
  });
  return { focus: () => (swatches.find(entry => entry.swatch.getAttribute("tabindex") === "0") ?? swatches[0]).swatch.focus() };
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
  const color = draft.color ? projectColorName(draft.color) : undefined;
  if (draft.color && !color) throw new Error("Enter a color as a hex value such as #3366ff.");
  const tags = [...new Set(["project", ...draft.tags.split(/[,\s]+/).map(tag => tag.replace(/^#/, "")).filter(tag => Boolean(tag) && tag !== "archived")])];
  if (draft.archived && !tags.includes("archived")) tags.push("archived");
  return {
    tags, date: date(draft.date, "start date"), "end date": date(draft.endDate, "end date"),
    deadline: date(draft.deadline, "deadline"), priority: draft.priority ? Number(draft.priority) : null,
    parent: draft.parent ? `[[${draft.parent.replace(/\.md$/i, "")}]]` : null,
    // No placeholder when unset: an empty colour means none.
    ...(color ? { color } : {})
  };
}

export function projectNotePath(name: string): string {
  const title = name.trim().replace(/\.md$/i, "");
  if (!title || title === "." || title === ".." || /[\\/:*?"<>|#^[\]\r\n]/.test(title)) {
    throw new Error("Enter a project name without path separators or special filename characters.");
  }
  return `${title}.md`;
}
