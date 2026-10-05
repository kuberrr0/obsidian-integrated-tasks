import { Notice, TFile, type Vault } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { BulkTaskPatch } from "./bulk-tasks";
import { splitDestination } from "./structure";
import { draftWithTitle } from "./task-draft";
import { previewCreatedTask } from "./task-store";
import { NEW_TASK_TITLE } from "./task-title";
import type { Task, TaskDraft } from "./types";

/** The id of a new task not yet written, as it shows in a card or the Task Details sidebar. */
export const NEW_TASK_ID = "tm-new-task";

/**
 * A new task, as the task editor would start it, written only once its title is entered: `task` stands in for it
 * where it would go meanwhile, and `title` and `notes` are what has been typed.
 */
export interface PendingTask { draft: TaskDraft; task: Task; title: string; notes: string }

/** Starts a new task from `draft`, standing in at the place it would take in its note; undefined when it has none. */
export async function startPendingTask(plugin: TaskManagerPlugin, draft: TaskDraft, vault: Vault = plugin.app.vault): Promise<PendingTask | undefined> {
  const path = splitDestination(draft.destination).path;
  const file = vault.getAbstractFileByPath(path);
  const content = file instanceof TFile ? await vault.cachedRead(file) : "";
  const settings = plugin.settings;
  const task = previewCreatedTask(path, content, { ...draft, title: NEW_TASK_TITLE }, {
    dateFormat: plugin.dateFormat(), position: settings.newTaskPosition, linkDates: settings.linkDates, sectionHeadingLevel: settings.sectionHeadingLevel
  });
  // Just before the task now on its line, under an id no written task has.
  return task && { draft, task: { ...task, id: NEW_TASK_ID, line: task.line - 0.5, endLine: task.line - 0.5, childIds: [] }, title: "", notes: "" };
}

/** Changes what the new task will be. It stays where it is shown, its project naming the note it will go to. */
export function patchPendingTask(pending: PendingTask, patch: BulkTaskPatch): void {
  pending.draft = { ...pending.draft, ...patch };
  const { destination, description, ...fields } = patch;
  void destination; void description;
  pending.task = { ...pending.task, ...fields };
}

/**
 * Writes the new task when it has a title (properties typed into it apply, as in the task editor); returns the task
 * written, or undefined when it has no title or could not be written.
 */
export async function writePendingTask(plugin: TaskManagerPlugin, pending: PendingTask): Promise<Task | undefined> {
  if (!pending.title.trim()) return undefined;
  const typed = draftWithTitle(pending.draft, "", pending.title, new Date(), plugin.dateFormat());
  // A title of properties alone ("tomorrow p1") stays the title.
  const draft: TaskDraft = { ...typed, title: typed.title || pending.title.trim(), description: pending.notes.trim() ? pending.notes : undefined };
  const path = splitDestination(draft.destination).path;
  try {
    const line = await plugin.store.create(draft);
    await plugin.index.refreshPath(path);
    return plugin.index.tasksForPath(path).find(task => task.line === line);
  } catch (cause) {
    new Notice(cause instanceof Error ? cause.message : "Could not add the task.");
    return undefined;
  }
}
