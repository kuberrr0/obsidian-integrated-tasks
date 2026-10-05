import { dismissPopovers } from "./choice-popover";
import { todayIso } from "./date";
import { parseIgnoreList } from "./ignore";
import { noteRecurringCompletion } from "./note-recurring-completion";
import { isRepeatingTask, recurringFile, type RecurringOutcome } from "./recurring-task";
import { shiftCalendar, type CalendarScope } from "./calendar";
import { scanTasks } from "./parser";
import { applyProjectDraft, projectEditDraft } from "./project-editor";
import { cloneTaskFilters } from "./task-filters";
import { SmartListEditorModal, type SmartListDraft } from "./smart-list-editor";
import { ProjectCreatorModal, projectNotePath, projectNoteContent, type ProjectDraft } from "./project-creator";
import { setTagFormat as useTagFormat, type TagFormat } from "./task-tags";
import { convertTagFormat } from "./tag-links";
import { openConfirm } from "./confirm-modal";
import { TaskModeController } from "./task-mode";
import type { TaskEditorPreset } from "./types";
import { noteDateInput } from "./note-date-input";
import { noteTokenEditor } from "./note-token-editor";
import { noteTaskEditEditor, registerNoteTaskEdit } from "./note-task-edit";
import { renderNoteTokens } from "./note-token-reading";
import { MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf, type Editor, type TAbstractFile, type ViewState } from "obsidian";
import { TaskEditorModal, initialDraft, type TaskEditorOptions } from "./task-editor";
import { TaskIndex, type RefreshOptions } from "./task-index";
import { IndexedDbCache } from "./index-cache";
import { TaskNavigationView, TASK_NAV_VIEW } from "./navigation-view";
import { TaskStore, type TaskChange } from "./task-store";
import { TasksImportModal } from "./tasks-import-modal";
import { TASK_QUERY_LANGUAGE, TASK_QUERY_TEMPLATE, TaskQueryBlock } from "./task-query-block";
import { TaskMainView, TASK_MAIN_VIEW } from "./task-view";
import { DEFAULT_SETTINGS, type Project, type SavedViewOptions, type SmartList, type ViewLayout, type Task, type TaskDraft, type TaskManagerSettings, type TaskViewMode, type TaskViewState } from "./types";
import { TaskManagerSettingTab } from "./settings";
import { addProjectProperties } from "./project-properties";
import { dailyNoteDateFormat } from "./daily-notes";
import { TaskQuickSwitcher } from "./quick-switcher";
import { TaskSidebarView, TASK_SIDEBAR_VIEW } from "./task-sidebar";

const LEGACY_SETTINGS = ["taskListRowHeight", "taskListRowHeightMultiplier", "hiddenListTaskProperties", "hiddenKanbanTaskProperties", "tasksHeading", "taskDeadlineDisplay", "linkTags", "taskHoverHighlight", "wrapTaskTitles", "wrapCalendarTaskTitles", "wrapKanbanTaskTitles", "showSubtaskCounts", "showGroupTaskCounts", "weeklyReview"];

export interface OpenEditorState extends TaskViewState {
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
  private unloaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TaskIndex(this.app, () => this.settings, () => this.dateFormat(), new IndexedDbCache(this.app));
    this.store = new TaskStore(this.app, () => this.dateFormat(), () => this.settings.newTaskPosition, () => this.settings.linkDates, () => this.settings.sectionHeadingLevel, () => this.settings.completionDates);
    this.store.onChange = change => this.offerUndo(change);

    this.registerView(TASK_NAV_VIEW, (leaf) => new TaskNavigationView(leaf, this));
    this.registerView(TASK_MAIN_VIEW, (leaf) => new TaskMainView(leaf, this));
    this.registerView(TASK_SIDEBAR_VIEW, (leaf) => new TaskSidebarView(leaf, this));
    this.registerEditorExtension(noteDateInput(() => this.dateFormat(), () => this.settings.taskMode, () => this.settings.linkDates));
    this.registerEditorExtension(noteRecurringCompletion(() => this.dateFormat(), task => !this.settings.taskMode && isRepeatingTask(this.app, task),
      (task, outcome) => { this.completeRecurringTaskFromNote(task, outcome); }, undefined,
      { enabled: () => this.settings.completionDates, linkDates: () => this.settings.linkDates }, () => this.settings.sectionHeadingLevel));
    this.registerEditorExtension(noteTokenEditor(() => this.dateFormat()));
    this.registerEditorExtension(noteTaskEditEditor(() => this.dateFormat(), task => this.openEditor({ mode: "all", task }), () => this.settings.sectionHeadingLevel, task => this.completeRecurringTaskFromNote(task)));
    this.registerMarkdownPostProcessor((element, context) => {
      renderNoteTokens(element, this.dateFormat());
      registerNoteTaskEdit(element, context, () => this.dateFormat(), task => this.openEditor({ mode: "all", task }), () => this.settings.sectionHeadingLevel,
        task => this.toggleTaskFromReadingView(task, true), task => this.toggleTaskFromReadingView(task, false));
    });
    this.registerMarkdownCodeBlockProcessor(TASK_QUERY_LANGUAGE, (source, element, context) => {
      context.addChild(new TaskQueryBlock(element, source, context.sourcePath, this));
    });
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.addRibbonIcon("circle-check-big", "Open task manager", () => void this.activateNavigation().catch((error) => new Notice(String(error))));

    const commands: Array<[TaskViewMode, string, string]> = [
      ["inbox", "Open inbox", "open-inbox"],
      ["today", "Open today", "open-today"],
      ["upcoming", "Open upcoming", "open-upcoming"],
      ["all", "Open all tasks", "open-all-tasks"],
      ["projects", "Open projects", "open-projects"],
      ["tags", "Open tags", "open-tags"]
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
    for (const scope of ["day", "four-day", "week", "month", "year"] as const) {
      this.addCommand({
        id: `switch-calendar-to-${scope}`,
        name: `Switch calendar to ${scope === "four-day" ? "4 days" : scope}`,
        checkCallback: checking => this.switchCalendarScope(scope, checking)
      });
    }
    for (const [direction, name] of [[-1, "previous"], [1, "next"]] as const) {
      this.addCommand({ id: `calendar-${name}-period`, name: `Calendar: ${name} period`, checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(TaskMainView);
        if (!view?.hasCalendar) return false;
        if (!checking) {
          const state = view.getState();
          void view.setState({ ...state, calendarAnchor: shiftCalendar(String(state.calendarAnchor), state.calendarScope as CalendarScope, direction) })
            .then(() => this.app.workspace.requestSaveLayout()).catch(error => new Notice(String(error)));
        }
        return true;
      } });
    }
    this.addCommand({ id: "open-task-sidebar", name: "Open Task Details sidebar", callback: () => void this.activateTaskSidebar().catch((error) => new Notice(String(error))) });
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
    this.addCommand({ id: "edit-project", name: "Open project actions", checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(TaskMainView);
      if (!view?.pagePath || !this.index.isProject(view.pagePath)) return false;
      if (!checking) view.openProjectActions();
      return true;
    } });
    this.addCommand({ id: "edit-task", name: "Edit task", editorCheckCallback: (checking, editor, view) =>
      this.editCurrentLineTask(checking, editor, view.file) });
    this.addCommand({ id: "edit-task-properties", name: "Open task menu", checkCallback: checking => this.editSelectedTaskProperties(checking) });
    this.addCommand({ id: "new-task", name: "Create new task", callback: () => this.newTask() });
    this.addCommand({ id: "convert-task-tags", name: "Convert task tags to the tag format", callback: () => void this.convertTaskTags() });
    this.addCommand({ id: "insert-task-query", name: "Insert task query", editorCallback: editor => editor.replaceSelection(TASK_QUERY_TEMPLATE) });
    this.addCommand({ id: "import-tasks-plugin", name: "Import tasks from the Tasks plugin", callback: () => this.openTasksImport() });
    this.addCommand({ id: "quick-switch", name: "Quick switch to view, project, tag, or task", callback: () => this.openQuickSwitcher() });
    this.addCommand({ id: "rebuild-task-index", name: "Rebuild task index", callback: () => {
      void this.index.rebuild().then(() => new Notice("Task index rebuilt.")).catch(error => new Notice(String(error)));
    } });
    this.addCommand({ id: "undo-task-change", name: "Undo last task change", checkCallback: checking => {
      if (!this.store.lastChange()) return false;
      if (!checking) void this.undoTaskChange();
      return true;
    } });
    this.addCommand({ id: "redo-task-change", name: "Redo last undone task change", checkCallback: checking => {
      if (!this.store.lastUndone()) return false;
      if (!checking) void this.redoTaskChange();
      return true;
    } });
    this.addRibbonIcon("plus", "Create new task", () => this.newTask());

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

    // Task views store note paths, so they follow renames and close with deleted notes like Markdown tabs.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { void this.retargetViews(file, oldPath); }));
    this.registerEvent(this.app.vault.on("delete", file => this.closeDeletedViews(file)));

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      void this.activateNavigation(false).catch(error => new Notice(String(error)));
      void this.activateTaskSidebar(false).catch(error => new Notice(String(error)));
      // Index after the workspace loads, so a large vault does not delay startup. Views
      // restored meanwhile show what is indexed so far and refresh when it finishes.
      void this.index.initialize()
        .then(() => { if (!this.unloaded) this.startTaskMode(); })
        .catch(error => new Notice(String(error)));
      // A new day moves Today and Upcoming, and gives "tomorrow" or "{friday}" a new date: notes parsed on an
      // earlier day are parsed again.
      let day = todayIso();
      this.registerInterval(window.setInterval(() => {
        if (todayIso() === day) return;
        day = todayIso();
        void this.index.rescanAll({ force: false }).catch(error => new Notice(String(error)));
      }, 60_000));
    });
  }

  /** Task mode decides tabs from project and tag membership, so it waits for the full index. */
  private startTaskMode(): void {
    this.taskModeController = new TaskModeController(this.app, () => this.settings.taskMode, path => this.index.isProject(path), path => this.index.tagForPath(path));
    this.redirectProjectNotes(this.taskModeController);
    const syncTaskMode = (): void => { void this.taskModeController?.sync().catch(error => new Notice(String(error))); };
    // Metadata and index updates arrive in bursts; navigation events stay immediate to avoid a flash of Markdown.
    let syncTimer: number | undefined;
    const syncTaskModeSoon = (): void => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(syncTaskMode, 100);
    };
    this.register(() => window.clearTimeout(syncTimer));
    this.registerEvent(this.app.workspace.on("file-open", syncTaskMode));
    this.registerEvent(this.app.metadataCache.on("resolved", syncTaskModeSoon));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncTaskMode));
    this.registerEvent(this.app.workspace.on("layout-change", syncTaskMode));
    this.register(this.index.subscribe(syncTaskModeSoon));
    syncTaskMode();
  }

  openTasksImport(): void {
    const file = this.app.workspace.getActiveFile?.();
    new TasksImportModal(this.app, this, file?.extension === "md" ? file : undefined).open();
  }

  /** A short notice after each task action, with an Undo button. */
  private offerUndo(change: TaskChange): void {
    if (!this.settings.showUndoNotices) return;
    const fragment = createFragment();
    fragment.appendText(`${change.label}. `);
    const button = fragment.createEl("button", { cls: "tm-undo-button", text: "Undo" });
    const notice = new Notice(fragment, 6000);
    button.addEventListener("click", event => {
      event.stopPropagation();
      notice.hide();
      void this.undoTaskChange(change);
    });
  }

  /** Undo the given action, or the most recent one. */
  async undoTaskChange(change?: TaskChange): Promise<void> {
    const target = change ?? this.store.lastChange();
    if (!target) { new Notice("Nothing to undo."); return; }
    try {
      const paths = await this.store.undo(target);
      for (const path of paths) await this.index.refreshPath(path);
      const fragment = createFragment();
      fragment.appendText(`Undone: ${target.label}. `);
      const button = fragment.createEl("button", { cls: "tm-undo-button", text: "Redo" });
      const notice = new Notice(fragment, 6000);
      button.addEventListener("click", event => {
        event.stopPropagation();
        notice.hide();
        void this.redoTaskChange(target);
      });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not undo the change.");
    }
  }

  /** Redo the given undone action, or the most recent one. */
  async redoTaskChange(change?: TaskChange): Promise<void> {
    const target = change ?? this.store.lastUndone();
    if (!target) { new Notice("Nothing to redo."); return; }
    try {
      const paths = await this.store.redo(target);
      for (const path of paths) await this.index.refreshPath(path);
      new Notice(`Redone: ${target.label}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not redo the change.");
    }
  }

  onunload(): void {
    this.unloaded = true;
    // View options changed in the last moments are still written.
    if (this.viewOptionsSave !== undefined) void this.saveSettings();
    this.taskModeController?.dispose();
    this.index.destroy();
    dismissPopovers();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<TaskManagerSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // Settings from older versions that no longer exist; drop them so they are not saved back.
    for (const key of LEGACY_SETTINGS) delete (this.settings as unknown as Record<string, unknown>)[key];
    this.settings.smartLists = Array.isArray(this.settings.smartLists) ? this.settings.smartLists : [];
    this.settings.taskMode = this.settings.taskMode === true;
    if (this.settings.tagFormat !== "hash" && this.settings.tagFormat !== "wikilink") this.settings.tagFormat = DEFAULT_SETTINGS.tagFormat;
    useTagFormat(this.settings.tagFormat);
    if (typeof this.settings.dateFormat !== "string") this.settings.dateFormat = DEFAULT_SETTINGS.dateFormat;
    if (!Number.isInteger(this.settings.sectionHeadingLevel) || this.settings.sectionHeadingLevel < 1 || this.settings.sectionHeadingLevel > 6) this.settings.sectionHeadingLevel = 1;
    this.settings.showSubtasks = this.settings.showSubtasks === true;
    this.settings.calendarProjectColors = this.settings.calendarProjectColors !== false;
    this.settings.calendarPriorityColors = this.settings.calendarPriorityColors !== false;
    if (typeof this.settings.inboxPath !== "string" || !this.settings.inboxPath.trim()) this.settings.inboxPath = DEFAULT_SETTINGS.inboxPath;
    if (!this.settings.inboxPath.endsWith(".md")) this.settings.inboxPath = `${this.settings.inboxPath}.md`;
    this.settings.showUndoNotices = this.settings.showUndoNotices === true;
    this.settings.density = this.settings.density === "compact" ? "compact" : "comfortable";
    this.settings.showFiles = this.settings.showFiles === true;
    if (!["alphabetical", "alphabeticalReverse", "byModifiedTime", "byModifiedTimeReverse", "byCreatedTime", "byCreatedTimeReverse"].includes(this.settings.fileSortOrder)) this.settings.fileSortOrder = "alphabetical";
    // Things is the default; only an explicit Griply choice keeps Griply.
    this.settings.style = this.settings.style === "griply" ? "griply" : "things";
    this.settings.taskDetails = this.settings.taskDetails === "sidebar" ? "sidebar" : "view";
    this.settings.completionDates = this.settings.completionDates === true;
    const options: unknown = this.settings.viewOptions;
    // A fresh object, never the defaults' own: views write into it.
    this.settings.viewOptions = options && typeof options === "object" && !Array.isArray(options) ? { ...options as Record<string, SavedViewOptions> } : {};
    const layouts: unknown = this.settings.viewLayouts;
    this.settings.viewLayouts = layouts && typeof layouts === "object" && !Array.isArray(layouts)
      ? Object.fromEntries(Object.entries(layouts as Record<string, unknown>).filter((entry): entry is [string, ViewLayout] => ["calendar", "kanban", "gantt"].includes(String(entry[1])))) : {};
    for (const key of ["ignoredPaths", "ignoredTags"] as const) {
      const list: unknown = this.settings[key];
      this.settings[key] = Array.isArray(list) ? parseIgnoreList(list.filter((item): item is string => typeof item === "string").join("\n"), key === "ignoredTags") : [];
    }
  }

  async saveSettings(): Promise<void> {
    window.clearTimeout(this.viewOptionsSave);
    this.viewOptionsSave = undefined;
    await this.saveData(this.settings);
  }

  private viewOptionsSave?: number;

  /**
   * Keeps a view's View options (none: its defaults) for its next visit. Filters change as they are typed, so the
   * settings are written once the changes pause.
   */
  saveViewOptions(key: string, options: SavedViewOptions | undefined): void {
    if (options) this.settings.viewOptions[key] = options;
    else delete this.settings.viewOptions[key];
    this.saveViewSoon();
  }

  /** Keeps a view's layout (none: a list) for its next visit. */
  saveViewLayout(key: string, layout: ViewLayout | undefined): void {
    if (layout && layout !== "list") this.settings.viewLayouts[key] = layout;
    else delete this.settings.viewLayouts[key];
    this.saveViewSoon();
  }

  private saveViewSoon(): void {
    window.clearTimeout(this.viewOptionsSave);
    this.viewOptionsSave = window.setTimeout(() => { void this.saveSettings().catch(error => new Notice(String(error))); }, 500);
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

  /** The Task Details sidebar, in the right sidebar unless it has been moved; created there when missing. */
  async activateTaskSidebar(reveal = true): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(TASK_SIDEBAR_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
      if (!leaf) return;
      await leaf.setViewState({ type: TASK_SIDEBAR_VIEW, active: false });
    }
    if (reveal) await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Shows a task (or a view's new task) in the Task Details sidebar, opening the sidebar first (on phones and tablets, its
   * drawer) when it is closed. `focus` puts the caret in the task's title.
   */
  async showInTaskSidebar(id: string, options: { focus?: boolean } = {}): Promise<void> {
    await this.activateTaskSidebar(true);
    const view = this.app.workspace.getLeavesOfType(TASK_SIDEBAR_VIEW)[0]?.view;
    if (view instanceof TaskSidebarView) view.showTask(id, options);
  }

  /** The Task Details sidebar follows the task view in front and its selection; it redraws on the next frame. */
  refreshTaskSidebar(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_SIDEBAR_VIEW)) {
      if (leaf.view instanceof TaskSidebarView) leaf.view.scheduleRender();
    }
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
    delete this.settings.viewLayouts[`smartList:${id}`];
    try { await this.saveSettings(); }
    catch (cause) { this.settings.smartLists = previous; throw cause; }
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      if (leaf.view.getState().smartListId === id) await leaf.setViewState({ type: TASK_MAIN_VIEW, state: { mode: "smartLists" } });
    }
    this.refreshSmartLists();
  }

  private refreshSmartLists(): void {
    this.refreshNavigation();
    this.refreshViews();
  }

  refreshNavigation(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (leaf.view instanceof TaskNavigationView) leaf.view.refresh();
    }
  }

  openQuickSwitcher(): void {
    new TaskQuickSwitcher(this.app, this).open();
  }

  openProjectCreator(): void {
    new ProjectCreatorModal(this.app, {
      projects: this.index.projects(), dateFormat: this.dateFormat(), linkDates: this.settings.linkDates,
      createProject: async draft => { await this.openProject(await this.createProjectNote(draft)); }
    }).open();
  }

  /** Writes a new project note (a name alone is enough) and indexes it; returns its path. */
  async createProjectNote(draft: Partial<ProjectDraft> & { name: string }): Promise<string> {
    const full: ProjectDraft = { date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "", archived: false, ...draft };
    const path = projectNotePath(full.name);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error("A note with this name already exists.");
    await this.app.vault.create(path, projectNoteContent(full, this.dateFormat(), this.settings.linkDates));
    await this.index.refreshPath(path);
    return path;
  }


  /** A project's current properties, as read from its note. */
  projectDraft(project: Project): ProjectDraft {
    const file = this.app.vault.getAbstractFileByPath(project.path);
    return projectEditDraft(project, file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {});
  }

  /**
   * Changes a project's properties (and, with a new name, its note's name, in the same folder) from its
   * current values; returns its path afterwards. Views showing it follow a rename.
   */
  async updateProject(path: string, change: (draft: ProjectDraft) => ProjectDraft): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    const project = this.index.projects().find(project => project.path === path);
    if (!(file instanceof TFile) || !project) throw new Error("Project note no longer exists.");
    const draft = change(projectEditDraft(project, this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}));
    const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
    const destination = folder + projectNotePath(draft.name);
    const existing = this.app.vault.getAbstractFileByPath(destination);
    if (existing && existing !== file) throw new Error("A note with this name already exists.");
    if (draft.parent === file.path || draft.parent === destination) throw new Error("A project cannot be its own parent.");
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) =>
      applyProjectDraft(frontmatter, draft, this.dateFormat(), this.settings.linkDates));
    if (destination !== file.path) {
      const oldPath = file.path;
      await this.app.fileManager.renameFile(file, destination);
      // Usually already done by the rename event; repeating it is a no-op.
      await this.retargetViews(file, oldPath);
    }
    await this.index.refreshPath(file);
    return file.path;
  }

  /** Moves a project's note, and so its tasks, to the trash (the vault's or the system's, per Obsidian's setting). */
  async deleteProject(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Project note no longer exists.");
    await this.app.fileManager.trashFile(file);
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

  private pendingRecurringNotes = new Set<string>();
  private recurringNoteQueue: Promise<void> = Promise.resolve();

  /** A recurring task checked (`[x]`) or cancelled (`[-]`) in a note: advance it there and log the outcome in its routine note. */
  private completeRecurringTaskFromNote(task: Task, outcome: RecurringOutcome = "COMPLETED"): boolean {
    if (this.settings.taskMode || task.completed) return false;
    try { if (!recurringFile(this.app, task) && !task.repeat) return false; }
    catch (error) { new Notice(String(error)); return true; }
    const key = `${task.path}:${task.line}:${task.raw}`;
    if (this.pendingRecurringNotes.has(key)) return true;
    this.pendingRecurringNotes.add(key);
    this.recurringNoteQueue = this.recurringNoteQueue.then(async () => {
      const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (markdown?.file?.path === task.path) await markdown.save();
      const paths = await this.store.resolveRecurring(task, outcome);
      for (const path of paths) await this.index.refreshPath(path);
    }).catch(error => { new Notice(error instanceof Error ? error.message : `Could not ${outcome === "COMPLETED" ? "complete" : "cancel"} recurring task.`); })
      .finally(() => this.pendingRecurringNotes.delete(key));
    return true;
  }

  /** Reading view writes checkbox clicks itself; with completion dates on, the store completes (stamping it) or reopens the task instead. */
  private toggleTaskFromReadingView(task: Task, completed: boolean): boolean {
    if (completed && this.completeRecurringTaskFromNote(task)) return true;
    if (this.settings.taskMode || !this.settings.completionDates) return false;
    this.recurringNoteQueue = this.recurringNoteQueue.then(async () => {
      const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (markdown?.file?.path === task.path) await markdown.save();
      await this.store.toggle(task, completed);
      await this.index.refreshPath(task.path);
    }).catch(error => { new Notice(error instanceof Error ? error.message : "Could not update the task."); });
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
    if (!checking) view.openSelectionMenu();
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
    this.refreshNavigation();
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

  /**
   * With task mode on, a project's or tag's note opens straight as its task view, however it is opened (a link,
   * the file list, Back and Forward), instead of flashing as a note first. Obsidian has no hook for this, so every
   * tab's view change passes through the controller; the wrapper is removed on unload, or left inert when another
   * plugin has wrapped it since.
   */
  private redirectProjectNotes(controller: TaskModeController): void {
    const prototype = WorkspaceLeaf.prototype;
    // Read as a plain function: it is called for each leaf (as `this`), never bound to the prototype.
    const original = Reflect.get(prototype, "setViewState") as (this: WorkspaceLeaf, viewState: ViewState, eState?: unknown) => Promise<void>;
    let active = true;
    const wrapper = function (this: WorkspaceLeaf, viewState: ViewState, eState?: unknown): Promise<void> {
      return original.call(this, active ? controller.redirect(this, viewState) : viewState, eState);
    };
    prototype.setViewState = wrapper;
    this.register(() => {
      active = false;
      if (prototype.setViewState === wrapper) prototype.setViewState = original;
    });
  }

  /**
   * A new task in the open view's context: a task view's tag, project or date (as its Add task button, so in the
   * Things style a blank card in the list), or the open note when it is a project or a tag's note; otherwise the
   * Inbox. With a sidebar focused (such as the task navigation), the context is the last view in the main area.
   */
  newTask(): void {
    const workspace = this.app.workspace;
    const view = workspace.getActiveViewOfType(TaskMainView) ?? workspace.getActiveViewOfType(MarkdownView) ?? workspace.getMostRecentLeaf()?.view;
    if (view instanceof TaskMainView) { view.newTask(); return; }
    const path = view instanceof MarkdownView ? view.file?.path : undefined;
    const tag = path ? this.index.tagForPath(path) : undefined;
    if (path && this.index.isProject(path)) this.openEditor({ mode: "all", projectPath: path });
    else if (path && tag) this.openEditor({ mode: "tags", tag, pagePath: path });
    else this.openEditor({ mode: "inbox" });
  }

  /** A new task as a view would start it: its tag, its project, or today's (or tomorrow's) date. */
  newTaskDraft(state: OpenEditorState): TaskDraft {
    return initialDraft(this.editorContext(state));
  }

  private editorContext(state: OpenEditorState): Omit<TaskEditorOptions, "onSave"> {
    return {
      ...state,
      preset: state.tag ? { ...state.preset, tags: [...new Set([...(state.preset?.tags ?? []), state.mode === "tags" && state.pagePath ? state.pagePath.replace(/\.md$/i, "") : state.tag])] } : state.preset,
      projectPath: state.mode === "tags" ? undefined : state.pagePath ?? state.projectPath,
      projects: this.index.projects(),
      settings: this.settings,
      dateFormat: this.dateFormat()
    };
  }

  openEditor(state: OpenEditorState): void {
    const options: TaskEditorOptions = {
      ...this.editorContext(state),
      tagSuggestions: this.index.tagSummaries().map(tag => tag.name),
      createProject: name => this.createProjectNote({ name }),
      onDelete: state.task ? async () => {
        await this.store.delete(state.task!);
        await this.index.refreshPath(state.task!.path);
      } : undefined,
      onSave: async (draft) => {
        try {
          // Editing a task puts its line's properties in order; a new task is written in order already.
          if (state.task) await this.store.update(state.task, { ...draft, sortProperties: true });
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

  private viewRetargeting: Promise<void> = Promise.resolve();

  /** Point task views (and remembered task-mode layouts) at a renamed note or folder. */
  private retargetViews(file: TAbstractFile, oldPath: string): Promise<void> {
    const renamed = (path: unknown): string | undefined => {
      if (typeof path !== "string") return undefined;
      if (file instanceof TFile) return file.extension === "md" && path === oldPath ? file.path : undefined;
      // Obsidian also reports each file inside a renamed folder; this covers any view it misses.
      return file instanceof TFolder && path.startsWith(`${oldPath}/`) ? file.path + path.slice(oldPath.length) : undefined;
    };
    this.viewRetargeting = this.viewRetargeting.then(async () => {
      if (file instanceof TFile && file.extension === "md") this.taskModeController?.renamePath(oldPath, file.path);
      // First, so the views opening at the new path find their options there.
      await this.renameKeptPaths(renamed);
      for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
        const viewState = leaf.getViewState();
        const state = viewState.state ?? {};
        const next: Record<string, unknown> = { ...state };
        let path: string | undefined;
        for (const key of ["pagePath", "projectPath"] as const) {
          const target = renamed(state[key]);
          if (target) { next[key] = target; path = target; }
        }
        if (!path) continue;
        if (state.markdownState && typeof state.markdownState === "object") next.markdownState = { ...state.markdownState as Record<string, unknown>, file: path };
        await leaf.setViewState({ type: TASK_MAIN_VIEW, state: next, ...(viewState.pinned ? { pinned: true } : {}) });
      }
    }).catch(error => { console.error("Task manager could not update renamed task views", error); });
    return this.viewRetargeting;
  }

  /** What is kept for a renamed note (or the notes in a renamed folder) follows it: its views' options and layouts, and the smart lists made from it. */
  private async renameKeptPaths(renamed: (path: unknown) => string | undefined): Promise<void> {
    let changed = false;
    for (const kept of [this.settings.viewOptions, this.settings.viewLayouts] as Array<Record<string, unknown>>) {
      for (const key of Object.keys(kept)) {
        const match = /^(project|tag):(.+)$/.exec(key);
        const target = match ? renamed(match[2]) : undefined;
        if (!match || !target) continue;
        kept[`${match[1]}:${target}`] = kept[key];
        delete kept[key];
        changed = true;
      }
    }
    this.settings.smartLists = this.settings.smartLists.map(list => {
      const scope = list.scope;
      const target = scope && "path" in scope ? renamed(scope.path) : undefined;
      if (!scope || !target) return list;
      changed = true;
      return { ...list, scope: { ...scope, path: target } };
    });
    if (changed) await this.saveSettings();
  }

  private closeDeletedViews(file: TAbstractFile): void {
    const deleted = (path: unknown): boolean => typeof path === "string" &&
      (file instanceof TFolder ? path.startsWith(`${file.path}/`) : path === file.path);
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      const state = leaf.getViewState().state ?? {};
      if (deleted(state.pagePath) || deleted(state.projectPath)) leaf.detach();
    }
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskMainView) view.render();
    }
    this.refreshNavigation();
    this.refreshTaskSidebar();
  }

  async setSectionHeadingLevel(level: number): Promise<void> {
    if (!Number.isInteger(level) || level < 1 || level > 6) return;
    this.settings.sectionHeadingLevel = level;
    await this.saveSettings();
    await this.refreshDateParsing();
  }

  /** Tags are read (and written) in the new format from now on; notes keep what they have until converted. */
  async setTagFormat(value: TagFormat): Promise<void> {
    this.settings.tagFormat = value;
    useTagFormat(value);
    await this.saveSettings();
    await this.refreshDateParsing();
  }

  /**
   * Rewrites the tags on every note's task lines into the Tag format (`#[[open house]]` → `#open-house`, or `#tag` →
   * `#[[tag]]`), after asking; one undoable change.
   */
  async convertTaskTags(): Promise<void> {
    const to = this.settings.tagFormat;
    const files = this.app.vault.getMarkdownFiles();
    const changed: TFile[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (convertTagFormat(content, to) !== content) changed.push(file);
    }
    const written = to === "hash" ? "#tag" : "#[[tag]]";
    if (!changed.length) { new Notice(`Every task tag is already written as ${written}.`); return; }
    openConfirm(this.app, {
      title: `Write task tags as ${written}?`,
      message: `Tags on tasks in ${changed.length} note${changed.length === 1 ? "" : "s"} will be rewritten as ${written}${to === "hash" ? "; spaces in a tag become hyphens" : ""}. You can undo it.`,
      confirm: "Convert tags",
      run: () => void this.store.rewriteNotes(changed, content => convertTagFormat(content, to), `Converted task tags to ${written}`)
        .then(async paths => { for (const path of paths) await this.index.refreshPath(path); new Notice(`Converted task tags in ${paths.length} note${paths.length === 1 ? "" : "s"}.`); })
        .catch((error: unknown) => { new Notice(error instanceof Error ? error.message : "Could not convert the tags."); })
    });
  }

  async setDateFormat(value: string): Promise<void> {
    const previous = this.dateFormat();
    this.settings.dateFormat = value.trim();
    if (previous !== this.dateFormat()) this.settings.previousDateFormat ??= previous;
    await this.saveSettings();
    await this.refreshDateParsing();
  }

  /** Settings that change how notes are read rescan the vault in batches; views update on the one index event. */
  private async refreshDateParsing(options?: RefreshOptions): Promise<void> {
    await this.index.rescanAll(options);
  }

  async updateTaskDates(): Promise<void> {
    const paths = await this.store.updateDates([
      this.settings.previousDateFormat ?? this.dateFormat(),
      this.dateFormat(), dailyNoteDateFormat(this.app)
    ]);
    delete this.settings.previousDateFormat;
    await this.saveSettings();
    // The format itself is unchanged, so only notes whose content changed are parsed again.
    await this.refreshDateParsing({ force: false });
    new Notice(`Updated task dates in ${paths.length} note${paths.length === 1 ? "" : "s"}.`);
  }

  dateFormat(): string {
    return this.settings.dateFormat.trim() || dailyNoteDateFormat(this.app);
  }
}
