import { TaskModeController } from "./task-mode";
import type { TaskEditorPreset } from "./types";
import { noteTokenEditor } from "./note-token-editor";
import { noteTaskEditEditor, registerNoteTaskEdit } from "./note-task-edit";
import { renderNoteTokens } from "./note-token-reading";
import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { TaskEditorModal, type TaskEditorOptions } from "./task-editor";
import { TaskIndex } from "./task-index";
import { TaskNavigationView, TASK_NAV_VIEW } from "./navigation-view";
import { TaskStore } from "./task-store";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";
import { DEFAULT_SETTINGS, type Task, type TaskManagerSettings, type TaskViewMode, type TaskViewState } from "./types";
import { TaskManagerSettingTab } from "./settings";
import { addProjectProperties } from "./project-properties";
import { dailyNoteDateFormat } from "./daily-notes";

interface OpenEditorState extends TaskViewState {
  preset?: TaskEditorPreset;
  task?: Task;
}

export default class TaskManagerPlugin extends Plugin {
  settings: TaskManagerSettings = { ...DEFAULT_SETTINGS };
  index!: TaskIndex;
  store!: TaskStore;
  private taskModeController?: TaskModeController;
  private taskModeRibbon?: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TaskIndex(this.app, () => this.settings, () => this.dateFormat());
    this.store = new TaskStore(this.app, () => this.dateFormat(), () => this.settings.newTaskPosition);

    this.registerView(TASK_NAV_VIEW, (leaf) => new TaskNavigationView(leaf, this));
    this.registerView(TASK_MAIN_VIEW, (leaf) => new TaskMainView(leaf, this));
    this.registerEditorExtension(noteTokenEditor(() => this.dateFormat()));
    this.registerEditorExtension(noteTaskEditEditor(() => this.dateFormat(), task => this.openEditor({ mode: "all", task })));
    this.registerMarkdownPostProcessor((element, context) => {
      renderNoteTokens(element, this.dateFormat());
      registerNoteTaskEdit(element, context, () => this.dateFormat(), task => this.openEditor({ mode: "all", task }));
    });
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.addRibbonIcon("circle-check-big", "Open task manager", () => void this.activateNavigation().catch((error) => new Notice(String(error))));

    const commands: Array<[TaskViewMode, string, string]> = [
      ["inbox", "Open Inbox", "open-inbox"],
      ["today", "Open Today", "open-today"],
      ["upcoming", "Open Upcoming", "open-upcoming"],
      ["all", "Open All Tasks", "open-all-tasks"],
      ["projects", "Open Projects", "open-projects"]
    ];
    for (const [mode, name, id] of commands) {
      this.addCommand({ id, name, callback: () => void this.openTaskView({ mode }).catch((error) => new Notice(String(error))) });
    }
    for (const [scope, layouts] of [["task", ["list", "calendar", "kanban"]], ["projects", ["list", "gantt"]]] as const) {
      for (const layout of layouts) {
        this.addCommand({
          id: `switch-${scope}-view-${layout}`,
          name: `Switch ${scope} view to ${layout}`,
          checkCallback: (checking) => {
            const view = this.app.workspace.getActiveViewOfType(TaskMainView);
            if (!view) return false;
            const state = view.getState();
            const isProjects = state.mode === "projects" && !view.pagePath;
            if (isProjects !== (scope === "projects")) return false;
            if (!checking) {
              void view.setState({ ...state, [isProjects ? "projectLayout" : "layout"]: layout })
                .then(() => this.app.workspace.requestSaveLayout())
                .catch(error => new Notice(String(error)));
            }
            return true;
          }
        });
      }
    }
    this.addCommand({ id: "new-task", name: "Create new task", callback: () => this.openEditor({ mode: "inbox" }) });
    this.addRibbonIcon("plus", "Create new task", () => this.openEditor({ mode: "inbox" }));

    this.addCommand({ id: "toggle-task-mode", name: "Toggle task mode", callback: () => {
      void this.setTaskMode(!this.settings.taskMode).catch(error => new Notice(String(error)));
    } });
    this.taskModeRibbon = this.addRibbonIcon("list-checks", "Task mode", () => {
      void this.setTaskMode(!this.settings.taskMode).catch(error => new Notice(String(error)));
    });
    this.updateTaskModeControls();
    this.addCommand({
      id: "convert-to-project", name: "Convert to project",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(TaskMainView) ?? this.app.workspace.getActiveViewOfType(MarkdownView);
        const path = view instanceof TaskMainView ? view.pagePath : view instanceof MarkdownView ? view.file?.path : undefined;
        const file = path ? this.app.vault.getAbstractFileByPath(path) : undefined;
        if (!(file instanceof TFile) || file.extension !== "md") return false;
        if (!checking) void this.convertToProject(file);
        return true;
      }
    });

    await this.index.initialize();
    this.taskModeController = new TaskModeController(this.app, () => this.settings.taskMode, path => this.index.isProject(path));
    const syncTaskMode = (): void => { void this.taskModeController?.sync().catch(error => new Notice(String(error))); };
    this.registerEvent(this.app.workspace.on("file-open", syncTaskMode));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncTaskMode));
    this.registerEvent(this.app.workspace.on("layout-change", syncTaskMode));
    this.register(this.index.subscribe(syncTaskMode));
    this.app.workspace.onLayoutReady(() => {
      syncTaskMode();
      void this.activateNavigation(false).catch(error => new Notice(String(error)));
    });
  }

  onunload(): void {
    this.taskModeController?.dispose();
    this.index.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TaskManagerSettings> | null);
    this.settings.taskMode = this.settings.taskMode === true;
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
    if (reveal) await this.app.workspace.revealLeaf(leaf);
  }

  async openTaskView(state: TaskViewState): Promise<void> {
    await this.activateNavigation(false);
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW).find((candidate) => !candidate.view.getState().pagePath);
    const existingView = leaf?.view;
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: TASK_MAIN_VIEW, active: true, state: { ...state } });
    const currentView = leaf.view;
    if (currentView instanceof TaskMainView) await currentView.setState({ ...state });
    else if (existingView instanceof TaskMainView) await existingView.setState({ ...state });
    await this.app.workspace.revealLeaf(leaf);
    for (const navLeaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      const view = navLeaf.view;
      if (view instanceof TaskNavigationView) view.setActive(state.mode);
    }
  }

  async setTaskMode(enabled: boolean): Promise<void> {
    const previous = this.settings.taskMode;
    this.settings.taskMode = enabled;
    try { await this.saveSettings(); }
    catch (cause) { this.settings.taskMode = previous; throw cause; }
    this.updateTaskModeControls();
    await this.taskModeController?.sync();
  }

  private updateTaskModeControls(): void {
    const enabled = this.settings.taskMode;
    this.taskModeRibbon?.setAttribute("aria-label", `Task mode: ${enabled ? "On" : "Off"}`);
    this.taskModeRibbon?.setAttribute("title", `Task mode: ${enabled ? "On" : "Off"}`);
    this.taskModeRibbon?.setAttribute("aria-pressed", String(enabled));
    this.taskModeRibbon?.classList.toggle("is-active", enabled);
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (leaf.view instanceof TaskNavigationView) leaf.view.refresh();
    }
  }

  private async convertToProject(file: TFile): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, addProjectProperties);
      await this.index.refreshPath(file.path);
      new Notice(`Converted ${file.basename} to a project.`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not convert the note to a project.");
    }
  }

  openEditor(state: OpenEditorState): void {
    const options: TaskEditorOptions = {
      ...state,
      projectPath: state.pagePath ?? state.projectPath,
      projects: this.index.projects(),
      settings: this.settings,
      dateFormat: this.dateFormat(),
      onDelete: state.task ? async () => {
        await this.store.delete(state.task!);
        await this.index.refreshPath(state.task!.path);
      } : undefined,
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
