import { findLiveLine, lineContext, lineEnding, type LineContext } from "./markdown";
import { rewriteTaskLine, scanTasks } from "./parser";
import { indentWidth, TASK_INDENT } from "./task-indentation";
import type { Task, TaskDraft } from "./types";


/** One parse of a note's current content, shared by every task located in it. */
export interface NoteSnapshot extends LineContext { lines: string[]; tasks: Map<number, Task> }

export function noteSnapshot(path: string, content: string, dateFormat?: string, sectionHeadingLevel = 1): NoteSnapshot {
  const lines = content.split(/\r?\n/);
  const tasks = new Map(scanTasks(path, content, new Date(), dateFormat, sectionHeadingLevel).map(task => [task.line, task]));
  return { lines, tasks, ...lineContext(lines, sectionHeadingLevel) };
}

export interface TaskBlock { start: number; end: number; indent: number; lines: string[]; description?: string; descriptionLines?: number[] }

/** Re-read structure at write time; include nested tasks and their indented notes. */
export function liveTaskBlock(source: string | NoteSnapshot, task: Task, dateFormat?: string, sectionHeadingLevel = 1): TaskBlock {
  const note = typeof source === "string" ? noteSnapshot(task.path, source, dateFormat, sectionHeadingLevel) : source;
  const { lines } = note;
  const start = findLiveLine(lines, task, sectionHeadingLevel, note);
  const live = note.tasks.get(start);
  if (!live) throw new Error("Task is no longer a checklist item. Refresh and try again.");
  let end = start + 1;
  for (let cursor = end; cursor < lines.length; cursor++) {
    if (!lines[cursor].trim()) continue;
    if (indentWidth(lines[cursor]) <= live.indent) break;
    end = cursor + 1;
  }
  if (live.endLine >= end) throw new Error("Task structure changed. Check its indentation in the note before moving it.");
  return { start, end, indent: live.indent, lines: lines.slice(start, end), description: live.description, descriptionLines: live.descriptionLines };
}

/** The indentation a new subtask takes: its first subtask's (2 spaces, a tab…), or one level deeper with none. */
export function subtaskIndent(block: TaskBlock): string {
  const child = block.lines.slice(1).find(line => CHECKLIST.test(line));
  return child ? /^[ \t]*/.exec(child)![0] : /^[ \t]*/.exec(block.lines[0])![0] + " ".repeat(TASK_INDENT);
}

/**
 * Inserts a copy of each task's block (its line, notes and subtasks) right below it. A task inside another
 * copied block is copied with it, once. Block ids (`^id`) are left out of the copies, so links keep their target.
 */
export function duplicateTaskBlocks(content: string, tasks: Task[], dateFormat?: string, sectionHeadingLevel = 1): string {
  const note = noteSnapshot(tasks[0]?.path ?? "", content, dateFormat, sectionHeadingLevel);
  const blocks = tasks.map(task => liveTaskBlock(note, task, dateFormat, sectionHeadingLevel))
    .filter((block, index, all) => !all.some((other, at) => at !== index && other.start <= block.start && block.end <= other.end && (other.start !== block.start || at < index)))
    .sort((a, b) => b.start - a.start);
  const lines = content.split("\n");
  for (const block of blocks) {
    const copy = lines.slice(block.start, block.end).map(line => line.replace(BLOCK_ID, "$1"));
    lines.splice(block.end, 0, ...copy);
  }
  return lines.join("\n");
}

const BLOCK_ID = /\s+\^[A-Za-z0-9-]+(\r?)$/;
const CHECKLIST = /^[ \t]*[-+*]\s+\[[^\]]\]/;

/** Lines moved to the left margin by the first one's indentation (the tabs or spaces it starts with). */
function outdent(lines: string[]): string[] {
  const lead = /^[ \t]*/.exec(lines[0] ?? "")![0];
  return lines.map(line => line.startsWith(lead) ? line.slice(lead.length) : line.trimStart());
}

/**
 * The Markdown of tasks' blocks (each task's line, notes and subtasks) for the clipboard, in the order given, each moved
 * to the left margin. A task inside another's block comes with it, once. `contents` holds each task's note.
 */
export function copiedTaskText(contents: Map<string, string>, tasks: Task[], dateFormat?: string, sectionHeadingLevel = 1): string {
  const notes = new Map<string, NoteSnapshot>();
  const blocks: Array<{ path: string; block: TaskBlock }> = [];
  for (const task of tasks) {
    const content = contents.get(task.path);
    if (content === undefined) continue;
    const note = notes.get(task.path) ?? noteSnapshot(task.path, content, dateFormat, sectionHeadingLevel);
    notes.set(task.path, note);
    blocks.push({ path: task.path, block: liveTaskBlock(note, task, dateFormat, sectionHeadingLevel) });
  }
  const inside = (item: typeof blocks[number]): boolean => blocks.some(other => other !== item && other.path === item.path
    && other.block.start <= item.block.start && item.block.end <= other.block.end && other.block.start !== item.block.start);
  return blocks.filter((item, index) => !inside(item) && blocks.findIndex(other => other.path === item.path && other.block.start === item.block.start) === index)
    .map(({ block }) => outdent(block.lines).join("\n")).join("\n");
}

/**
 * Copied text as lines to insert as tasks: from its first checklist item on, moved to the left margin, without trailing
 * blank lines or block ids (`^id`, which must stay unique). Undefined when it holds no task.
 */
export function pastedTaskLines(text: string): string[] | undefined {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex(line => CHECKLIST.test(line));
  if (first < 0) return undefined;
  const kept = lines.slice(first);
  while (kept.length > 1 && !kept[kept.length - 1].trim()) kept.pop();
  return outdent(kept).map(line => line.replace(BLOCK_ID, "$1"));
}

/** Inserts lines right after a task's block, at the task's indentation, as its next siblings; returns where they start. */
export function insertAfterTask(content: string, task: Task, lines: string[], dateFormat?: string, sectionHeadingLevel = 1): { content: string; line: number } {
  const block = liveTaskBlock(content, task, dateFormat, sectionHeadingLevel);
  const lead = /^[ \t]*/.exec(block.lines[0])![0];
  const all = content.split(/\r?\n/);
  all.splice(block.end, 0, ...lines.map(line => line.trim() ? lead + line : line));
  return { content: all.join(lineEnding(content)), line: block.end };
}

/** Rewrite the task line in place and shift the rest of the block; unchanged indentation (tabs included) is kept. */
export function rewriteBlock(block: TaskBlock, draft: TaskDraft, indent: number, dateFormat?: string, linkDates = true): string[] {
  return [rewriteTaskLine(block.lines[0], { ...draft, indent }, dateFormat, linkDates), ...block.lines.slice(1).map(line => {
    if (!line.trim() || indent === block.indent) return line;
    return " ".repeat(Math.max(0, indentWidth(line) - block.indent + indent)) + line.replace(/^[ \t]*/, "");
  })];
}
