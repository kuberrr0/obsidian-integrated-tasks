import { bodyLines, nonBodyLines, scanSections, type NoteHeading } from "./structure";
import { rewriteTaskLine } from "./parser";
import type { Task, TaskDraft, TaskManagerSettings } from "./types";

export function lineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Per-note structure used to verify a task snapshot; compute once per content when locating many tasks. */
export interface LineContext { nonBody: Set<number>; sections: NoteHeading[] }

export function lineContext(lines: readonly string[], sectionHeadingLevel = 1): LineContext {
  return { nonBody: nonBodyLines(lines), sections: scanSections(lines, sectionHeadingLevel) };
}

/** Name of the section heading nearest above a line. */
function sectionAt(sections: NoteHeading[], line: number): string | undefined {
  let low = 0;
  let high = sections.length - 1;
  let found: NoteHeading | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sections[middle].line < line) { found = sections[middle]; low = middle + 1; } else high = middle - 1;
  }
  return found?.name;
}

/**
 * Locate a task snapshot in current lines without guessing between identical duplicates:
 * the stored line wins only when it still sits in the task's section; otherwise one
 * section-consistent match (or the only match) is used, and anything else is refused.
 */
export function findLiveLine(lines: string[], task: Task, sectionHeadingLevel = 1, context?: LineContext): number {
  const { nonBody, sections } = context ?? lineContext(lines, sectionHeadingLevel);
  const consistent = (line: number): boolean => sectionAt(sections, line) === task.section;
  if (lines[task.line] === task.raw && !nonBody.has(task.line) && consistent(task.line)) return task.line;
  const matches: number[] = [];
  lines.forEach((line, index) => { if (line === task.raw && !nonBody.has(index)) matches.push(index); });
  const inSection = matches.filter(consistent);
  if (inSection.length === 1) return inSection[0];
  if (!inSection.length && matches.length === 1) return matches[0];
  throw new Error("The task changed in its note. Refresh the view and try again.");
}

export function toggleTaskInContent(content: string, task: Task, completed: boolean, sectionHeadingLevel = 1): string {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task, sectionHeadingLevel);
  lines[liveLine] = lines[liveLine].replace(/^(\s*-\s+\[)[ xX](\])/, `$1${completed ? "x" : " "}$2`);
  return lines.join(eol);
}

export function updateTaskInContent(content: string, task: Task, draft: TaskDraft, dateFormat?: string, linkDates = true, sectionHeadingLevel = 1): string {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task, sectionHeadingLevel);
  lines[liveLine] = rewriteTaskLine(lines[liveLine], { ...draft, indent: task.indent }, dateFormat, linkDates);
  return lines.join(eol);
}

export function removeLinesFromContent(content: string, start: number, length: number): string {
  const lines = content.split(/\r?\n/);
  lines.splice(start, length);
  return lines.join(lineEnding(content));
}

export function insertIntoDestination(content: string, block: string[], heading?: string, position: TaskManagerSettings["newTaskPosition"] = "top", sectionHeadingLevel = 1): string {
  const eol = lineEnding(content);
  const lines = content ? content.split(/\r?\n/) : [];
  let insertion = 0;
  const headings = scanSections(content, sectionHeadingLevel);
  let scopeEnd = headings[0]?.line ?? lines.length;
  if (heading) {
    const target = headings.find((item) => item.name.toLocaleLowerCase() === heading.toLocaleLowerCase());
    if (!target) throw new Error(`Cannot find heading: ${heading}`);
    insertion = target.endLine + 1;
    scopeEnd = headings.find((item) => item.line > target.line)?.line ?? lines.length;
  } else if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0) throw new Error("The destination has unclosed YAML frontmatter.");
    insertion = end + 1;
  }
  const firstTask = bodyLines(content).find(({ text, line }) =>
    line >= insertion && line < scopeEnd && /^[ \t]*-\s+\[[ xX]\]\s+/.test(text)
  );
  if (firstTask) {
    insertion = firstTask.line;
    const indent = /^[ \t]*/.exec(firstTask.text)![0];
    const width = (value: string): number => [...value].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0);
    const rootWidth = width(indent);
    block = block.map((line) => indent + line);
    if (position === "bottom") {
      let end = insertion + 1;
      for (let cursor = end; cursor < scopeEnd; cursor++) {
        const line = lines[cursor];
        if (!line.trim()) continue;
        const leading = /^[ \t]*/.exec(line)![0];
        const depth = width(leading);
        const listItem = /^[ \t]*(?:[-+*]|\d+[.)])\s+/.test(line);
        if (depth < rootWidth || (depth === rootWidth && !listItem)) break;
        end = cursor + 1;
      }
      insertion = end;
    }
  }
  lines.splice(insertion, 0, ...block);
  return lines.join(eol) + (insertion + block.length === lines.length ? eol : "");
}
