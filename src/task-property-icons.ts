import { getIcon } from "obsidian";

/** Shared by task-mode badges and note-mode pills. */
export const TASK_PROPERTY_ICONS = {
  scheduledDate: "calendar-days",
  deadline: "flag",
  durationMinutes: "clock-3",
  priority: "signal",
  tags: "tag"
} as const;

const masks = new Map<string, string>();

/** CSS masks add a glyph without inserting widgets into editable Markdown. */
export function notePropertyIconStyle(property: keyof typeof TASK_PROPERTY_ICONS): string {
  const name = TASK_PROPERTY_ICONS[property];
  const cached = masks.get(name);
  if (cached) return cached;
  const icon = getIcon(name);
  if (!icon) return "";
  icon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  icon.setAttribute("stroke", "black");
  const style = `--tm-note-token-icon: url("data:image/svg+xml,${encodeURIComponent(icon.outerHTML)}")`;
  masks.set(name, style);
  return style;
}
