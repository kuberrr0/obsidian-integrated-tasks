export interface NoteHeading {
  name: string;
  line: number;
  endLine: number;
  level: number;
}

/** Markdown body lines, excluding YAML and fenced examples. */
export function bodyLines(content: string): Array<{ text: string; line: number }> {
  const result: Array<{ text: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  let frontmatter = lines[0]?.trim() === "---";
  let fence: string | undefined;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    if (line === 0 && frontmatter) continue;
    if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(text)) frontmatter = false;
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && text.trim() === marker) fence = undefined;
      continue;
    }
    if (marker) { fence = marker; continue; }
    result.push({ text, line });
  }
  return result;
}

export function scanHeadings(content: string): NoteHeading[] {
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

export function splitDestination(value: string): { path: string; heading?: string } {
  const target = value.trim().replace(/^~?\[\[|\]\]$/g, "").split("|", 1)[0];
  const separator = target.indexOf("#");
  const path = (separator < 0 ? target : target.slice(0, separator)).trim();
  const heading = separator < 0 ? undefined : target.slice(separator + 1).trim() || undefined;
  if (!path || /[\r\n]/.test(target)) throw new Error("Enter a destination note.");
  return { path: /\.md$/i.test(path) ? path : `${path}.md`, heading };
}

export function destinationString(path: string, heading?: string): string {
  return `${path}${heading ? `#${heading}` : ""}`;
}
