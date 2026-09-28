import type { Task } from "./types";

/** Folders, notes and tags whose tasks the plugin leaves out of every view. */
export interface IgnoreRules {
  /** Folders ("Templates" or "Templates/") and notes ("Journal/Private" or "Journal/Private.md"). */
  paths: string[];
  /** Tag names, with or without "#"; "archive" also covers "archive/2025". */
  tags: string[];
}

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

/** The task's tags (`#[[tag]]`) and any inline `#tag` in its text. */
function taskTagNames(task: Task): string[] {
  const inline = [...task.raw.matchAll(/(?:^|\s)#(?!\[\[)([^\s#[\]]+)/gu)].map(match => match[1]);
  return [...(task.tags ?? []), ...inline];
}

/**
 * Drops tasks carrying an ignored tag, together with their subtasks, and removes the dropped
 * tasks from the remaining ones' child lists. Returns the input array when nothing is dropped.
 */
export function visibleTasks(tasks: Task[], ignoredTags: readonly string[]): Task[] {
  if (!ignoredTags.length) return tasks;
  const dropped = new Set<string>();
  for (const task of tasks) {
    if ((task.parentId && dropped.has(task.parentId)) || taskTagNames(task).some(tag => isIgnoredTag(tag, ignoredTags))) dropped.add(task.id);
  }
  if (!dropped.size) return tasks;
  return tasks.filter(task => !dropped.has(task.id)).map(task => task.childIds.some(id => dropped.has(id))
    ? { ...task, childIds: task.childIds.filter(id => !dropped.has(id)) } : task);
}
