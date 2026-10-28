import type { Task } from "./types";

/** Folders, notes and tags whose tasks the plugin leaves out of every view. */
export function normalizeIgnoredPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export function normalizeIgnoredTag(value: string): string {
  return value.trim().replace(/^#\[\[|\]\]$/g, "").replace(/^#/, "").trim().toLowerCase();
}

/** Split a settings text area into entries, one per line (commas also separate tags). */
export function parseIgnoreList(text: string, tags = false): string[] {
  const entries = text.split(tags ? /[\n,]/ : /\n/).map(entry => tags ? normalizeIgnoredTag(entry) : normalizeIgnoredPath(entry)).filter(Boolean);
  return [...new Set(entries)];
}

/** A note path matches a folder entry anywhere inside it, or a note entry exactly (the ".md" is optional). */
export function isIgnoredPath(path: string, ignored: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return ignored.some(raw => {
    const entry = normalizeIgnoredPath(raw).toLowerCase();
    if (!entry) return false;
    const folder = entry.replace(/\/+$/, "");
    if (lower.startsWith(`${folder}/`)) return true;
    return !entry.endsWith("/") && (lower === entry || lower === `${entry}.md`);
  });
}

export function isIgnoredTag(tag: string, ignored: readonly string[]): boolean {
  const name = normalizeIgnoredTag(tag);
  return ignored.some(raw => {
    const entry = normalizeIgnoredTag(raw);
    return Boolean(entry) && (name === entry || name.startsWith(`${entry}/`));
  });
}

/** Tags in a note's frontmatter `tags` (or `tag`) property, as a list or a comma- or space-separated string. */
export function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
  const values: string[] = [];
  for (const key of ["tags", "tag"]) {
    const value = frontmatter?.[key];
    const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
    for (const item of items) if (typeof item === "string" && item.trim()) values.push(item.trim());
  }
  return values;
}

/** Every tag written in a line of text, in either form: `#tag` and `#[[tag]]`. */
function lineTagNames(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)#(?:\[\[([^[\]\r\n|]+)\]\]|([^\s#[\]]+))/gu)].map(match => match[1] ?? match[2]);
}

/** The task's tags and any other tag in its text. */
function taskTagNames(task: Task): string[] {
  return [...(task.tags ?? []), ...lineTagNames(task.raw)];
}

/**
 * Whether a line counts as a task under the Task tag setting: it carries the tag, or one nested under it, anywhere on
 * the line. With no task tag set, every checklist item does.
 */
export function hasTaskTag(text: string, taskTag: string | undefined): boolean {
  const tag = normalizeIgnoredTag(taskTag ?? "");
  return !tag || lineTagNames(text).some(name => isIgnoredTag(name, [tag]));
}

/**
 * Drops tasks carrying an ignored tag, together with their subtasks, and removes the dropped tasks from the remaining
 * ones' child lists. With a task tag, items without it are dropped too, though not their subtasks: a tagged subtask
 * moves up to the nearest task above it. Returns the input array when nothing is dropped.
 */
export function visibleTasks(tasks: Task[], ignoredTags: readonly string[], taskTag = ""): Task[] {
  const tag = normalizeIgnoredTag(taskTag);
  if (!ignoredTags.length && !tag) return tasks;
  const dropped = new Set<string>();
  const untracked = new Set<string>();
  for (const task of tasks) {
    if ((task.parentId && dropped.has(task.parentId)) || taskTagNames(task).some(name => isIgnoredTag(name, ignoredTags))) dropped.add(task.id);
    else if (!hasTaskTag(task.raw, tag)) untracked.add(task.id);
  }
  if (!dropped.size && !untracked.size) return tasks;
  const byId = new Map(tasks.map(task => [task.id, task]));
  const parentOf = (task: Task): string | undefined => {
    let parent = task.parentId;
    while (parent && untracked.has(parent)) parent = byId.get(parent)?.parentId;
    return parent;
  };
  const kept = tasks.filter(task => !dropped.has(task.id) && !untracked.has(task.id));
  const parents = new Map(kept.map(task => [task.id, parentOf(task)]));
  const children = new Map<string, string[]>();
  for (const task of kept) {
    const parent = parents.get(task.id);
    if (parent) children.set(parent, [...children.get(parent) ?? [], task.id]);
  }
  return kept.map(task => {
    const parentId = parents.get(task.id);
    const childIds = children.get(task.id) ?? [];
    if (parentId === task.parentId && childIds.length === task.childIds.length && childIds.every((id, at) => id === task.childIds[at])) return task;
    const { parentId: _parent, ...rest } = task;
    return { ...rest, ...(parentId ? { parentId } : {}), childIds };
  });
}
