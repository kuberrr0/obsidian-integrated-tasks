import { noteTokenEditor } from "./note-token-editor";
import { renderNoteTokens } from "./note-token-reading";
import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { TaskEditorModal, type TaskEditorOptions } from "./task-editor";
import { TaskIndex } from "./task-index";
import { TaskNavigationView, TASK_NAV_VIEW } from "./navigation-view";
import { TaskStore } from "./task-store";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";
import { DEFAULT_SETTINGS, type Task, type TaskManagerSettings, type TaskViewMode, type TaskViewState } from "./types";
import { TaskManagerSettingTab } from "./settings";
import { dailyNoteDateFormat } from "./daily-notes";

interface OpenEditorState extends TaskViewState {
  task?: Task;
}

export default class TaskManagerPlugin extends Plugin {
  settings: TaskManagerSettings = DEFAULT_SETTINGS;
  index!: TaskIndex;
  store!: TaskStore;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TaskIndex(this.app, () => this.settings, () => this.dateFormat());
    this.store = new TaskStore(this.app, () => this.dateFormat());

    this.registerView(TASK_NAV_VIEW, (leaf) => new TaskNavigationView(leaf, this));
    this.registerView(TASK_MAIN_VIEW, (leaf) => new TaskMainView(leaf, this));
    this.registerEditorExtension(noteTokenEditor(() => this.dateFormat()));
    this.registerMarkdownPostProcessor((element) => renderNoteTokens(element, this.dateFormat()));
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.addRibbonIcon("circle-check-big", "Open Integrated Task Manager", () => void this.activateNavigation());

    const commands: Array<[TaskViewMode, string, string]> = [
      ["inbox", "Open Inbox", "open-inbox"],
      ["today", "Open Today", "open-today"],
      ["upcoming", "Open Upcoming", "open-upcoming"],
      ["all", "Open All Tasks", "open-all-tasks"],
      ["projects", "Open Projects", "open-projects"]
    ];
    for (const [mode, name, id] of commands) {
      this.addCommand({ id, name, callback: () => void this.openTaskView({ mode }) });
    }
    this.addCommand({ id: "new-task", name: "Create new task", callback: () => this.openEditor({ mode: "inbox" }) });

    await this.index.initialize();
    this.app.workspace.onLayoutReady(() => void this.activateNavigation(false));
  }

  onunload(): void {
    this.index.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TaskManagerSettings> | null);
    if (!this.settings.inboxPath.endsWith(".md")) this.settings.inboxPath = `${this.settings.inboxPath}.md`;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateNavigation(reveal = true): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false) ?? undefined;
      if (!leaf) return;
      await leaf.setViewState({ type: TASK_NAV_VIEW, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
  }

  async openTaskView(state: TaskViewState): Promise<void> {
    await this.activateNavigation(false);
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)[0];
    const existingView = leaf?.view;
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: TASK_MAIN_VIEW, active: true, state: { ...state } });
    const currentView = leaf.view;
    if (currentView instanceof TaskMainView) await currentView.setState({ ...state });
    else if (existingView instanceof TaskMainView) await existingView.setState({ ...state });
    this.app.workspace.revealLeaf(leaf);
    for (const navLeaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      const view = navLeaf.view;
      if (view instanceof TaskNavigationView) view.setActive(state.mode);
    }
  }

  openEditor(state: OpenEditorState): void {
    const options: TaskEditorOptions = {
      ...state,
      projects: this.index.projects(),
      settings: this.settings,
      dateFormat: this.dateFormat(),
      onSave: async (draft) => {
        try {
          if (state.task) await this.store.update(state.task, draft);
          else await this.store.create(draft);
          await this.index.refreshPath(draft.destination);
          if (state.task && state.task.path !== draft.destination) await this.index.refreshPath(state.task.path);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Could not save the task.";
          new Notice(message);
          throw cause;
        }
      }
    };
    new TaskEditorModal(this.app, options).open();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskMainView) view.render();
    }
  }

  dateFormat(): string {
    return dailyNoteDateFormat(this.app);
  }
}
