import { setIcon } from "obsidian";

export interface Choice {
  value: string;
  label: string;
  /** Muted text after the label. */
  detail?: string;
  icon?: string;
  /** Extra class on the option, e.g. to colour its icon. */
  cls?: string;
  /** A colour for the icon (a project's colour). */
  color?: string;
  /** Draw a separator above this option. */
  separated?: boolean;
}

export interface ChoicePopoverOptions {
  anchor: HTMLElement;
  label: string;
  choices: Choice[];
  selected?: string;
  choose: (value: string) => void;
}

let open: { close(): void } | undefined;

/**
 * A small list beside an element, styled like the view options dropdown: the current choice is
 * checked; clicking one (or Enter) picks it and closes. Arrows move, Escape or a click outside closes.
 */
export function openChoicePopover(options: ChoicePopoverOptions): { element: HTMLElement; close(): void } {
  open?.close();
  const doc = options.anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const element = doc.body.createDiv({ cls: "tm-options-dropdown tm-choice-popover", attr: { role: "listbox", "aria-label": options.label } });
  const items: HTMLElement[] = [];
  for (const choice of options.choices) {
    if (choice.separated) element.createDiv({ cls: "tm-options-separator", attr: { role: "presentation" } });
    const selected = choice.value === options.selected;
    const item = element.createDiv({ cls: `tm-options-option${choice.cls ? ` ${choice.cls}` : ""}`, attr: { role: "option", tabindex: "-1", "aria-selected": String(selected), "data-value": choice.value } });
    const label = item.createSpan({ cls: "tm-options-option-label tm-choice-label" });
    if (choice.icon) {
      const icon = label.createSpan({ cls: "tm-choice-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, choice.icon);
      if (choice.color) icon.style.color = choice.color;
    }
    label.createSpan({ text: choice.label });
    if (choice.detail) label.createSpan({ cls: "tm-choice-detail", text: choice.detail });
    const check = item.createSpan({ cls: "tm-options-check", attr: { "aria-hidden": "true" } });
    if (selected) setIcon(check, "check");
    item.addEventListener("click", () => pick(choice.value));
    items.push(item);
  }

  const pick = (value: string): void => { close(); options.choose(value); };
  element.addEventListener("keydown", event => {
    const index = items.indexOf(event.target as HTMLElement);
    const move = (to: number): void => { items[(to + items.length) % items.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? items.length - 1 : index - 1);
    else if ((event.key === "Enter" || event.key === " ") && index >= 0) pick(items[index].getAttribute("data-value")!);
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault(); event.stopPropagation();
  });

  // Below the anchor when there is room, otherwise above, and always inside the window.
  const anchor = options.anchor.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const margin = 8;
  const top = anchor.bottom + 4 + box.height <= win.innerHeight - margin ? anchor.bottom + 4 : anchor.top - 4 - box.height;
  element.style.top = `${Math.max(margin, top)}px`;
  element.style.left = `${Math.max(margin, Math.min(anchor.left, win.innerWidth - box.width - margin))}px`;

  const outside = (event: PointerEvent): void => { if (!element.contains(event.target as Node)) close(); };
  doc.addEventListener("pointerdown", outside, true);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", outside, true);
    element.remove();
    if (open === handle) open = undefined;
    if (options.anchor.isConnected) options.anchor.focus({ preventScroll: true });
  }
  const handle = { element, close };
  open = handle;
  (items.find(item => item.getAttribute("aria-selected") === "true") ?? items[0])?.focus();
  return handle;
}

/** P1–P3 with their colours, and No priority below. */
export const PRIORITY_CHOICES: Choice[] = [
  { value: "1", label: "P1", detail: "High", icon: "signal", cls: "is-p1" },
  { value: "2", label: "P2", detail: "Medium", icon: "signal", cls: "is-p2" },
  { value: "3", label: "P3", detail: "Low", icon: "signal", cls: "is-p3" },
  { value: "", label: "No priority", separated: true }
];
