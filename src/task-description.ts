import { scanTasks, serializeTask } from "./parser";
import type { TaskDraft } from "./types";

/** Store free text as plain bullets; existing bullet nesting remains editable. */
export function descriptionLines(text: string, indent: number): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const expanded = lines.map(line => line.replace(/^\s*/, spaces => spaces.replace(/\t/g, "    ")));
  const margin = Math.min(...expanded.filter(line => line.trim()).map(line => /^ */.exec(line)![0].length));
  return expanded.map(source => {
    const line = source.slice(Number.isFinite(margin) ? margin : 0);
    if (!line.trim()) return "";
    const bullet = /^\s*[-+*]\s+/.test(line);
    const checkbox = /^\s*[-+*]\s+\[[ xX]\](?:\s|$)/.test(line);
    const value = (bullet || /^\s+\S/.test(line)) && !checkbox ? line : `- ${line}`;
    return " ".repeat(indent + 2) + value;
  });
}

/** Keep original line slots until all task edits/moves have resolved their offsets. */
export function replaceDescription(slots: string[][], line: number, ownedLines: number[], text: string, indent: number): void {
  for (const owned of ownedLines) slots[owned] = [];
  slots[line].push(...descriptionLines(text, indent));
}

export function newTaskLines(draft: TaskDraft, dateFormat?: string, linkDates = true): string[] {
  const lines = [serializeTask({ ...draft, indent: 0 }, dateFormat, linkDates), ...(draft.additionalLines ?? [])];
  if (draft.description === undefined) return lines;
  const task = scanTasks("", lines.join("\n"), new Date(), dateFormat)[0];
  const slots = lines.map(line => [line]);
  replaceDescription(slots, 0, task?.descriptionLines ?? [], draft.description, 0);
  return slots.flat();
}
