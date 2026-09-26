import { findLiveLine, lineContext, type LineContext } from "./markdown";
import { rewriteTaskLine, scanTasks } from "./parser";
import type { Task, TaskDraft } from "./types";

const indentation = (line: string): number => [...(/^[ \t]*/.exec(line)?.[0] ?? "")].reduce((width, char) => width + (char === "\t" ? 4 : 1), 0);

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
    if (indentation(lines[cursor]) <= live.indent) break;
    end = cursor + 1;
  }
  if (live.endLine >= end) throw new Error("Task structure changed. Check its indentation in the note before moving it.");
  return { start, end, indent: live.indent, lines: lines.slice(start, end), description: live.description, descriptionLines: live.descriptionLines };
}

/** Rewrite the task line in place and shift the rest of the block; unchanged indentation (tabs included) is kept. */
export function rewriteBlock(block: TaskBlock, draft: TaskDraft, indent: number, dateFormat?: string, linkDates = true): string[] {
  return [rewriteTaskLine(block.lines[0], { ...draft, indent }, dateFormat, linkDates), ...block.lines.slice(1).map(line => {
    if (!line.trim() || indent === block.indent) return line;
    return " ".repeat(Math.max(0, indentation(line) - block.indent + indent)) + line.replace(/^[ \t]*/, "");
  })];
}
