import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { TaskViewMode } from "./types";

export const TASK_NAV_VIEW = "task-manager-navigation";

const NAV_ITEMS: Array<{ mode: TaskViewMode; label: string; icon: string }> = [
  { mode: "inbox", label: "Inbox", icon: "inbox" },
  { mode: "today", label: "Today", icon: "calendar-days" },
  { mode: "upcoming", label: "Upcoming", icon: "calendar-clock" },
  { mode: "all", label: "All Tasks", icon: "list-checks" },
  { mode: "projects", label: "Projects", icon: "folder-kanban" }
];

export class TaskNavigationView extends ItemView {
  private activeMode: TaskViewMode = "today";
  constructor(leaf: WorkspaceLeaf, private readonly plugin: TaskManagerPlugin) {
    super(leaf);
  }

  getViewType(): string { return TASK_NAV_VIEW; }
  getDisplayText(): string { return "Tasks"; }
  getIcon(): string { return "circle-check-big"; }

  async onOpen(): Promise<void> {
    this.render();
  }

  setActive(mode: TaskViewMode): void {
    this.activeMode = mode;
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tm-navigation");
    const header = container.createDiv({ cls: "tm-nav-header" });
    header.createEl("h3", { text: "Tasks" });
    const newButton = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "New task" } });
    setIcon(newButton, "plus");
    newButton.addEventListener("click", () => this.plugin.openEditor({ mode: this.activeMode }));

    const nav = container.createDiv({ cls: "tm-nav-list" });
    for (const item of NAV_ITEMS) {
      const button = nav.createEl("button", {
        cls: `tm-nav-item${item.mode === this.activeMode ? " is-active" : ""}`,
        attr: { "aria-current": item.mode === this.activeMode ? "page" : "false" }
      });
      const icon = button.createSpan({ cls: "tm-nav-icon" });
      setIcon(icon, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener("click", () => void this.plugin.openTaskView({ mode: item.mode }));
    }
  }
}
