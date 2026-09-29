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
  /** Open to the side of the anchor (a menu item), instead of below it. */
  beside?: boolean;
  /** A text field above the choices, focused on opening. */
  input?: ChoiceInput;
}

export interface ChoiceInput {
  placeholder: string;
  /** Typing narrows the choices to those whose label contains the text; Enter picks the first. */
  filter?: boolean;
  /** Reads the typed text as a value of its own ("every 3 days"), shown below the field and picked with Enter. */
  parse?: (text: string) => Choice | undefined;
  /** Shown below the field when typed text cannot be read. */
  invalid?: string;
  /** An option at the end, while text is typed and no choice is named exactly that: "Create project “…”". */
  create?: { label: (text: string) => string; icon?: string; run: (text: string) => void };
}

let open: { close(): void } | undefined;

/**
 * A small list beside an element, styled like the view options dropdown: the current choice is
 * checked; clicking one (or Enter) picks it and closes. Arrows move, Escape or a click outside closes.
 * With an `input`, a field on top searches the choices or reads a typed value.
 */
export function openChoicePopover(options: ChoicePopoverOptions): { element: HTMLElement; close(): void } {
  open?.close();
  const doc = options.anchor.ownerDocument;
  const typed = options.input;
  const element = doc.body.createDiv({ cls: "tm-options-dropdown tm-choice-popover", attr: { role: typed ? "dialog" : "listbox", "aria-label": options.label } });
  const input = typed && element.createEl("input", { type: "text", cls: "tm-options-input", attr: { placeholder: typed.placeholder, "aria-label": typed.placeholder, spellcheck: "false" } });
  const hint = typed?.parse && element.createDiv({ cls: "tm-choice-hint" });
  const list = typed ? element.createDiv({ attr: { role: "listbox", "aria-label": options.label } }) : element;
  const items: HTMLElement[] = [];
  const separators: HTMLElement[] = [];
  for (const choice of options.choices) {
    if (choice.separated) separators.push(list.createDiv({ cls: "tm-options-separator", attr: { role: "presentation" } }));
    const selected = choice.value === options.selected;
    const item = list.createDiv({ cls: `tm-options-option${choice.cls ? ` ${choice.cls}` : ""}`, attr: { role: "option", tabindex: "-1", "aria-selected": String(selected), "data-value": choice.value } });
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
  const create = typed?.create;
  const creating = create && list.createDiv({ cls: "tm-options-option tm-choice-create", attr: { role: "option", tabindex: "-1", "aria-selected": "false" } });
  if (creating) {
    creating.hidden = true;
    const label = creating.createSpan({ cls: "tm-options-option-label tm-choice-label" });
    setIcon(label.createSpan({ cls: "tm-choice-icon", attr: { "aria-hidden": "true" } }), create.icon ?? "plus");
    label.createSpan({ cls: "tm-choice-create-label" });
    creating.addEventListener("click", () => runCreate());
  }
  const runCreate = (): void => {
    const text = input?.value.trim();
    if (!text || !create) return;
    close();
    create.run(text);
  };
  const visible = (): HTMLElement[] => [...items, ...(creating ? [creating] : [])].filter(item => !item.hidden);

  // What the field holds: a search narrows the list; a typed value shows how it reads.
  const parsed = (): Choice | undefined => input?.value.trim() ? typed?.parse?.(input.value.trim()) : undefined;
  const paint = (): void => {
    if (!input) return;
    const text = input.value.trim().toLocaleLowerCase();
    if (typed?.filter) {
      options.choices.forEach((choice, index) => { items[index].hidden = Boolean(text) && !`${choice.label} ${choice.detail ?? ""}`.toLocaleLowerCase().includes(text); });
      for (const separator of separators) separator.hidden = Boolean(text);
    }
    if (creating) {
      const exact = options.choices.some(choice => choice.label.toLocaleLowerCase() === text);
      creating.hidden = !text || exact;
      creating.querySelector(".tm-choice-create-label")!.setText(create!.label(input.value.trim()));
    }
    if (hint) {
      const value = parsed();
      hint.setText(text ? value?.label ?? typed?.invalid ?? "" : "");
      hint.toggleClass("is-invalid", Boolean(text) && !value);
    }
  };
  input?.addEventListener("input", paint);

  const pick = (value: string): void => { close(); options.choose(value); };
  element.addEventListener("keydown", event => {
    if (event.isComposing) return;
    const shown = visible();
    const index = shown.indexOf(event.target as HTMLElement);
    const fromInput = Boolean(input) && event.target === input;
    const move = (to: number): void => { shown[(to + shown.length) % shown.length]?.focus(); };
    if (event.key === "ArrowDown") move(fromInput ? 0 : index + 1);
    else if (event.key === "ArrowUp") {
      if (input && index === 0) input.focus();
      else move(index < 0 ? shown.length - 1 : index - 1);
    }
    else if (event.key === "Enter" && fromInput) {
      // A typed value first; otherwise the first choice the search leaves, or creating one when none does.
      const first = typed?.filter && input!.value.trim() ? shown[0] : undefined;
      const value = parsed()?.value ?? (first && first !== creating ? first.getAttribute("data-value") ?? undefined : undefined);
      if (value !== undefined) pick(value);
      else if (first === creating) runCreate();
    }
    else if ((event.key === "Enter" || (event.key === " " && !fromInput)) && index >= 0) {
      if (shown[index] === creating) runCreate();
      else pick(shown[index].getAttribute("data-value")!);
    }
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault(); event.stopPropagation();
  });

  placePopover(element, options.anchor, options.beside);

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
  if (input) input.focus();
  else (items.find(item => item.getAttribute("aria-selected") === "true") ?? items[0])?.focus();
  return handle;
}

/**
 * Position a fixed popover by its anchor, always inside the window: below it when there is room, otherwise
 * above; or, `beside` it (a menu item's submenu), to its right when there is room, otherwise to its left.
 */
export function placePopover(element: HTMLElement, anchorElement: HTMLElement, beside = false): void {
  const win = element.ownerDocument.defaultView ?? window;
  const anchor = anchorElement.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const margin = 8;
  let top: number, left: number;
  if (beside) {
    left = anchor.right + 4 + box.width <= win.innerWidth - margin ? anchor.right + 4 : anchor.left - 4 - box.width;
    top = Math.min(anchor.top - 6, win.innerHeight - box.height - margin);
  } else {
    top = anchor.bottom + 4 + box.height <= win.innerHeight - margin ? anchor.bottom + 4 : anchor.top - 4 - box.height;
    left = Math.min(anchor.left, win.innerWidth - box.width - margin);
  }
  element.style.top = `${Math.max(margin, top)}px`;
  element.style.left = `${Math.max(margin, left)}px`;
}

/** P1–P3 with their colours, and No priority below. */
export const PRIORITY_CHOICES: Choice[] = [
  { value: "1", label: "P1", detail: "High", icon: "signal", cls: "is-p1" },
  { value: "2", label: "P2", detail: "Medium", icon: "signal", cls: "is-p2" },
  { value: "3", label: "P3", detail: "Low", icon: "signal", cls: "is-p3" },
  { value: "", label: "No priority", separated: true }
];
