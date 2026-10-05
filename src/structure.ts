export interface NoteHeading {
  name: string;
  line: number;
  endLine: number;
  level: number;
}

/** Markdown body lines, excluding YAML and fenced examples. */
export function bodyLines(content: string | readonly string[]): Array<{ text: string; line: number }> {
  const result: Array<{ text: string; line: number }> = [];
  classifyLines(typeof content === "string" ? content.split(/\r?\n/) : content, (text, line, body) => { if (body) result.push({ text, line }); });
  return result;
}

/** Zero-based numbers of YAML and fenced lines, which hold no tasks. */
export function nonBodyLines(lines: Iterable<string>): Set<number> {
  const result = new Set<number>();
  classifyLines(lines, (_text, line, body) => { if (!body) result.add(line); });
  return result;
}

function classifyLines(lines: Iterable<string>, visit: (text: string, line: number, body: boolean) => void): void {
  let line = 0;
  let frontmatter = false;
  let fence: string | undefined;
  for (const text of lines) {
    const current = line++;
    if (current === 0 && text.trim() === "---") { frontmatter = true; visit(text, current, false); continue; }
    if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(text)) frontmatter = false;
      visit(text, current, false);
      continue;
    }
    // Fences may be indented to any depth inside list items.
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && text.trim() === marker) fence = undefined;
      visit(text, current, false);
      continue;
    }
    // A backtick fence's info string holds no backtick: "```npm i``` first" is inline code.
    if (marker && !(marker[0] === "`" && text.slice(text.indexOf(marker) + marker.length).includes("`"))) {
      fence = marker;
      visit(text, current, false);
      continue;
    }
    visit(text, current, true);
  }
}

export function scanHeadings(content: string | readonly string[]): NoteHeading[] {
  const headings: NoteHeading[] = [];
  const lines = bodyLines(content);
  for (let i = 0; i < lines.length; i++) {
    const { text, line } = lines[i];
    const atx = /^ {0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(text);
    if (atx) {
      headings.push({ name: atx[2].replace(/\s+#+\s*$/, "").trim(), line, endLine: line, level: atx[1].length });
    } else if (/^ {0,3}(=+|-+)\s*$/.test(text) && i > 0) {
      const previous = lines[i - 1];
      if (previous.line === line - 1 && previous.text.trim() && !/^\s*[-*>#]/.test(previous.text)) {
        headings.push({ name: previous.text.trim(), line: line - 1, endLine: line, level: text.trim()[0] === "=" ? 1 : 2 });
      }
    }
  }
  return headings;
}

/** The selected heading level defines task sections and destinations. */
export function scanSections(content: string | readonly string[], level = 1): NoteHeading[] {
  return scanHeadings(content).filter(heading => heading.level === level);
}

/** Headings may contain `|` and `[[links]]`; only a path part carries an alias. */
export function splitDestination(value: string): { path: string; heading?: string } {
  let target = value.trim();
  if (/^~?\[\[/.test(target) && target.endsWith("]]")) target = target.replace(/^~?\[\[/, "").slice(0, -2);
  const separator = target.indexOf("#");
  const path = (separator < 0 ? target : target.slice(0, separator)).split("|", 1)[0].trim();
  const heading = separator < 0 ? undefined : target.slice(separator + 1).trim() || undefined;
  if (!path || /[\r\n]/.test(target)) throw new Error("Enter a destination note.");
  return { path: /\.md$/i.test(path) ? path : `${path}.md`, heading };
}

export function destinationString(path: string, heading?: string): string {
  return `${path}${heading ? `#${heading}` : ""}`;
}

/** Hide the note extension in UI labels without changing stored paths or headings. */
export function destinationLabel(destination: string): string {
  const separator = destination.indexOf("#");
  const path = separator < 0 ? destination : destination.slice(0, separator);
  return path.replace(/\.md$/i, "") + (separator < 0 ? "" : destination.slice(separator));
}
