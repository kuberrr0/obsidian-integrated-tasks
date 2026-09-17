import { setIcon } from "obsidian";

export function renderDescriptionIndicator(parent: HTMLElement, description?: string): void {
  if (!description?.trim()) return;
  const icon = parent.createSpan({ cls: "tm-description-indicator", attr: {
    role: "img", "aria-label": "Has description", title: "Has description"
  } });
  setIcon(icon, "align-left");
}
