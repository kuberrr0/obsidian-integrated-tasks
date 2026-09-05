import { bodyLines, scanHeadings, splitDestination, destinationString } from "./structure";
import { findInputDate, findInputDeadline, formatDate, parseDateTimeExpression } from "./date";
import type { ParsedTaskMetadata, Priority, Task, TaskDraft } from "./types";

const CHECKBOX = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;
const PRIORITY = /(?:^|\s)p([123])\s*$/i;
const DEADLINE = /(?:^|\s)\{([^{}]+)\}\s*$/;
const SCHEDULED = /(?:^|\s)(\[\[([^\]]+)\]\](?:\s+([^{}[\]]+))?)\s*$/;
const DURATION = /(?:^|\s)((?:\d+h)?(?:\d+m)?)\s*$/i;
const DESTINATION = /(?:^|\s)~\[\[([^\]]+)\]\]\s*$/;

export interface ParsedTokenRange {
  kind: "scheduledDate" | "deadline" | "durationMinutes" | "priority";
  from: number;
  to: number;
}

export interface ParsedTaskLine extends ParsedTaskMetadata {
  indent: number;
  completed: boolean;
  destination?: string;
}

function normalizeDestination(value: string): string | undefined {
  try {
    const { path, heading } = splitDestination(value);
    return destinationString(path, heading);
  } catch { return undefined; }
}

function indentWidth(value: string): number {
  return [...value].reduce((total, character) => total + (character === "\t" ? 4 : 1), 0);
}

export function durationToMinutes(value: string): number | undefined {
  if (!value || !/^((\d+)h)?((\d+)m)?$/i.test(value)) return undefined;
  const hours = /([0-9]+)h/i.exec(value)?.[1];
  const minutes = /([0-9]+)m/i.exec(value)?.[1];
  const total = Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return total > 0 ? total : undefined;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h` : ""}${remainder ? `${remainder}m` : ""}`;
}

export function parseTaskLine(
  line: string,
  reference = new Date(),
  dateFormat?: string,
  naturalDates = false,
  tokenRanges?: ParsedTokenRange[]
): ParsedTaskLine | undefined {
  const checkbox = CHECKBOX.exec(line);
  if (!checkbox) return undefined;

  let remainder = checkbox[3].trimEnd();
  const metadata: Omit<ParsedTaskLine, "title" | "indent" | "completed"> = {};
  const consumed = new Set<string>();
  const recordToken = (kind: ParsedTokenRange["kind"], match: RegExpExecArray): void => {
    const offset = line.length - checkbox[3].length;
    tokenRanges?.push({ kind, from: offset + match.index + match[0].search(/\S/), to: offset + remainder.trimEnd().length });
  };

  for (;;) {
    let match: RegExpExecArray | null;
    let changed = false;

    if (!consumed.has("destination") && (match = DESTINATION.exec(remainder))) {
      const destination = normalizeDestination(match[1]);
      if (destination) {
        metadata.destination = destination;
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("destination");
        changed = true;
      }
    } else if (!consumed.has("priority") && (match = PRIORITY.exec(remainder))) {
      metadata.priority = Number(match[1]) as Priority;
      recordToken("priority", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      consumed.add("priority");
      changed = true;
    } else if (!consumed.has("deadline") && (match = DEADLINE.exec(remainder))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormat);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        recordToken("deadline", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("deadline");
        changed = true;
      }
    } else if (!consumed.has("duration") && (match = DURATION.exec(remainder))) {
      const minutes = durationToMinutes(match[1]);
      if (minutes) {
        metadata.durationMinutes = minutes;
        recordToken("durationMinutes", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("duration");
        changed = true;
      }
    } else if (!consumed.has("scheduled") && (match = SCHEDULED.exec(remainder))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormat);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        recordToken("scheduledDate", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("scheduled");
        changed = true;
      }
    }

    if (!changed && naturalDates && !consumed.has("deadline")) {
      const date = findInputDeadline(remainder, reference, dateFormat);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        remainder = `${remainder.slice(0, date.index)} ${remainder.slice(date.index + date.text.length)}`.replace(/ {2,}/g, " ").trim();
        consumed.add("deadline");
        changed = true;
      }
    }

    if (!changed && naturalDates && !consumed.has("scheduled")) {
      const date = findInputDate(remainder, reference);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        remainder = `${remainder.slice(0, date.index)}${remainder.slice(date.index + date.text.length)}`.replace(/ {2,}/g, " ").trim();
        consumed.add("scheduled");
        changed = true;
      }
    }
    if (!changed) break;
  }

  return {
    title: remainder.trim(),
    indent: indentWidth(checkbox[1]),
    completed: checkbox[2].toLowerCase() === "x",
    ...metadata
  };
}

export function parseTaskInput(
  input: string,
  reference = new Date(),
  dateFormat?: string,
  naturalDates = true
): ParsedTaskLine | undefined {
  const normalized = /^\s*-\s+\[[ xX]\]\s+/.test(input) ? input : `- [ ] ${input}`;
  return parseTaskLine(normalized, reference, dateFormat, naturalDates);
}

export function serializeTask(draft: TaskDraft, dateFormat?: string): string {
  const indent = " ".repeat(Math.max(0, draft.indent));
  const title = draft.title.trim();
  const metadata = [
    draft.scheduledDate ? `[[${formatDate(draft.scheduledDate, dateFormat)}]]${draft.scheduledTime ? ` ${draft.scheduledTime}` : ""}` : "",
    draft.durationMinutes ? formatDuration(draft.durationMinutes) : "",
    draft.deadline ? `{[[${formatDate(draft.deadline, dateFormat)}]]${draft.deadlineTime ? ` ${draft.deadlineTime}` : ""}}` : "",
    draft.priority ? `p${draft.priority}` : ""
  ].filter(Boolean);
  const metadataGap = metadata.length ? " " : "";
  return `${indent}- [${draft.completed ? "x" : " "}] ${title}${metadataGap}${metadata.join(" ")}`;
}

export function serializeTaskInput(draft: TaskDraft, dateFormat?: string): string {
  const { path, heading } = splitDestination(draft.destination);
  const destination = destinationString(path.replace(/\.md$/i, ""), heading);
  return `${serializeTask(draft, dateFormat)} ~[[${destination}]]`;
}

export function scanTasks(path: string, content: string, reference = new Date(), dateFormat?: string): Task[] {
  const tasks: Task[] = [];
  const stack: Task[] = [];
  const headings = new Map(scanHeadings(content).map((heading) => [heading.line, heading]));
  let section: ReturnType<typeof scanHeadings>[number] | undefined;

  for (const { text: line, line: lineNumber } of bodyLines(content)) {
    const heading = headings.get(lineNumber);
    if (heading) { section = heading; stack.length = 0; }
    const parsed = parseTaskLine(line, reference, dateFormat);
    if (!parsed) continue;

    while (stack.length && stack[stack.length - 1].indent >= parsed.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const task: Task = {
      id: `${path}:${lineNumber}`,
      path,
      line: lineNumber,
      endLine: lineNumber,
      raw: line,
      section: section?.name,
      sectionLine: section?.line,
      childIds: [],
      parentId: parent?.id,
      ...parsed
    };
    parent?.childIds.push(task.id);
    tasks.push(task);
    stack.push(task);
  }

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    let endLine = task.line;
    for (let candidateIndex = index + 1; candidateIndex < tasks.length; candidateIndex += 1) {
      const candidate = tasks[candidateIndex];
      if (candidate.sectionLine !== task.sectionLine || candidate.indent <= task.indent) break;
      endLine = candidate.line;
    }
    task.endLine = endLine;
  }

  return tasks;
}
