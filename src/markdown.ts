import { scanHeadings } from "./structure";
import { serializeTask } from "./parser";
import type { Task, TaskDraft } from "./types";

export function lineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function findLiveLine(lines: string[], task: Task): number {
  if (lines[task.line] === task.raw) return task.line;
  const matches: number[] = [];
  lines.forEach((line, index) => {
    if (line === task.raw) matches.push(index);
  });
  if (!matches.length) throw new Error("The task changed in its note. Refresh the view and try again.");
  return matches.reduce((nearest, candidate) =>
    Math.abs(candidate - task.line) < Math.abs(nearest - task.line) ? candidate : nearest
  );
}

export function toggleTaskInContent(content: string, task: Task, completed: boolean): string {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines[liveLine] = lines[liveLine].replace(/^(\s*-\s+\[)[ xX](\])/, `$1${completed ? "x" : " "}$2`);
  return lines.join(eol);
}

export function updateTaskInContent(content: string, task: Task, draft: TaskDraft, dateFormat?: string): string {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines[liveLine] = serializeTask({ ...draft, indent: task.indent }, dateFormat);
  return lines.join(eol);
}

export function removeTaskBlockFromContent(content: string, task: Task, blockLength: number): string {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines.splice(liveLine, blockLength);
  return lines.join(eol);
}

export function prependToDestination(content: string, block: string[], heading?: string): string {
  const eol = lineEnding(content);
  const lines = content ? content.split(/\r?\n/) : [];
  let insertion = 0;
  if (heading) {
    const target = scanHeadings(content).find((item) => item.name.toLocaleLowerCase() === heading.toLocaleLowerCase());
    if (!target) throw new Error(`Cannot find heading: ${heading}`);
    insertion = target.endLine + 1;
  } else if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0) throw new Error("The destination has unclosed YAML frontmatter.");
    insertion = end + 1;
  }
  lines.splice(insertion, 0, ...block);
  return lines.join(eol) + (insertion + block.length === lines.length ? eol : "");
}
