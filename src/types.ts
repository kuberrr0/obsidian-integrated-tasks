export type Priority = 1 | 2 | 3;

export interface ParsedTaskMetadata {
  title: string;
  scheduledDate?: string;
  deadline?: string;
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

export type ProjectProperties = Pick<ParsedTaskMetadata, "scheduledDate" | "deadline" | "durationMinutes" | "priority">;

export interface Project extends ProjectProperties {
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

export type TaskSort = "date" | "priority" | "title" | "source" | "duration";
export type TaskGrouping = "default" | "none" | "date" | "priority" | "source" | "status";

export interface TaskQuery {
  mode: TaskViewMode | "project";
  showCompleted: boolean;
  projectPath?: string;
  sourcePath?: string;
  priority?: Priority;
  search?: string;
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
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  inboxPath: "Inbox.md",
  tasksHeading: "Tasks"
};
