export type Priority = 1 | 2 | 3;

export interface ParsedTaskMetadata {
  title: string;
  scheduledDate?: string;
  scheduledTime?: string;
  deadline?: string;
  deadlineTime?: string;
  durationMinutes?: number;
  priority?: Priority;
}

export interface Task extends ParsedTaskMetadata {
  id: string;
  path: string;
  line: number;
  endLine: number;
  raw: string;
  indent: number;
  completed: boolean;
  section?: string;
  sectionLine?: number;
  parentId?: string;
  childIds: string[];
}

export type ProjectProperties = Pick<ParsedTaskMetadata, "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "durationMinutes" | "priority"> & { endDate?: string };

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

export type TaskViewMode = "inbox" | "today" | "upcoming" | "all" | "projects";

export interface TaskViewState {
  mode: TaskViewMode;
  projectPath?: string;
  pagePath?: string;
  markdownState?: Record<string, unknown>;
}

export type TaskProperty = "title" | "priority" | "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "duration" | "source" | "section" | "status";
export type TaskSort = "date" | TaskProperty;
export type TaskGrouping = "default" | "none" | "date" | TaskProperty;
export type FilterOperator = "has" | "missing" | "is" | "isNot" | "contains" | "before" | "after" | "between";
export interface TaskFilter {
  property: TaskProperty;
  operator: FilterOperator;
  values: string[];
}

export interface TaskQuery {
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
  completed: boolean;
  destination: string;
  indent: number;
}

export interface TaskManagerSettings {
  inboxPath: string;
  tasksHeading: string;
  newTaskPosition: "top" | "bottom";
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  inboxPath: "Inbox.md",
  tasksHeading: "Tasks",
  newTaskPosition: "top"
};

export type TaskEditorPreset = Partial<Omit<TaskDraft, "indent">>;
