import { Modal, Notice, TFile, type App } from "obsidian";
import type TaskManagerPlugin from "./main";
import { convertTasksNote, skipLabel, type TasksImportOptions, type TasksImportSkip } from "./tasks-import";

type ImportHost = Pick<TaskManagerPlugin, "store" | "index" | "settings" | "dateFormat">;

const EXAMPLES = 5;

/** The Tasks plugin's global filter (such as `#task`), if its settings can be read. */
export async function tasksPluginGlobalFilter(app: App): Promise<string | undefined> {
  try {
    const data: unknown = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/obsidian-tasks-plugin/data.json`));
    const filter = data && typeof data === "object" && "globalFilter" in data ? data.globalFilter : undefined;
    return typeof filter === "string" && filter.trim() ? filter.trim() : undefined;
  } catch { return undefined; }
}

/** Preview, then convert notes written for the Tasks plugin; the whole import can be undone. */
export class TasksImportModal extends Modal {
  private readonly options: Omit<TasksImportOptions, "dateFormat" | "linkDates"> = { convertTags: true, dropCreatedDates: true };
  private noteScope: "all" | "current" = "all";
  private changed: TFile[] = [];
  private converted = 0;
  private generation = 0;
  private summary!: HTMLElement;
  private convertButton!: HTMLButtonElement;

  constructor(app: App, private readonly plugin: ImportHost, private readonly currentFile?: TFile) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("tm-import-modal");
    this.titleEl.setText("Import from the Tasks plugin");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: "Convert tasks written for the Tasks plugin, with emoji such as 📅 and ⏳ or fields such as [due:: …], into this plugin's format. You can undo the import afterwards." });

    const scope = contentEl.createEl("fieldset", { cls: "tm-import-scope" });
    scope.createEl("legend", { text: "Notes to convert" });
    const choice = (value: "all" | "current", label: string): void => {
      const row = scope.createEl("label");
      const input = row.createEl("input", { type: "radio", attr: { name: "tm-import-scope", value } });
      input.checked = this.noteScope === value;
      row.appendText(` ${label}`);
      input.addEventListener("change", () => { if (input.checked) { this.noteScope = value; void this.preview(); } });
    };
    choice("all", "All notes");
    if (this.currentFile) choice("current", `Current note (${this.currentFile.basename})`);

    const option = (label: string, key: "convertTags" | "dropCreatedDates", hint: string): void => {
      const row = contentEl.createEl("label", { cls: "tm-import-option" });
      const input = row.createEl("input", { type: "checkbox" });
      input.checked = this.options[key];
      row.appendText(` ${label}`);
      row.createDiv({ cls: "setting-item-description", text: hint });
      input.addEventListener("change", () => { this.options[key] = input.checked; void this.preview(); });
    };
    option("Convert #tags", "convertTags", "Make #tags on tasks this plugin's task tags, moved to the end of each task and written in the Tag format.");
    option("Remove created dates (➕)", "dropCreatedDates", "This plugin doesn't use created dates. Turn this off to keep them as text.");

    const filterRow = contentEl.createEl("label", { cls: "tm-import-option" });
    filterRow.appendText("Global filter to remove ");
    const filter = filterRow.createEl("input", { type: "text", attr: { placeholder: "#task", "aria-label": "Global filter to remove" } });
    filterRow.createDiv({ cls: "setting-item-description", text: "If you used a Tasks global filter, such as #task, it is removed from converted tasks." });
    filter.addEventListener("change", () => { this.options.globalFilter = filter.value.trim() || undefined; void this.preview(); });

    this.summary = contentEl.createDiv({ cls: "tm-import-summary", attr: { "aria-live": "polite" } });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    this.convertButton = buttons.createEl("button", { cls: "mod-cta", text: "Convert" });
    this.convertButton.addEventListener("click", () => void this.convert());

    void tasksPluginGlobalFilter(this.app).then(found => {
      if (found && !filter.value) { filter.value = found; this.options.globalFilter = found; }
      return this.preview();
    });
  }

  onClose(): void {
    this.generation++;
    this.contentEl.empty();
  }

  private files(): TFile[] {
    return this.noteScope === "current" && this.currentFile ? [this.currentFile] : this.app.vault.getMarkdownFiles();
  }

  private importOptions(): TasksImportOptions {
    return { ...this.options, dateFormat: this.plugin.dateFormat(), linkDates: this.plugin.settings.linkDates };
  }

  private async preview(): Promise<void> {
    const generation = ++this.generation;
    this.convertButton.disabled = true;
    this.summary.setText("Looking for Tasks plugin tasks…");
    const options = this.importOptions();
    const changed: TFile[] = [];
    const skips = new Map<TasksImportSkip, number>();
    const examples: Array<{ before: string; after: string }> = [];
    let converted = 0;
    for (const file of this.files()) {
      const result = convertTasksNote(await this.app.vault.cachedRead(file), options, EXAMPLES - examples.length);
      // A newer preview (the options changed) replaces this one.
      if (generation !== this.generation) return;
      for (const [skip, count] of result.skips) skips.set(skip, (skips.get(skip) ?? 0) + count);
      if (!result.converted) continue;
      changed.push(file);
      converted += result.converted;
      examples.push(...result.examples);
    }
    this.changed = changed;
    this.converted = converted;
    this.summary.empty();
    this.summary.createEl("p", { cls: "tm-import-count", text: converted
      ? `${converted} ${converted === 1 ? "task" : "tasks"} in ${changed.length} ${changed.length === 1 ? "note" : "notes"} will be converted.`
      : "No Tasks plugin tasks to convert." });
    if (examples.length) {
      const list = this.summary.createEl("ul", { cls: "tm-import-examples", attr: { "aria-label": "Examples" } });
      for (const { before, after } of examples) {
        const item = list.createEl("li");
        item.createEl("code", { text: before.trim() });
        item.createSpan({ text: " → ", attr: { "aria-label": "becomes" } });
        item.createEl("code", { text: after.trim() });
      }
    }
    for (const [skip, count] of skips) this.summary.createEl("p", { cls: "tm-import-skip", text: skipLabel(skip, count) });
    this.convertButton.setText(converted ? `Convert ${converted} ${converted === 1 ? "task" : "tasks"}` : "Convert");
    this.convertButton.disabled = !converted;
  }

  private async convert(): Promise<void> {
    if (!this.changed.length) return;
    this.convertButton.disabled = true;
    const options = this.importOptions();
    const count = this.converted;
    try {
      const paths = await this.plugin.store.rewriteNotes(this.changed, content => convertTasksNote(content, options).content,
        `Imported ${count} ${count === 1 ? "task" : "tasks"} from the Tasks plugin`);
      for (const path of paths) await this.plugin.index.refreshPath(path);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not import the tasks.");
      this.convertButton.disabled = false;
    }
  }
}
