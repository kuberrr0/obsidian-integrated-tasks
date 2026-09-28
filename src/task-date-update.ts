import { formatDate } from "./date";
import { parseTaskLine, type ParsedTokenRange } from "./parser";
import { bodyLines } from "./structure";

/** Replace metadata ranges only, preserving prose, whitespace, and line endings. */
export function updateTaskDateTokens(content: string, sourceFormats: string[], targetFormat: string, linkDates: boolean): string {
  const lines = content.split(/(\r?\n)/);
  const formats = [...new Set([...sourceFormats, targetFormat])];
  const reference = new Date();
  for (const { text, line } of bodyLines(content)) {
    const ranges: ParsedTokenRange[] = [];
    const task = parseTaskLine(text, reference, formats[0], false, ranges, formats.slice(1));
    if (!task) continue;
    let updated = text;
    for (const range of ranges.sort((a, b) => b.from - a.from)) {
      if (range.kind === "defer" && task.deferDate) {
        const label = formatDate(task.deferDate, targetFormat);
        updated = updated.slice(0, range.from) + `>${linkDates ? `[[${label}]]` : label}` + updated.slice(range.to);
        continue;
      }
      // The Tasks plugin's `✅ YYYY-MM-DD` keeps its own form.
      if (range.kind === "completedDate" && task.completedDate && !text.startsWith("✅", range.from)) {
        const label = formatDate(task.completedDate, targetFormat);
        updated = updated.slice(0, range.from) + `✓${linkDates ? `[[${label}]]` : label}` + updated.slice(range.to);
        continue;
      }
      if (range.kind !== "scheduledDate" && range.kind !== "deadline") continue;
      const date = task[range.kind];
      if (!date) continue;
      const label = formatDate(date, targetFormat);
      const time = range.kind === "scheduledDate" ? task.scheduledTime : task.deadlineTime;
      const value = `${linkDates ? `[[${label}]]` : label}${time ? ` ${time}` : ""}`;
      updated = updated.slice(0, range.from) + (range.kind === "deadline" ? `{${value}}` : value) + updated.slice(range.to);
    }
    lines[line * 2] = updated;
  }
  return lines.join("");
}
