/** A task just added has this title in its note until one is typed (in its card, or the task sidebar). */
export const NEW_TASK_TITLE = "New To-Do";

/** Display wikilink labels without changing the stored Markdown title. */
export function taskTitleLabel(title: string): string {
  return title.replace(/\[\[([^\][\n]+)\]\]/g, (_match, target: string) => {
    const separator = target.indexOf("|");
    return separator < 0 ? target : target.slice(separator + 1);
  });
}
