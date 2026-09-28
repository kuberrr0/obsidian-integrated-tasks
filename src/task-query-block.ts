import { MarkdownRenderChild, Notice, TFile } from "obsidian";
import type TaskManagerPlugin from "./main";
import { formatDate } from "./date";
import { groupTasks, orderTaskTree, sortTasks } from "./query";
import { parseTaskQuery, QUERY_KEYS } from "./task-query";
import { renderTaskDetails } from "./task-row-details";
import { taskTitleLabel } from "./task-title";
import { checkboxLabel, statusClass } from "./task-status";
import type { Task } from "./types";

type QueryHost = Pick<TaskManagerPlugin, "app" | "index" | "store" | "settings" | "dateFormat" | "openEditor" | "openTaskView">;

export const TASK_QUERY_LANGUAGE = "task-query";
export const TASK_QUERY_TEMPLATE = "```task-query\nview: today\n```\n";

/** A live, checkable task list rendered from a ```task-query block, in Reading view and Live Preview. */
export class TaskQueryBlock extends MarkdownRenderChild {
  private frame?: number;

  constructor(containerEl: HTMLElement, private readonly source: string, private readonly sourcePath: string, private readonly plugin: QueryHost) {
    super(containerEl);
  }

  onload(): void {
    // In Live Preview a click would otherwise move the caret into the block's source.
    for (const type of ["mousedown", "pointerdown", "click"]) {
      this.containerEl.addEventListener(type, event => {
        if ((event.target as HTMLElement).closest("button, input, a, [role=button]")) event.stopPropagation();
      });
    }
    this.render();
    this.register(this.plugin.index.subscribe(() => this.schedule()));
  }

  onunload(): void {
    if (this.frame !== undefined) this.containerEl.win.cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    if (this.frame !== undefined) return;
    this.frame = this.containerEl.win.requestAnimationFrame(() => { this.frame = undefined; this.render(); });
  }

  render(): void {
    const root = this.containerEl;
    root.empty();
    root.addClass("tm-query-block");
    const parsed = parseTaskQuery(this.source, {
      sourcePath: this.sourcePath, dateFormat: this.plugin.dateFormat(), smartLists: this.plugin.settings.smartLists,
      resolveNote: name => this.plugin.app.metadataCache.getFirstLinkpathDest(name, this.sourcePath)?.path
    });
    if (parsed.errors.length) {
      const box = root.createDiv({ cls: "tm-query-error", attr: { role: "alert" } });
      box.createEl("strong", { text: "This task query has a problem" });
      const list = box.createEl("ul");
      for (const error of parsed.errors) list.createEl("li", { text: error });
      box.createDiv({ cls: "tm-query-help", text: `Options: ${QUERY_KEYS.join(", ")}.` });
      return;
    }
    const tasks = sortTasks(this.plugin.index.query(parsed.query), parsed.sort, parsed.descending);
    if (parsed.title) {
      const header = root.createDiv({ cls: "tm-query-title" });
      header.createSpan({ text: parsed.title });
      header.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
    }
    if (!tasks.length) { root.createDiv({ cls: "tm-query-empty", text: "No matching tasks." }); return; }

    let remaining = parsed.limit;
    const groups = parsed.grouping === "none" || parsed.grouping === "default" ? new Map([["", tasks]]) : groupTasks(tasks, parsed.grouping);
    for (const [key, group] of groups) {
      if (remaining <= 0) break;
      if (key) {
        const heading = /^\d{4}-\d{2}-\d{2}$/.test(key) ? formatDate(key, this.plugin.dateFormat()) : parsed.grouping === "source" ? key.replace(/\.md$/i, "").split("/").pop()! : key;
        root.createDiv({ cls: "tm-query-group", text: heading });
      }
      const list = root.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
      const visible = new Set(group.map(task => task.id));
      for (const task of orderTaskTree(group).slice(0, remaining)) this.renderRow(list, task, this.depth(task, visible), parsed.grouping);
      remaining -= Math.min(group.length, remaining);
    }
    const shown = parsed.limit - Math.max(0, remaining);
    if (shown < tasks.length) {
      const footer = root.createDiv({ cls: "tm-query-footer" });
      footer.createSpan({ text: `Showing ${shown} of ${tasks.length} tasks.` });
      const opens = parsed.opens;
      if (opens) footer.createEl("button", { text: "Show all" }).addEventListener("click", () => {
        void this.plugin.openTaskView(opens as Parameters<QueryHost["openTaskView"]>[0]).catch(error => new Notice(String(error)));
      });
    }
  }

  private depth(task: Task, visible: Set<string>): number {
    let depth = 0;
    for (let parent = task.parentId; parent && visible.has(parent); parent = this.plugin.index.taskById(parent)?.parentId) depth++;
    return depth;
  }

  private renderRow(list: HTMLElement, task: Task, depth: number, grouping: Parameters<typeof renderTaskDetails>[3]["grouping"]): void {
    const row = list.createDiv({ cls: `tm-task-row tm-query-row${task.completed ? " is-completed" : ""}${task.status === "cancelled" ? " is-cancelled" : ""}`, attr: { role: "listitem", "data-task-id": task.id } });
    row.style.setProperty("--tm-depth", String(depth));
    const color = this.plugin.index.projectColor(task.path);
    if (color) row.style.setProperty("--tm-project-color", color);
    const checkbox = row.createEl("label", { cls: "tm-checkbox-target" }).createEl("input", {
      type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel({ ...task, priority: undefined }) }
    });
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => {
      void this.plugin.store.toggle(task, checkbox.checked).catch((error: unknown) => {
        checkbox.checked = !checkbox.checked;
        new Notice(error instanceof Error ? error.message : "Could not update the task.");
      });
    });
    const content = row.createDiv({ cls: "tm-task-content" });
    const primary = content.createDiv({ cls: "tm-task-primary" });
    primary.createEl("button", { cls: "tm-task-title", text: taskTitleLabel(task.title), attr: { title: taskTitleLabel(task.title) } })
      .addEventListener("click", () => this.plugin.openEditor({ mode: "all", task }));
    const metadata = content.createDiv({ cls: "tm-task-metadata" });
    renderTaskDetails(primary, metadata, task, {
      grouping: grouping === "default" ? "none" : grouping, dateFormat: this.plugin.dateFormat(),
      source: task.path !== this.sourcePath ? task.path : undefined, tags: task.tags ?? [],
      edit: focusProperty => this.plugin.openEditor({ mode: "all", task, focusProperty }),
      openSource: () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) void this.plugin.app.workspace.getLeaf("tab").openFile(file, { eState: { line: task.line } });
      }
    });
    if (!metadata.childElementCount) metadata.remove();
  }
}
