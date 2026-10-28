export type Priority = 1 | 2 | 3;
/** Stored as the checkbox character: `[ ]`, `[/]`, `[?]`, `[x]`, `[-]`. */
export type TaskStatus = "todo" | "doing" | "waiting" | "done" | "cancelled";

export interface ParsedTaskMetadata {
  title: string;
  scheduledDate?: string;
  scheduledTime?: string;
  deadline?: string;
  deadlineTime?: string;
  /** Inline repeat rule such as "every week"; completing the task advances its dates in place. */
  repeat?: string;
  /** ISO date the task was completed, when completion dates are recorded. */
  completedDate?: string;
  durationMinutes?: number;
  priority?: Priority;
  tags?: string[];
}

export interface Task extends ParsedTaskMetadata {
  /** Everything indented beneath this task (bullets, text, quotes, code…), excluding child checklists and their own. */
  description?: string;
  descriptionLines?: number[];
  id: string;
  path: string;
  line: number;
  endLine: number;
  raw: string;
  indent: number;
  status: TaskStatus;
  /** Done or cancelled. */
  completed: boolean;
  section?: string;
  sectionLine?: number;
  parentId?: string;
  childIds: string[];
}

export type ProjectProperties = Pick<ParsedTaskMetadata, "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "priority"> & {
  endDate?: string;
  /** A validated CSS colour from the `color` property; on `Project`, inherited from the nearest coloured ancestor. */
  color?: string;
  /** The `status` property, read as a task status ("In progress", "on hold"…); unset or unrecognised: undefined. */
  status?: TaskStatus;
  /** The `description` property's text. */
  description?: string;
};

export interface Project extends ProjectProperties {
  parent?: string;
  parentPath?: string;
  path: string;
  name: string;
  headings?: import("./structure").NoteHeading[];
  openTasks: number;
  completedTasks: number;
  /** Its tasks together with its subprojects' (cancelled ones aside), which its progress ring shows. */
  totals?: ProjectTotals;
}

export interface ProjectTotals { open: number; completed: number }

export type TaskViewMode = "inbox" | "today" | "upcoming" | "all" | "projects" | "tags" | "smartLists";

export interface TaskViewState {
  smartListId?: string;
  tag?: string;
  mode: TaskViewMode;
  projectPath?: string;
  pagePath?: string;
  markdownState?: Record<string, unknown>;
}

/** `date`: the action date, the scheduled date or the deadline, whichever comes first. */
export type TaskProperty = "tags" | "title" | "priority" | "date" | "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "repeat" | "completed" | "duration" | "source" | "section" | "status";
export type TaskSort = "date" | TaskProperty;
export type TaskGrouping = "default" | "none" | "date" | TaskProperty;
export type FilterOperator = "has" | "missing" | "is" | "isNot" | "contains" | "before" | "after" | "between";
export interface TaskFilterCondition {
  operator: FilterOperator;
  values: string[];
  join: "and" | "or";
}
export interface TaskFilter {
  conditions?: TaskFilterCondition[];
  property: TaskProperty;
  operator: FilterOperator;
  values: string[];
}

export interface TaskQuery {
  tagPath?: string;
  tag?: string;
  mode: TaskViewMode | "project";
  showCompleted: boolean;
  projectPath?: string;
  search?: string;
  filters?: TaskFilter[];
  dateFilter?: "overdue";
}

export interface TaskDraft extends ParsedTaskMetadata {
  /** Undefined leaves an existing description unchanged; an empty string clears it. */
  description?: string;
  /** Additional canonical Markdown lines for a new task batch, relative to indent zero. */
  additionalLines?: string[];
  /** Undefined derives the status from `completed`. */
  status?: TaskStatus;
  completed: boolean;
  destination: string;
  indent: number;
  /** Put the whole line's properties in the usual order when saving (the task editor and cards do). */
  sortProperties?: boolean;
}

/** The view a smart list narrows, when it was made from one (View options › Convert to smart list). */
export type SmartListScope = { mode: "inbox" | "today" | "upcoming" } | { mode: "project"; path: string } | { mode: "tag"; tag?: string; path?: string };

export interface SmartList {
  id: string;
  name: string;
  filters: TaskFilter[];
  sort: TaskSort;
  descending: boolean;
  grouping: TaskGrouping;
  /** View options › Projects: false when the list leaves out the projects it matches (they show by default). */
  showProjects?: boolean;
  /** The view whose tasks it filters; without one, every task. */
  scope?: SmartListScope;
}

/** How a task view lays its tasks out (list, calendar or board), or the Projects view its projects (list, board or Gantt). */
export type ViewLayout = "list" | "calendar" | "kanban" | "gantt";

/** A view's calendar and Gantt periods, kept between visits: the calendar's scope, and the Gantt's zoom (or the range it was zoomed to). */
export interface ViewPeriod {
  calendarScope?: import("./calendar").CalendarScope;
  ganttZoom?: import("./gantt").GanttZoom;
  /** Pixels per day, when the Gantt was zoomed to a range between its zooms. */
  ganttScale?: number;
}

/** A view's View options, kept between visits. */
export interface SavedViewOptions {
  filters: TaskFilter[];
  sort: TaskSort;
  descending: boolean;
  grouping: TaskGrouping;
  /** False when the view leaves out the projects it matches. */
  showProjects?: boolean;
}

export type FileSortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse" | "byCreatedTime" | "byCreatedTimeReverse";

/**
 * The order the task sidebar's items were dragged into: projects by path, tags by name, and each folder's files and
 * folders by name (keyed by the folder's path, "/" for the vault's top). What is not listed follows, in the usual order.
 */
export interface NavOrder { projects: string[]; tags: string[]; files: Record<string, string[]> }

export interface TaskManagerSettings {
  smartLists: SmartList[];
  taskMode: boolean;
  linkDates: boolean;
  /** How task tags are written, and the only form read as one: `#tag` ("hash") or `#[[tag]]` ("wikilink"). */
  tagFormat: "hash" | "wikilink";
  dateFormat: string;
  /** Format used before a pending date-token migration. */
  previousDateFormat?: string;
  sectionHeadingLevel: number;
  /** List subtasks as their own rows under their task; otherwise they live in the task's card. */
  showSubtasks: boolean;
  /** Tint calendar task cards with their project's colour. */
  calendarProjectColors: boolean;
  /** Colour calendar task checkboxes by priority. */
  calendarPriorityColors: boolean;
  inboxPath: string;
  /** The folder new projects are created in, without slashes at either end; empty for the vault root. */
  projectFolder: string;
  /** The Convert to project command also moves the note into the project folder. */
  moveConvertedProjects: boolean;
  newTaskPosition: "top" | "bottom";
  showUndoNotices: boolean;
  density: "comfortable" | "compact";
  /** The task sidebar's sections left out of it (its files show by showFiles). */
  hiddenSidebarSections: SidebarSection[];
  /** List the vault's files and folders in the task sidebar, below its lists. */
  showFiles: boolean;
  /** How the sidebar's file tree orders files, named as the file explorer names its orders. */
  fileSortOrder: FileSortOrder;
  /** The file tree follows the order its files were dragged into (navOrder.files), then fileSortOrder. */
  customFileOrder: boolean;
  /**
   * The task sidebar's Favorites, in order: a list ("mode:today"), a smart list ("list:<id>"), a project
   * ("project:<path>"), a tag ("tag:<name>"), a file ("file:<path>") or a folder ("folder:<path>").
   */
  favorites: string[];
  /** The order the task sidebar's projects, tags and files were dragged into. */
  navOrder: NavOrder;
  /** How task lists and task properties look, after the app each style is modelled on. */
  style: "griply" | "things";
  /**
   * Where an opened task shows its details: "view" (two panes) as a card in its list (Things) or in the task editor
   * (Griply); "sidebar" (three panes) only in the Task Details sidebar.
   */
  taskDetails: "view" | "sidebar";
  /** Stamp tasks with the date they were completed. */
  completionDates: boolean;
  /** Where completing a task moves it in its note, and reopening it moves it back (see completed-placement.ts). */
  completedPlacement: import("./completed-placement").CompletedPlacement;
  /** The heading completed tasks move under with completedPlacement "section", at the section heading level. */
  completedSection: string;
  /** How a group of a note's tasks is named: by the note's name alone, or by its path in the vault ("Folder/Note"). */
  noteGroupLabel: "path" | "name";
  /** Projects whose description card is folded on their page. */
  foldedDescriptions: string[];
  /** Each view's View options, by view: "today", "project:Projects/Site.md", "tag:errand" or "tag:Errands.md". */
  viewOptions: Record<string, SavedViewOptions>;
  /** Each view's layout other than a list, by view as for its options, plus "smartList:<id>" and "projects" (the Projects list's). */
  viewLayouts: Record<string, ViewLayout>;
  /** Each view's calendar scope and Gantt range other than the defaults (a month, or four days on a phone; a year), by view as for its layout. */
  viewPeriods: Record<string, ViewPeriod>;
  /** Folders and notes whose tasks are left out of every view. */
  ignoredPaths: string[];
  /** Tags whose notes (frontmatter) and tasks are left out of every view. */
  ignoredTags: string[];
  /** The tag, such as "task", without which a checklist item is not a task; empty: every checklist item is one. */
  taskTag: string;
  /** Leave out tasks inside fenced code blocks; when off, they are read like any other task. */
  ignoreCodeBlockTasks: boolean;
  /** Set once the task sidebar and Task Details have opened on first run; closed later, they stay closed. */
  panelsPlaced: boolean;
  /**
   * What the Task Details sidebar lists while no task is shown: "context" (Smart Context, which follows the view or note
   * in front), "upcoming", "today", "inbox", "all", a smart list as "smartList:<id>", a project as "project:<path>" or a
   * tag as "tag:<name>".
   */
  sidebarIdleView: string;
}

/** The task sidebar's sections, in its order, which settings can leave out: Favorites, the lists (All Tasks with the
 * smart lists under it), Projects and Tags. */
export const SIDEBAR_SECTIONS = ["favorites", "inbox", "today", "upcoming", "all", "projects", "tags"] as const;
export type SidebarSection = typeof SIDEBAR_SECTIONS[number];

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  smartLists: [],
  taskMode: false,
  linkDates: false,
  tagFormat: "hash",
  dateFormat: "",
  sectionHeadingLevel: 1,
  showSubtasks: false,
  calendarProjectColors: true,
  calendarPriorityColors: true,
  inboxPath: "Inbox.md",
  projectFolder: "",
  moveConvertedProjects: false,
  newTaskPosition: "top",
  showUndoNotices: false,
  density: "compact",
  hiddenSidebarSections: [],
  showFiles: true,
  fileSortOrder: "alphabetical",
  customFileOrder: false,
  favorites: [],
  navOrder: { projects: [], tags: [], files: {} },
  style: "griply",
  taskDetails: "sidebar",
  completionDates: true,
  completedPlacement: "keep",
  completedSection: "Task Log",
  noteGroupLabel: "name",
  foldedDescriptions: [],
  viewOptions: {},
  viewLayouts: {},
  viewPeriods: {},
  ignoredPaths: [],
  ignoredTags: [],
  taskTag: "",
  ignoreCodeBlockTasks: true,
  panelsPlaced: false,
  sidebarIdleView: "context"
};

export type TaskEditorPreset = Partial<Omit<TaskDraft, "indent">>;
