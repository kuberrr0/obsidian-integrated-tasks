import { FuzzySuggestModal, Notice, renderResults, setIcon, type App, type FuzzyMatch } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { Task, TaskViewMode } from "./types";
import { projectStatuses, type ProjectStatus } from "./project-progress";

/** Fuzzy matching every open task on each keystroke is too slow in very large vaults. */
export const SWITCHER_TASK_LIMIT = 5000;

export type SwitcherItem =
  | { kind: "view"; label: string; icon: string; mode: TaskViewMode }
  | { kind: "project"; label: string; path: string; status: ProjectStatus }
  | { kind: "tag"; label: string; name: string }
  | { kind: "smartList"; label: string; id: string }
  | { kind: "task"; label: string; task: Task; note: string };

type SwitcherHost = Pick<TaskManagerPlugin, "index" | "settings" | "openTaskView" | "openProject" | "openTag" | "openEditor">;

const VIEWS: Array<[TaskViewMode, string, string]> = [
  ["dashboard", "Task dashboard", "layout-dashboard"], ["inbox", "Inbox", "inbox"], ["today", "Today", "calendar-check"],
  ["upcoming", "Upcoming", "calendar-days"], ["all", "All tasks", "list-checks"], ["projects", "Projects", "target"],
  ["tags", "Tags", "tags"], ["smartLists", "Smart lists", "list-filter"], ["review", "Weekly review", "clipboard-check"]
];

const noteName = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Views, projects, tags and smart lists come first; tasks follow in action-date order. */
export function switcherItems(plugin: SwitcherHost, taskLimit = SWITCHER_TASK_LIMIT): SwitcherItem[] {
  const items: SwitcherItem[] = VIEWS.map(([mode, label, icon]) => ({ kind: "view", label, icon, mode }));
  const projects = plugin.index.projects();
  const statuses = projectStatuses(projects);
  for (const status of ["active", "completed", "archived"] as const) {
    for (const project of projects) if (statuses.get(project.path) === status) items.push({ kind: "project", label: project.name, path: project.path, status });
  }
  for (const tag of plugin.index.tagSummaries()) items.push({ kind: "tag", label: tag.name, name: tag.name });
  for (const list of plugin.settings.smartLists) items.push({ kind: "smartList", label: list.name, id: list.id });
  for (const task of plugin.index.query({ mode: "all", showCompleted: false }).slice(0, taskLimit)) {
    items.push({ kind: "task", label: task.title, task, note: noteName(task.path) });
  }
  return items;
}

const ICONS: Record<Exclude<SwitcherItem["kind"], "view">, string> = { project: "target", tag: "hash", smartList: "list-filter", task: "circle" };

function kindLabel(item: SwitcherItem): string {
  if (item.kind === "project") return { active: "Project", completed: "Completed project", archived: "Archived project" }[item.status];
  return { view: "View", tag: "Tag", smartList: "Smart list", task: "Task" }[item.kind];
}

export class TaskQuickSwitcher extends FuzzySuggestModal<SwitcherItem> {
  private items?: SwitcherItem[];

  constructor(app: App, private readonly plugin: SwitcherHost) {
    super(app);
    this.setPlaceholder("Jump to a view, project, tag, smart list, or task…");
    this.limit = 200;
  }

  // Built once per opening: the modal asks for items on every keystroke.
  getItems(): SwitcherItem[] {
    return this.items ??= switcherItems(this.plugin);
  }

  getItemText(item: SwitcherItem): string {
    return item.label;
  }

  getSuggestions(query: string): FuzzyMatch<SwitcherItem>[] {
    if (query.trim()) return super.getSuggestions(query);
    return this.getItems().slice(0, this.limit).map(item => ({ item, match: { score: 0, matches: [] } }));
  }

  renderSuggestion(result: FuzzyMatch<SwitcherItem>, el: HTMLElement): void {
    const { item } = result;
    el.addClass("mod-complex", "tm-switcher-item");
    const icon = el.createDiv({ cls: "suggestion-icon" }).createSpan({ cls: "suggestion-flair" });
    setIcon(icon, item.kind === "view" ? item.icon : ICONS[item.kind]);
    const content = el.createDiv({ cls: "suggestion-content" });
    renderResults(content.createDiv({ cls: "suggestion-title" }), item.label, result.match);
    if (item.kind === "task") content.createDiv({ cls: "suggestion-note", text: item.note });
    el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair", text: kindLabel(item) });
  }

  onChooseItem(item: SwitcherItem): void {
    const plugin = this.plugin;
    if (item.kind === "task") { plugin.openEditor({ mode: "all", task: item.task }); return; }
    const opened = item.kind === "view" ? plugin.openTaskView({ mode: item.mode })
      : item.kind === "project" ? plugin.openProject(item.path)
      : item.kind === "tag" ? plugin.openTag(item.name)
      : plugin.openTaskView({ mode: "smartLists", smartListId: item.id });
    void opened.catch(error => new Notice(String(error)));
  }
}
