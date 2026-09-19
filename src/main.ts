import { recurringFile, type RecurringOutcome } from "./recurring-task";
import type { CalendarScope } from "./calendar";
import { scanTasks } from "./parser";
import { applyProjectDraft, projectEditDraft } from "./project-editor";
import { cloneTaskFilters } from "./task-filters";
import { SmartListEditorModal, type SmartListDraft } from "./smart-list-editor";
import { ProjectCreatorModal, projectNotePath, projectNoteContent, type ProjectDraft } from "./project-creator";
import { BulkTaskEditorModal } from "./bulk-task-editor";
import { TaskModeController } from "./task-mode";
import type { TaskEditorPreset } from "./types";
import { noteDateInput } from "./note-date-input";
import { noteTokenEditor } from "./note-token-editor";
import { noteTaskEditEditor, registerNoteTaskEdit } from "./note-task-edit";
import { renderNoteTokens } from "./note-token-reading";
import { MarkdownView, Notice, Plugin, TFile, type Editor, type WorkspaceLeaf } from "obsidian";
import { TaskEditorModal, type TaskEditorOptions } from "./task-editor";
import { TaskIndex } from "./task-index";
import { TaskNavigationView, TASK_NAV_VIEW } from "./navigation-view";
import { TaskStore } from "./task-store";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";
import { DEFAULT_SETTINGS, type SmartList, type Task, type TaskManagerSettings, type TaskViewMode, type TaskViewState } from "./types";
import { TaskManagerSettingTab } from "./settings";
import { addProjectProperties } from "./project-properties";
import { dailyNoteDateFormat } from "./daily-notes";

interface OpenEditorState extends TaskViewState {
  focusProperty?: TaskEditorOptions["focusProperty"];
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
    this.store = new TaskStore(this.app, () => this.dateFormat(), () => this.settings.newTaskPosition, () => this.settings.linkDates, () => this.settings.sectionHeadingLevel);

    this.registerView(TASK_NAV_VIEW, (leaf) => new TaskNavigationView(leaf, this));
    this.registerView(TASK_MAIN_VIEW, (leaf) => new TaskMainView(leaf, this));
    this.registerEditorExtension(noteDateInput(() => this.dateFormat(), () => this.settings.taskMode, () => this.settings.linkDates));
    this.registerEditorExtension(noteTokenEditor(() => this.dateFormat()));
    this.registerEditorExtension(noteTaskEditEditor(() => this.dateFormat(), task => this.openEditor({ mode: "all", task }), () => this.settings.sectionHeadingLevel));
    this.registerMarkdownPostProcessor((element, context) => {
      renderNoteTokens(element, this.dateFormat());
      registerNoteTaskEdit(element, context, () => this.dateFormat(), task => this.openEditor({ mode: "all", task }), () => this.settings.sectionHeadingLevel);
    });
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.addRibbonIcon("circle-check-big", "Open task manager", () => void this.activateNavigation().catch((error) => new Notice(String(error))));

    const commands: Array<[TaskViewMode, string, string]> = [
      ["dashboard", "Open Task Dashboard", "open-task-dashboard"],
      ["inbox", "Open Inbox", "open-inbox"],
      ["today", "Open Today", "open-today"],
      ["upcoming", "Open Upcoming", "open-upcoming"],
      ["all", "Open All Tasks", "open-all-tasks"],
      ["projects", "Open Projects", "open-projects"],
      ["tags", "Open Tags", "open-tags"]
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
            if (state.mode === "dashboard") return false;
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
    for (const scope of ["day", "week", "month", "year"] as const) {
      this.addCommand({
        id: `switch-calendar-to-${scope}`,
        name: `Switch calendar to ${scope}`,
        checkCallback: checking => this.switchCalendarScope(scope, checking)
      });
    }
    this.addCommand({ id: "create-new-smart-list", name: "Create new smart list", callback: () => this.openSmartListEditor() });
    this.addCommand({ id: "edit-smart-list", name: "Edit smart list", checkCallback: checking => {
      const list = this.activeSmartList();
      if (!list) return false;
      if (!checking) this.openSmartListEditor(list);
      return true;
    } });
    this.addCommand({ id: "delete-smart-list", name: "Delete smart list", checkCallback: checking => {
      const list = this.activeSmartList();
      if (!list) return false;
      if (!checking) void this.deleteSmartList(list.id).catch(error => new Notice(String(error)));
      return true;
    } });
    this.addCommand({ id: "edit-project", name: "Edit project", checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(TaskMainView) ?? this.app.workspace.getActiveViewOfType(MarkdownView);
      const path = view instanceof TaskMainView ? view.pagePath : view instanceof MarkdownView ? view.file?.path : undefined;
      if (!path || !this.index.isProject(path)) return false;
      if (!checking) this.openProjectEditor(path);
      return true;
    } });
    for (const [action, outcome] of [["complete", "COMPLETED"], ["skip", "SKIPPED"], ["fail", "FAILED"]] as const) {
      this.addCommand({ id: `${action}-recurring-task`, name: `${action[0].toUpperCase()}${action.slice(1)} recurring task`,
        checkCallback: checking => this.recurringTaskCommand(checking, outcome) });
    }
    this.addCommand({ id: "edit-task", name: "Edit task", editorCheckCallback: (checking, editor, view) =>
      this.editCurrentLineTask(checking, editor, view.file) });
    this.addCommand({ id: "edit-task-properties", name: "Edit task properties", checkCallback: checking => this.editSelectedTaskProperties(checking) });
    this.addCommand({ id: "search-task-in-list", name: "Search task in list", checkCallback: checking => this.focusProjectSearch(checking) });
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
    this.taskModeController = new TaskModeController(this.app, () => this.settings.taskMode, path => this.index.isProject(path), path => this.index.tagForPath(path));
    const syncTaskMode = (): void => { void this.taskModeController?.sync().catch(error => new Notice(String(error))); };
    this.registerEvent(this.app.workspace.on("file-open", syncTaskMode));
    this.registerEvent(this.app.metadataCache.on("resolved", syncTaskMode));
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
    const saved = await this.loadData() as (Partial<TaskManagerSettings> & { taskListRowHeight?: number }) | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (saved?.taskListRowHeightMultiplier === undefined && typeof saved?.taskListRowHeight === "number" && Number.isFinite(saved.taskListRowHeight)) {
      const editorFontSize = typeof document === "undefined" ? 16 : parseFloat(getComputedStyle(document.body).getPropertyValue("--font-text-size")) || 16;
      this.settings.taskListRowHeightMultiplier = Math.max(1, saved.taskListRowHeight / editorFontSize);
    }
    this.settings.smartLists = Array.isArray(this.settings.smartLists) ? this.settings.smartLists : [];
    this.settings.taskMode = this.settings.taskMode === true;
    if (!Number.isInteger(this.settings.sectionHeadingLevel) || this.settings.sectionHeadingLevel < 1 || this.settings.sectionHeadingLevel > 6) this.settings.sectionHeadingLevel = 1;
    this.settings.showGroupTaskCounts = this.settings.showGroupTaskCounts === true;
    this.settings.showSubtaskCounts = this.settings.showSubtaskCounts === true;
    if (!["none", "title", "background", "all"].includes(this.settings.taskHoverHighlight)) this.settings.taskHoverHighlight = DEFAULT_SETTINGS.taskHoverHighlight;
    if (!Number.isFinite(this.settings.taskListRowHeightMultiplier) || this.settings.taskListRowHeightMultiplier < 1) this.settings.taskListRowHeightMultiplier = DEFAULT_SETTINGS.taskListRowHeightMultiplier;
    for (const key of ["hiddenListTaskProperties", "hiddenKanbanTaskProperties"] as const) {
      const hidden = this.settings[key];
      this.settings[key] = Array.isArray(hidden) ? hidden.filter(property =>
        ["source", "scheduledDate", "scheduledTime", "deadline", "deadlineTime", "duration", "priority", "tags"].includes(property)) : [];
    }
    this.settings.wrapTaskTitles = this.settings.wrapTaskTitles !== false;
    this.settings.wrapCalendarTaskTitles = this.settings.wrapCalendarTaskTitles === true;
    this.settings.wrapKanbanTaskTitles = this.settings.wrapKanbanTaskTitles !== false;
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
    if (state.projectPath && !state.pagePath) return this.openProject(state.projectPath);
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
      if (view instanceof TaskNavigationView) view.setActive(state.mode, state.tag, undefined, state.smartListId);
    }
  }

  private activeSmartList(): SmartList | undefined {
    const state = this.app.workspace.getActiveViewOfType(TaskMainView)?.getState();
    return state?.mode === "smartLists" ? this.settings.smartLists.find(list => list.id === state.smartListId) : undefined;
  }

  openSmartListEditor(list?: SmartList): void {
    new SmartListEditorModal(this.app, this.index.allTasks(), async draft => {
      const saved = await this.saveSmartList(draft, list?.id);
      await this.openTaskView({ mode: "smartLists", smartListId: saved.id });
    }, list).open();
  }

  async saveSmartList(draft: SmartListDraft, id?: string): Promise<SmartList> {
    const name = draft.name.trim();
    if (!name) throw new Error("Enter a list name.");
    if (id && !this.settings.smartLists.some(list => list.id === id)) throw new Error("This smart list no longer exists.");
    const saved: SmartList = { ...draft, name, filters: cloneTaskFilters(draft.filters), id: id ?? crypto.randomUUID() };
    const previous = this.settings.smartLists;
    this.settings.smartLists = id ? previous.map(list => list.id === id ? saved : list) : [...previous, saved];
    try { await this.saveSettings(); }
    catch (cause) { this.settings.smartLists = previous; throw cause; }
    this.refreshSmartLists();
    return saved;
  }

  async deleteSmartList(id: string): Promise<void> {
    const previous = this.settings.smartLists;
    this.settings.smartLists = previous.filter(list => list.id !== id);
    try { await this.saveSettings(); }
    catch (cause) { this.settings.smartLists = previous; throw cause; }
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      if (leaf.view.getState().smartListId === id) await leaf.setViewState({ type: TASK_MAIN_VIEW, state: { mode: "smartLists" } });
    }
    this.refreshSmartLists();
  }

  private refreshSmartLists(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (leaf.view instanceof TaskNavigationView) leaf.view.refresh();
    }
    this.refreshViews();
  }

  openProjectCreator(): void {
    new ProjectCreatorModal(this.app, {
      projects: this.index.projects(), dateFormat: this.dateFormat(), linkDates: this.settings.linkDates,
      createProject: async draft => {
        const path = projectNotePath(draft.name);
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error("A note with this name already exists.");
        await this.app.vault.create(path, projectNoteContent(draft, this.dateFormat(), this.settings.linkDates));
        await this.index.refreshPath(path);
        await this.openProject(path);
      }
    }).open();
  }

  openProjectEditor(path: string, focusProperty?: keyof ProjectDraft): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    const project = this.index.projects().find(project => project.path === path);
    if (!(file instanceof TFile) || !project) { new Notice("Project note no longer exists."); return; }
    const initial = projectEditDraft(project, this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
    const projects = this.index.projects().filter(project => project.path !== path);
    if (initial.parent && !projects.some(project => project.path === initial.parent)) {
      projects.push({ path: initial.parent, name: initial.parent, openTasks: 0, completedTasks: 0, archived: false });
    }
    new ProjectCreatorModal(this.app, {
      projects, dateFormat: this.dateFormat(), linkDates: this.settings.linkDates, initial, focusProperty,
      createProject: async draft => {
        const basename = projectNotePath(draft.name);
        const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
        const destination = folder + basename;
        const existing = this.app.vault.getAbstractFileByPath(destination);
        if (existing && existing !== file) throw new Error("A note with this name already exists.");
        if (draft.parent === file.path || draft.parent === destination) throw new Error("A project cannot be its own parent.");
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) =>
          applyProjectDraft(frontmatter, draft, this.dateFormat(), this.settings.linkDates));
        if (destination !== file.path) await this.app.fileManager.renameFile(file, destination);
        await this.index.refreshPath(file.path);
        await this.openProject(file.path);
      }
    }).open();
  }

  async openProject(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Project note no longer exists.");
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (!this.settings.taskMode) await this.setTaskMode(true);
    else await this.taskModeController?.sync();
    await this.app.workspace.revealLeaf(leaf);
    for (const navLeaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (navLeaf.view instanceof TaskNavigationView) navLeaf.view.setActive("projects", undefined, path);
    }
  }

  async openTag(tag: string): Promise<void> {
    const file = this.index.tagFile(tag);
    if (!file) return this.openTaskView({ mode: "tags", tag });
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (!this.settings.taskMode) await this.setTaskMode(true);
    else await this.taskModeController?.sync();
    await this.app.workspace.revealLeaf(leaf);
    for (const navLeaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (navLeaf.view instanceof TaskNavigationView) navLeaf.view.setActive("tags", tag);
    }
  }

  private recurringTaskCommand(checking: boolean, outcome: RecurringOutcome): boolean {
    const view = this.app.workspace.getActiveViewOfType(TaskMainView);
    const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    let task: Task | undefined;
    if (this.settings.taskMode) {
      const selected = view?.getSelectedTasks() ?? [];
      if (selected.length === 1) task = selected[0];
    } else if (markdown?.file) {
      task = scanTasks(markdown.file.path, markdown.editor.getValue(), new Date(), this.dateFormat(), this.settings.sectionHeadingLevel)
        .find(candidate => candidate.line === markdown.editor.getCursor().line);
    }
    if (!task || task.completed || !task.scheduledDate) return false;
    try { if (!recurringFile(this.app, task)) return false; }
    catch (error) { if (!checking) new Notice(String(error)); return false; }
    if (!checking) {
      const selected = task;
      void (async () => {
        if (!this.settings.taskMode && markdown) await markdown.save();
        const paths = await this.store.resolveRecurring(selected, outcome);
        view?.clearSelection();
        for (const path of paths) await this.index.refreshPath(path);
      })().catch(error => new Notice(error instanceof Error ? error.message : "Could not resolve recurring task."));
    }
    return true;
  }

  private editCurrentLineTask(checking: boolean, editor: Editor, file: TFile | null): boolean {
    if (this.settings.taskMode || !file) return false;
    const line = editor.getCursor().line;
    const task = scanTasks(file.path, editor.getValue(), new Date(), this.dateFormat(), this.settings.sectionHeadingLevel).find(task => task.line === line);
    if (!task) return false;
    if (!checking) this.openEditor({ mode: "all", task });
    return true;
  }

  private editSelectedTaskProperties(checking: boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(TaskMainView);
    if (!view?.getSelectedTasks().length) return false;
    if (!checking) this.openBulkEditor(view);
    return true;
  }

  private switchCalendarScope(scope: CalendarScope, checking: boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(TaskMainView);
    if (!view?.hasCalendar) return false;
    if (!checking) {
      void view.setState({ ...view.getState(), calendarScope: scope })
        .then(() => this.app.workspace.requestSaveLayout())
        .catch(error => new Notice(String(error)));
    }
    return true;
  }

  private focusProjectSearch(checking: boolean): boolean {
    if (!this.settings.taskMode) return false;
    const view = this.app.workspace.getActiveViewOfType(TaskMainView);
    if (!view?.pagePath || (!this.index.isProject(view.pagePath) && !this.index.tagForPath(view.pagePath))) return false;
    if (!checking) view.focusSearch();
    return true;
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

  openBulkEditor(view: TaskMainView, focusProperty?: TaskEditorOptions["focusProperty"]): void {
    const tasks = view.getSelectedTasks();
    if (!tasks.length) return;
    const refresh = async (paths: string[]): Promise<void> => {
      view.clearSelection();
      for (const path of paths) await this.index.refreshPath(path);
    };
    new BulkTaskEditorModal(this.app, {
      tasks, focusProperty, projects: this.index.projects(), dateFormat: this.dateFormat(), inboxPath: this.settings.inboxPath,
      onSave: async patch => { await refresh(await this.store.bulkUpdate(tasks, patch)); },
      onDelete: async () => { await refresh(await this.store.bulkDelete(tasks)); }
    }).open();
  }

  openEditor(state: OpenEditorState): void {
    const options: TaskEditorOptions = {
      ...state,
      preset: state.tag ? { ...state.preset, tags: [...new Set([...(state.preset?.tags ?? []), state.mode === "tags" && state.pagePath ? state.pagePath.replace(/\.md$/i, "") : state.tag])] } : state.preset,
      projectPath: state.mode === "tags" ? undefined : state.pagePath ?? state.projectPath,
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

  async setSectionHeadingLevel(level: number): Promise<void> {
    if (!Number.isInteger(level) || level < 1 || level > 6) return;
    this.settings.sectionHeadingLevel = level;
    await this.saveSettings();
    await this.refreshDateParsing();
  }

  async setDateFormat(value: string): Promise<void> {
    const previous = this.dateFormat();
    this.settings.dateFormat = value.trim();
    if (previous !== this.dateFormat()) this.settings.previousDateFormat ??= previous;
    await this.saveSettings();
    await this.refreshDateParsing();
  }

  private async refreshDateParsing(): Promise<void> {
    await Promise.all(this.app.vault.getMarkdownFiles().map(file => this.index.refreshPath(file.path)));
    this.refreshViews();
  }

  async updateTaskDates(): Promise<void> {
    const paths = await this.store.updateDates([
      this.settings.previousDateFormat ?? this.dateFormat(),
      this.dateFormat(), dailyNoteDateFormat(this.app)
    ]);
    delete this.settings.previousDateFormat;
    await this.saveSettings();
    await this.refreshDateParsing();
    new Notice(`Updated task dates in ${paths.length} note${paths.length === 1 ? "" : "s"}.`);
  }

  dateFormat(): string {
    return this.settings.dateFormat.trim() || dailyNoteDateFormat(this.app);
  }
}
