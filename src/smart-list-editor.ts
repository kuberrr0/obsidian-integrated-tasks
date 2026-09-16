import { Modal, type App } from "obsidian";
import { renderPropertyFilter } from "./filter-editor";
import { TASK_PROPERTIES } from "./task-properties";
import { trackModalViewport } from "./mobile-layout";
import type { SmartList, Task, TaskGrouping, TaskSort } from "./types";

export type SmartListDraft = Omit<SmartList, "id">;
export function smartListDraft(list?: SmartList): SmartListDraft {
  return list ? { name: list.name, filters: JSON.parse(JSON.stringify(list.filters)), sort: list.sort, descending: list.descending, grouping: list.grouping }
    : { name: "", filters: [], sort: "date", descending: false, grouping: "default" };
}
export class SmartListEditorModal extends Modal {
  private actions?: HTMLElement;
  private stopViewportTracking?: () => void;
  constructor(app: App, private readonly tasks: Task[], private readonly save: (draft: SmartListDraft) => Promise<void>, private readonly list?: SmartList) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("tm-editor-modal", "tm-smart-list-modal");
    const content = this.contentEl;
    content.empty();
    const draft = smartListDraft(this.list);
    content.createEl("h2", { text: this.list ? "Edit smart list" : "Create new smart list" });
    const field = (label: string, select = false): HTMLInputElement | HTMLSelectElement => {
      const row = content.createDiv({ cls: "tm-editor-field" });
      const caption = row.createEl("label", { text: label });
      const input = select ? row.createEl("select") : row.createEl("input", { type: "text" });
      input.setAttribute("aria-label", label);
      caption.addEventListener("click", () => input.focus());
      return input;
    };
    const name = field("List name"); name.value = draft.name;
    const sort = field("Sort by", true);
    for (const item of [{ key: "date", label: "Action date and time" }, ...TASK_PROPERTIES]) sort.createEl("option", { value: item.key, text: item.label });
    sort.value = draft.sort;
    const direction = field("Sort direction", true);
    direction.createEl("option", { value: "ascending", text: "Ascending" });
    direction.createEl("option", { value: "descending", text: "Descending" });
    direction.value = draft.descending ? "descending" : "ascending";
    const grouping = field("Group by", true);
    for (const item of [{ key: "default", label: "View default" }, { key: "none", label: "None" }, { key: "date", label: "Action date" }, ...TASK_PROPERTIES]) grouping.createEl("option", { value: item.key, text: item.label });
    grouping.value = draft.grouping;
    content.createEl("h3", { text: "Filters" });
    content.createDiv({ cls: "tm-filter-hint", text: "Match all properties. AND is evaluated before OR. Use Status to include completed tasks." });
    const filters = content.createDiv({ cls: "tm-smart-list-filters" });
    for (const property of TASK_PROPERTIES) {
      const row = filters.createDiv({ cls: "tm-property-submenu" });
      row.createSpan({ cls: "tm-property-name", text: property.label });
      const panel = row.createDiv({ cls: "tm-property-conditions" });
      renderPropertyFilter(panel, property, draft.filters.find(filter => filter.property === property.key), this.tasks, filter => {
        draft.filters = draft.filters.filter(item => item.property !== property.key);
        if (filter) draft.filters.push(filter);
      });
    }
    const error = content.createDiv({ cls: "tm-editor-error", attr: { role: "alert" } });
    this.actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    const cancel = this.actions.createEl("button", { text: "Cancel" });
    const save = this.actions.createEl("button", { text: "Save smart list", cls: "mod-cta" });
    const submit = async (): Promise<void> => {
      if (save.disabled) return;
      draft.name = name.value.trim();
      if (!draft.name) { error.setText("Enter a list name."); name.focus(); return; }
      draft.sort = sort.value as TaskSort; draft.descending = direction.value === "descending"; draft.grouping = grouping.value as TaskGrouping;
      save.disabled = cancel.disabled = true;
      try { await this.save(draft); this.close(); }
      catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); save.disabled = cancel.disabled = false; }
    };
    save.addEventListener("click", () => { void submit(); });
    cancel.addEventListener("click", () => this.close());
    content.onkeydown = event => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.isComposing || event.altKey) return;
      event.preventDefault(); if (!event.repeat) void submit();
    };
    this.stopViewportTracking = trackModalViewport(this.modalEl, content);
  }
  onClose(): void { this.stopViewportTracking?.(); this.actions?.remove(); this.contentEl.onkeydown = null; this.contentEl.empty(); }
}
