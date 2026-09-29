/** Tags are wiki-link targets; spaces are allowed within a tag name. */
export function normalizeTags(tags: readonly string[] = []): string[] {
  const normalized = tags.map(tag => tag.trim());
  if (normalized.some(tag => !tag || /[[\]\r\n|]/.test(tag))) {
    throw new Error("Use nonempty tag names without brackets, newlines, or aliases.");
  }
  return [...new Set(normalized)];
}

/** How task tags are written, and the only form read as one: Obsidian's `#tag`, or `#[[tag]]`, a link to a note. */
export type TagFormat = "hash" | "wikilink";

let format: TagFormat = "hash";

/** Set from the Tag format setting when the plugin loads and whenever it changes. */
export function setTagFormat(next: TagFormat): void { format = next; }
export function tagFormat(): TagFormat { return format; }

/** A `#tag` name: letters, digits, `_`, `-` and `/`, with at least one that is not a digit (`#1` is a number). */
const HASH_NAME = "[\\p{L}\\p{N}_\\-/]*[\\p{L}_\\-/][\\p{L}\\p{N}_\\-/]*";

/** The tag that ends a task line, in the chosen format; its name is group 1. */
export function trailingTag(): RegExp {
  return format === "hash" ? new RegExp(`(?:^|\\s)#(${HASH_NAME})\\s*$`, "u") : /(?:^|\s)#\[\[([^[\]\r\n|]+)\]\]\s*$/;
}

/** A tag name as `#tag` writes it: spaces become hyphens ("open house" → `open-house`). */
export function hashTagName(tag: string): string {
  return tag.trim().replace(/\s+/g, "-");
}

export function formatTags(tags: readonly string[] = []): string {
  const names = normalizeTags(tags);
  return (format === "hash" ? [...new Set(names.map(hashTagName))].map(tag => `#${tag}`) : names.map(tag => `#[[${tag}]]`)).join(" ");
}

/** The structured field uses the same syntax as Markdown, in the chosen format. */
export function parseTags(value: string): string[] {
  const tags: string[] = [];
  const pattern = format === "hash" ? new RegExp(`(^|\\s)#(${HASH_NAME})(?=\\s|$)`, "gu") : /()#\[\[([^[\]\r\n|]+)\]\]/g;
  const remaining = value.replace(pattern, (_match, space: string, tag: string) => {
    tags.push(tag);
    return space;
  });
  if (remaining.trim()) throw new Error(format === "hash" ? "Use tags such as #work #client-notes." : "Use tags such as #[[work]] #[[client notes]].");
  return normalizeTags(tags);
}

export interface TaskTagSummary { name: string; openTasks: number; completedTasks: number }

/** Count each task once per tag, including tags found only on completed tasks. */
export function taskTagSummaries(tasks: readonly import("./types").Task[]): TaskTagSummary[] {
  const tags = new Map<string, TaskTagSummary>();
  for (const task of tasks) for (const name of new Set(task.tags ?? [])) {
    const tag = tags.get(name) ?? { name, openTasks: 0, completedTasks: 0 };
    if (task.status === "done") tag.completedTasks++; else if (!task.completed) tag.openTasks++;
    tags.set(name, tag);
  }
  return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
}
