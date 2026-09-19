/** Display wikilink labels without changing the stored Markdown title. */
export function taskTitleLabel(title: string): string {
  return title.replace(/\[\[([^\[\]\n]+)\]\]/g, (_match, target: string) => {
    const separator = target.indexOf("|");
    return separator < 0 ? target : target.slice(separator + 1);
  });
}
