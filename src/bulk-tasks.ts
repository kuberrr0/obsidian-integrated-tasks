import { insertIntoDestination, lineEnding } from "./markdown";
import { liveTaskBlock, rewriteBlock } from "./task-block";
import { serializeTask } from "./parser";
import { splitDestination } from "./structure";
import type { ListPlacement } from "./list-drag";
import type { Task, TaskDraft, TaskManagerSettings } from "./types";

export type BulkTaskPatch = Partial<Pick<TaskDraft, "scheduledDate" | "scheduledTime" | "deadline" | "deadlineTime" | "durationMinutes" | "priority" | "destination">>;
export interface BulkTaskChange { task: Task; draft?: TaskDraft }
export interface BulkTaskOptions {
  delete?: boolean;
  anchor?: Task;
  placement?: ListPlacement;
  position?: TaskManagerSettings["newTaskPosition"];
  dateFormat?: string;
}

/** Plan every write before touching the vault, using original offsets throughout. */
export function planBulkTasks(contents: Map<string, string>, changes: BulkTaskChange[], options: BulkTaskOptions = {}): Map<string, string> {
  const get = (path: string): string => {
    const content = contents.get(path);
    if (content === undefined) throw new Error(`Cannot find note: ${path}`);
    return content;
  };
  const seen = new Set<string>();
  const entries = changes.map(change => {
    const block = liveTaskBlock(get(change.task.path), change.task, options.dateFormat);
    const key = `${change.task.path}:${block.start}`;
    if (seen.has(key)) throw new Error("Selection changed. Select the tasks again.");
    seen.add(key);
    return { ...change, block };
  });
  const contains = (parent: typeof entries[number], child: typeof entries[number]): boolean =>
    parent !== child && parent.task.path === child.task.path && parent.block.start <= child.block.start && parent.block.end > child.block.start;
  const moving = entries.filter(entry => {
    if (options.delete || options.anchor) return true;
    if (!entry.draft) return false;
    const destination = splitDestination(entry.draft.destination);
    return destination.path !== entry.task.path || destination.heading !== entry.task.section;
  });
  const roots = moving.filter(entry => !moving.some(parent => contains(parent, entry)));
  const anchor = options.anchor ? liveTaskBlock(get(options.anchor.path), options.anchor, options.dateFormat) : undefined;
  if (anchor && roots.some(entry => entry.task.path === options.anchor!.path && anchor.start >= entry.block.start && anchor.start < entry.block.end)) {
    throw new Error("Tasks cannot be moved into themselves or their subtasks.");
  }
  const lines = new Map([...contents].map(([path, content]) => [path, content.split(/\r?\n/)]));
  // Apply properties to every explicitly selected task, including selected children.
  if (!options.delete) for (const entry of entries) {
    if (entry.draft) lines.get(entry.task.path)![entry.block.start] = serializeTask({ ...entry.draft, indent: entry.block.indent }, options.dateFormat);
  }
  const payloads = roots.map(entry => ({
    entry,
    lines: options.delete ? [] : rewriteBlock({ ...entry.block, lines: lines.get(entry.task.path)!.slice(entry.block.start, entry.block.end) },
      entry.draft!, anchor ? anchor.indent + (options.placement === "child" ? 2 : 0) : 0, options.dateFormat)
  }));
  for (const [path, fileLines] of lines) {
    for (const entry of roots.filter(item => item.task.path === path).sort((a, b) => b.block.start - a.block.start)) {
      fileLines.splice(entry.block.start, entry.block.end - entry.block.start);
    }
  }
  if (anchor && options.anchor && !options.delete) {
    let insertion = options.placement === "before" ? anchor.start : anchor.end;
    insertion -= roots.filter(entry => entry.task.path === options.anchor!.path && entry.block.end <= insertion)
      .reduce((count, entry) => count + entry.block.end - entry.block.start, 0);
    lines.get(options.anchor.path)!.splice(insertion, 0, ...payloads.flatMap(payload => payload.lines));
  }
  const result = new Map([...lines].map(([path, fileLines]) => [path, fileLines.join(lineEnding(get(path)))]));
  if (!anchor && !options.delete) {
    const destinations = new Map<string, string[]>();
    for (const payload of payloads) {
      const destination = payload.entry.draft!.destination;
      const block = destinations.get(destination) ?? [];
      block.push(...payload.lines);
      destinations.set(destination, block);
    }
    for (const [destination, block] of destinations) {
      const { path, heading } = splitDestination(destination);
      result.set(path, insertIntoDestination(result.get(path) ?? get(path), block, heading, options.position));
    }
  }
  return new Map([...result].filter(([path, content]) => content !== get(path)));
}
