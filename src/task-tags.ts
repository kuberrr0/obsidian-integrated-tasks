/** Tags are wiki-link targets; spaces are allowed within a tag name. */
export function normalizeTags(tags: readonly string[] = []): string[] {
  const normalized = tags.map(tag => tag.trim());
  if (normalized.some(tag => !tag || /[[\]\r\n|]/.test(tag))) {
    throw new Error("Use nonempty tag names without brackets, newlines, or aliases.");
  }
  return [...new Set(normalized)];
}

export function formatTags(tags: readonly string[] = []): string {
  return normalizeTags(tags).map(tag => `#[[${tag}]]`).join(" ");
}

/** The structured field uses the same unambiguous syntax as Markdown. */
export function parseTags(value: string): string[] {
  const tags: string[] = [];
  const remaining = value.replace(/#\[\[([^[\]\r\n|]+)\]\]/g, (_match, tag: string) => {
    tags.push(tag);
    return "";
  });
  if (remaining.trim()) throw new Error("Use tags such as #[[work]] #[[client notes]].");
  return normalizeTags(tags);
}

/** Count each task once per tag, including tags found only on completed tasks. */
export function taskTagSummaries(tasks: readonly import("./types").Task[]): Array<{ name: string; openTasks: number; completedTasks: number }> {
  const tags = new Map<string, { name: string; openTasks: number; completedTasks: number }>();
  for (const task of tasks) for (const name of new Set(task.tags ?? [])) {
    const tag = tags.get(name) ?? { name, openTasks: 0, completedTasks: 0 };
    if (task.completed) tag.completedTasks++; else tag.openTasks++;
    tags.set(name, tag);
  }
  return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
}
