export type Priority = 1 | 2 | 3;
/** Stored as the checkbox character: `[ ]`, `[/]`, `[?]`, `[x]`, `[-]`. */
export type TaskStatus = "todo" | "doing" | "waiting" | "done" | "cancelled";

export interface ParsedTaskMetadata {
  title: string;
  scheduledDate?: string;
  scheduledTime?: string;
  deadline?: string;
  deadlineTime?: string;
  /** Hidden from Inbox, Today and Upcoming before this ISO date. */
  deferDate?: string;
  /** Hidden from Inbox, Today and Upcoming until the defer is cleared. */
  someday?: boolean;
  /** Inline repeat rule such as "every week"; completing the task advances its dates in place. */
  repeat?: string;
  /** ISO date the task was completed, when completion dates are recorded. */
  completedDate?: string;
  durationMinutes?: number;
  priority?: Priority;
  tags?: string[];
}

export interface Task extends ParsedTaskMetadata {
  /** Markdown bullets nested beneath this task, excluding child checklists. */
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
};

export interface Project extends ProjectProperties {
  parent?: string;
  parentPath?: string;
  path: string;
  name: string;
  headings?: import("./structure").NoteHeading[];
  openTasks: number;
  completedTasks: number;
  archived: boolean;
}

export type TaskViewMode = "inbox" | "today" | "upcoming" | "all" | "projects" | "tags" | "smartLists";

export interface TaskViewState {
  smartListId?: string;
  tag?: string;
  mode: TaskViewMode;
  projectPath?: string;
  pagePath?: string;
  markdownState?: Record<string, unknown>;
}

export type TaskProperty = "tags" | "title" | "priority" | "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "defer" | "repeat" | "completed" | "duration" | "source" | "section" | "status";
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
  sourcePath?: string;
  priority?: Priority;
  search?: string;
  filters?: TaskFilter[];
  dateFilter?: "dated" | "undated" | "overdue";
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

/** How a task view lays its tasks out (list, calendar or board), or the Projects list its projects (list or Gantt). */
export type ViewLayout = "list" | "calendar" | "kanban" | "gantt";

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
  newTaskPosition: "top" | "bottom";
  showUndoNotices: boolean;
  density: "comfortable" | "compact";
  /** List the vault's files and folders in the task sidebar, below its lists. */
  showFiles: boolean;
  /** How the sidebar's file tree orders files, named as the file explorer names its orders. */
  fileSortOrder: FileSortOrder;
  /** How task lists and task properties look, after the app each style is modelled on. */
  style: "griply" | "things";
  /** Stamp tasks with the date they were completed. */
  completionDates: boolean;
  /** Each view's View options, by view: "today", "project:Projects/Site.md", "tag:errand" or "tag:Errands.md". */
  viewOptions: Record<string, SavedViewOptions>;
  /** Each view's layout other than a list, by view as for its options, plus "smartList:<id>" and "projects" (the Projects list's). */
  viewLayouts: Record<string, ViewLayout>;
  /** Folders and notes whose tasks are left out of every view. */
  ignoredPaths: string[];
  /** Tags whose notes (frontmatter) and tasks are left out of every view. */
  ignoredTags: string[];
}

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
  newTaskPosition: "top",
  showUndoNotices: false,
  density: "comfortable",
  showFiles: false,
  fileSortOrder: "alphabetical",
  style: "things",
  completionDates: false,
  viewOptions: {},
  viewLayouts: {},
  ignoredPaths: [],
  ignoredTags: []
};

export type TaskEditorPreset = Partial<Omit<TaskDraft, "indent">>;
