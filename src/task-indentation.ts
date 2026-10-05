/** How notes are indented: with tabs or spaces, and how many columns a level (and a tab) takes. */
export interface Indentation { useTab: boolean; tabSize: number }

// Spaces, four to a level, until the plugin reads Obsidian's Editor settings (see useIndentation).
let read = (): Indentation => ({ useTab: false, tabSize: 4 });

/** Follow `source` from now on: Obsidian's "Indent using tabs" and "Tab indent size". */
export function useIndentation(source: () => Indentation): void { read = source; }

/** Columns per indentation level. */
export function indentStep(): number { return read().tabSize; }

/** One level of indentation, as Obsidian would type it. */
export function indentUnit(): string {
  const { useTab, tabSize } = read();
  return useTab ? "\t" : " ".repeat(tabSize);
}

/** Leading whitespace `width` columns wide: tabs for whole levels when Obsidian indents with tabs, else spaces. */
export function indentText(width: number): string {
  if (width <= 0) return "";
  const { useTab, tabSize } = read();
  return useTab ? "\t".repeat(Math.floor(width / tabSize)) + " ".repeat(width % tabSize) : " ".repeat(width);
}

/** How deep a line's leading spaces and tabs reach, a tab counting as Obsidian's tab size. */
export function indentWidth(line: string): number {
  const tabSize = read().tabSize;
  let width = 0;
  for (const char of /^[ \t]*/.exec(line)?.[0] ?? "") width += char === "\t" ? tabSize : 1;
  return width;
}
