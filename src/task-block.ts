import { findLiveLine, lineEnding } from "./markdown";
import { scanTasks, serializeTask } from "./parser";
import type { Task, TaskDraft } from "./types";
import type { ListPlacement } from "./list-drag";

const indentation = (line: string): number => [...(/^[ \t]*/.exec(line)?.[0] ?? "")].reduce((width, char) => width + (char === "\t" ? 4 : 1), 0);

/** Re-read structure at write time; include nested tasks and their indented notes. */
export function liveTaskBlock(content: string, task: Task, dateFormat?: string): { start: number; end: number; indent: number; lines: string[] } {
  const lines = content.split(/\r?\n/);
  const start = findLiveLine(lines, task);
  const live = scanTasks(task.path, content, new Date(), dateFormat).find(candidate => candidate.line === start);
  if (!live) throw new Error("Task is no longer a checklist item. Refresh and try again.");
  let end = start + 1;
  for (let cursor = end; cursor < lines.length; cursor++) {
    if (!lines[cursor].trim()) continue;
    if (indentation(lines[cursor]) <= live.indent) break;
    end = cursor + 1;
  }
  if (live.endLine >= end) throw new Error("Task structure changed. Check its indentation in the note before moving it.");
  return { start, end, indent: live.indent, lines: lines.slice(start, end) };
}
export function rewriteBlock(block: ReturnType<typeof liveTaskBlock>, draft: TaskDraft, indent: number, dateFormat?: string): string[] {
  return [serializeTask({ ...draft, indent }, dateFormat), ...block.lines.slice(1).map(line => {
    if (!line.trim()) return line;
    return " ".repeat(Math.max(0, indentation(line) - block.indent + indent)) + line.replace(/^[ \t]*/, "");
  })];
}
export function placeTaskBlock(content: string, task: Task | undefined, anchor: Task, placement: ListPlacement, block: string[], dateFormat?: string): string {
  const target = liveTaskBlock(content, anchor, dateFormat);
  const source = task ? liveTaskBlock(content, task, dateFormat) : undefined;
  if (source && target.start >= source.start && target.start < source.end) throw new Error("A task cannot be moved into itself or its subtasks.");
  let insertion = placement === "before" ? target.start : target.end;
  const lines = content.split(/\r?\n/);
  if (source) {
    lines.splice(source.start, source.end - source.start);
    if (insertion >= source.end) insertion -= source.end - source.start;
  }
  lines.splice(insertion, 0, ...block);
  return lines.join(lineEnding(content));
}
