import { findInputDate, findInputDeadline } from "./date";
import { parseTaskInput, serializeTask, type ParsedTaskLine } from "./parser";
import type { TaskDraft } from "./types";

const width = (line: string): number => [...(/^[ \t]*/.exec(line)?.[0] ?? "")].reduce((total, char) => total + (char === "\t" ? 4 : 1), 0);

/** Parse a new task batch, retaining description bullets and relative indentation. */
export function parseTaskTreeInput(input: string, destination: string, reference = new Date(), dateFormat?: string, linkDates = true): TaskDraft {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  if (/^\s*[-+*]\s+\[[ xX]\]\s*$/.test(lines[0])) throw new Error("Enter a title for the main task.");
  const first = parseTaskInput(lines[0], reference, dateFormat);
  if (!first?.title) throw new Error("Enter a title for the main task.");
  const rootIndent = width(lines[0]);
  const main: TaskDraft = { ...first, indent: 0, destination: first.destination ?? destination };
  const additionalLines: string[] = [];
  let descriptionIndent: number | undefined;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { additionalLines.push(""); continue; }
    const indent = width(line) - rootIndent;
    if (indent < 0) throw new Error(`Line ${index + 1} must not be less indented than the main task.`);
    const text = line.trimStart();
    const checkbox = /^[-+*]\s+\[[ xX]\](?:\s|$)/.test(text);
    const bullet = /^[-+*]\s+/.test(text);
    if (!checkbox && ((bullet && indent > 0) || (descriptionIndent !== undefined && indent > descriptionIndent))) {
      additionalLines.push(" ".repeat(indent) + text);
      if (bullet) descriptionIndent = indent;
      continue;
    }
    if (/^(?:#{1,6}\s|`{3,}|~{3,})/.test(text)) throw new Error(`Line ${index + 1}: enter a task or an indented description bullet.`);
    const taskText = checkbox ? text.replace(/^[-+*]/, "-") : text.replace(/^[-+*]\s+/, "");
    if (/^-\s+\[[ xX]\]\s*$/.test(taskText)) throw new Error(`Enter a task title on line ${index + 1}.`);
    const parsed = parseTaskInput(taskText, reference, dateFormat);
    if (!parsed?.title) throw new Error(`Enter a task title on line ${index + 1}.`);
    if (parsed.destination && parsed.destination !== main.destination) throw new Error(`Line ${index + 1}: tasks in this batch must use the main task's destination.`);
    additionalLines.push(serializeTask({ ...parsed, indent, destination: main.destination }, dateFormat, linkDates));
    descriptionIndent = undefined;
  }
  if (additionalLines.length) main.additionalLines = additionalLines;
  return main;
}

/**
 * Re-parse an edited task line strictly; natural-language dates are read only from text the user
 * newly typed (the span between the unchanged prefix and suffix), so existing prose such as
 * "Buy sun cream" or "Done last Friday" is never reinterpreted.
 */
export function parseEditedTaskInput(text: string, original: string, reference = new Date(), dateFormat?: string, checkbox = "- [ ] "): ParsedTaskLine | undefined {
  const strict = parseTaskInput(checkbox + text, reference, dateFormat, false);
  let from = 0;
  const shortest = Math.min(text.length, original.length);
  while (from < shortest && text[from] === original[from]) from++;
  let to = text.length;
  for (let originalTo = original.length; to > from && originalTo > from && text[to - 1] === original[originalTo - 1]; originalTo--) to--;
  if (!strict || !text.slice(from, to).trim()) return strict;
  const within = { from, to };
  const deadline = strict.deadline ? undefined : findInputDeadline(text, reference, dateFormat, within);
  const scheduled = strict.scheduledDate ? undefined : findInputDate(text, reference, within);
  if (!deadline && !scheduled) return strict;
  let cleaned = text;
  for (const match of [deadline, scheduled].filter(match => match !== undefined).sort((a, b) => b.index - a.index)) {
    const before = cleaned.slice(0, match.index).trimEnd();
    const after = cleaned.slice(match.index + match.text.length).trimStart();
    cleaned = before && after ? `${before} ${after}` : before + after;
  }
  const parsed = parseTaskInput(checkbox + cleaned, reference, dateFormat, false);
  if (!parsed) return parsed;
  if (deadline && !parsed.deadline) Object.assign(parsed, { deadline: deadline.date }, deadline.time ? { deadlineTime: deadline.time } : {});
  if (scheduled && !parsed.scheduledDate) Object.assign(parsed, { scheduledDate: scheduled.date }, scheduled.time ? { scheduledTime: scheduled.time } : {});
  return parsed;
}
