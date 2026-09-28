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

export type TaskViewMode = "dashboard" | "inbox" | "today" | "upcoming" | "all" | "projects" | "tags" | "smartLists" | "review";

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
}

export interface SmartList {
  id: string;
  name: string;
  filters: TaskFilter[];
  sort: TaskSort;
  descending: boolean;
  grouping: TaskGrouping;
}

export interface TaskManagerSettings {
  smartLists: SmartList[];
  taskMode: boolean;
  linkDates: boolean;
  dateFormat: string;
  /** Format used before a pending date-token migration. */
  previousDateFormat?: string;
  sectionHeadingLevel: number;
  showGroupTaskCounts: boolean;
  showSubtaskCounts: boolean;
  taskHoverHighlight: "none" | "title" | "background" | "all";
  wrapTaskTitles: boolean;
  wrapCalendarTaskTitles: boolean;
  wrapKanbanTaskTitles: boolean;
  inboxPath: string;
  newTaskPosition: "top" | "bottom";
  showUndoNotices: boolean;
  density: "comfortable" | "compact";
  /** Stamp tasks with the date they were completed. */
  completionDates: boolean;
  /** Weekly review sections marked as reviewed, for the ISO week they were reviewed in. */
  weeklyReview: { week: string; reviewed: string[] };
  /** Folders and notes whose tasks are left out of every view. */
  ignoredPaths: string[];
  /** Tags whose notes (frontmatter) and tasks are left out of every view. */
  ignoredTags: string[];
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  smartLists: [],
  taskMode: false,
  linkDates: false,
  dateFormat: "",
  sectionHeadingLevel: 1,
  showGroupTaskCounts: false,
  showSubtaskCounts: false,
  taskHoverHighlight: "none",
  wrapTaskTitles: true,
  wrapCalendarTaskTitles: false,
  wrapKanbanTaskTitles: true,
  inboxPath: "Inbox.md",
  newTaskPosition: "top",
  showUndoNotices: true,
  density: "comfortable",
  completionDates: false,
  weeklyReview: { week: "", reviewed: [] },
  ignoredPaths: [],
  ignoredTags: []
};

export type TaskEditorPreset = Partial<Omit<TaskDraft, "indent">>;
