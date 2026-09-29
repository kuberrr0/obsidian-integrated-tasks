import { setIcon } from "obsidian";
import { addDays } from "./calendar";
import { nextWeek } from "./date-popover";
import { placePopover } from "./choice-popover";

type Priority = 1 | 2 | 3;

/** A row that opens its own popover beside the menu, such as Project or Tags. */
export interface TaskMenuSubmenu {
  label: string;
  icon: string;
  /** The key that opens it while the menu is open: "g", or "D" for Shift+D. */
  key: string;
  open: (anchor: HTMLElement) => void;
}

/** A button in a row of icons: `run` applies at once and closes the menu, `open` opens a popover beside it. */
export interface ActionIcon {
  label: string;
  icon?: string;
  /** Text in place of an icon, such as "!!!". */
  text?: string;
  cls: string;
  active?: boolean;
  run?: () => void;
  open?: (anchor: HTMLElement) => void;
  /** The row's letter clicks this button (otherwise it focuses the first). */
  shortcut?: boolean;
}

export type ActionMenuEntry =
  | { kind: "item"; label: string; icon: string; run: () => void; danger?: boolean }
  | ({ kind: "submenu" } & TaskMenuSubmenu)
  | { kind: "icons"; label: string; key: string; buttons: ActionIcon[] }
  | { kind: "separator" };

export interface ActionMenuOptions {
  doc: Document;
  /** Where the menu opens: the pointer, or a row's corner. */
  at: { x: number; y: number };
  label: string;
  entries: ActionMenuEntry[];
  /** Focused again when the menu closes with focus inside it (the row it acts on). */
  returnFocus?: HTMLElement;
  onClose?: () => void;
}

export interface TaskMenuOptions {
  doc: Document;
  at: { x: number; y: number };
  today: string;
  /** Every task the menu acts on is complete: it offers Reopen instead of Complete. */
  completed: boolean;
  /** The scheduled date and priority every task shares, marked in their rows. */
  scheduled?: string;
  priority?: Priority;
  complete: () => void;
  schedule: (date: string) => void;
  /** Opens the date popover beside the menu for any other date, time or duration. */
  pickDate: (anchor: HTMLElement) => void;
  setPriority: (priority: Priority | undefined) => void;
  submenus: TaskMenuSubmenu[];
  duplicate: () => void;
  delete: () => void;
  returnFocus?: HTMLElement;
}

export interface TaskMenu {
  element: HTMLElement;
  close(): void;
}

let open: TaskMenu | undefined;

/** Popovers a submenu opens: working in them is not a click outside the menu. */
const SUBMENUS = ".tm-choice-popover, .tm-date-popover, .tm-tags-popover";

/** "D" for d, "⇧D" for Shift+D. */
function shortcutLabel(key: string): string {
  return key === key.toLowerCase() ? key.toUpperCase() : `⇧${key}`;
}

/** P1–P3 as "!!!", "!!" and "!"; choosing the priority already set takes it off. */
export function priorityIcons(current: Priority | undefined, set: (priority: Priority | undefined) => void): ActionIcon[] {
  return ([1, 2, 3] as const).map(priority => {
    const active = current === priority;
    return { label: active ? `Remove P${priority}` : `P${priority}`, text: "!".repeat(4 - priority), cls: `is-p${priority}`, active, run: () => set(active ? undefined : priority) };
  });
}

/**
 * A task's right-click menu, as in Things and TickTick: Complete; the date and priority as rows of icons
 * that apply at once; rows that open a popover beside the menu (project, deadline, tags…); Duplicate and Delete.
 */
export function openTaskMenu(options: TaskMenuOptions): TaskMenu {
  const today = options.today;
  const quick: Array<[string, string, string, string]> = [
    ["Today", "calendar", "is-today", today],
    ["Tomorrow", "sunrise", "is-tomorrow", addDays(today, 1)],
    ["Next week", "square-arrow-right", "is-next-week", nextWeek(today)]
  ];
  return openActionMenu({
    doc: options.doc, at: options.at, label: "Task actions", returnFocus: options.returnFocus,
    entries: [
      { kind: "item", icon: options.completed ? "rotate-ccw" : "circle-check", label: options.completed ? "Reopen" : "Complete", run: options.complete },
      { kind: "separator" },
      { kind: "icons", label: "Date", key: "d", buttons: [
        ...quick.map(([label, icon, cls, date]): ActionIcon => ({ label, icon, cls, active: options.scheduled === date, run: () => options.schedule(date) })),
        { label: "Pick a date", icon: "calendar-search", cls: "is-custom", open: options.pickDate, shortcut: true }
      ] },
      { kind: "icons", label: "Priority", key: "p", buttons: priorityIcons(options.priority, options.setPriority) },
      { kind: "separator" },
      ...options.submenus.map((submenu): ActionMenuEntry => ({ kind: "submenu", ...submenu })),
      { kind: "separator" },
      { kind: "item", icon: "copy", label: "Duplicate", run: options.duplicate },
      { kind: "item", icon: "trash-2", label: "Delete", run: options.delete, danger: true }
    ]
  });
}

/**
 * A menu of actions at the pointer: items that act and close it, rows of icons, and rows that open a popover
 * beside it. Arrow keys move between items, each row's letter opens it, Escape or a click outside closes.
 * One menu is open at a time.
 */
export function openActionMenu(options: ActionMenuOptions): TaskMenu {
  open?.close();
  const { doc } = options;
  const element = doc.body.createDiv({ cls: "tm-task-menu", attr: { role: "menu", "aria-label": options.label } });
  const shortcuts = new Map<string, () => void>();
  const act = (run: () => void): void => { close(); run(); };

  const item = (icon: string, label: string, run: () => void, cls = ""): HTMLButtonElement => {
    const button = element.createEl("button", { cls: `tm-task-menu-item${cls ? ` ${cls}` : ""}`, attr: { type: "button", role: "menuitem" } });
    setIcon(button.createSpan({ cls: "tm-task-menu-icon", attr: { "aria-hidden": "true" } }), icon);
    button.createSpan({ cls: "tm-task-menu-label", text: label });
    button.addEventListener("click", run);
    return button;
  };
  const shortcut = (parent: HTMLElement, key: string): void => { parent.createSpan({ cls: "tm-task-menu-shortcut", text: shortcutLabel(key) }); };

  for (const entry of options.entries) {
    if (entry.kind === "separator") element.createDiv({ cls: "tm-task-menu-separator", attr: { role: "separator" } });
    else if (entry.kind === "item") item(entry.icon, entry.label, () => act(entry.run), entry.danger ? "is-danger" : "");
    else if (entry.kind === "submenu") {
      const button = item(entry.icon, entry.label, () => entry.open(button), "has-submenu");
      button.setAttribute("aria-haspopup", "true");
      shortcut(button, entry.key);
      setIcon(button.createSpan({ cls: "tm-task-menu-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
      shortcuts.set(entry.key, () => button.click());
    } else {
      const heading = element.createDiv({ cls: "tm-task-menu-heading" });
      heading.createSpan({ text: entry.label });
      shortcut(heading, entry.key);
      const row = element.createDiv({ cls: "tm-task-menu-icons", attr: { role: "group", "aria-label": entry.label } });
      const buttons = entry.buttons.map(icon => {
        const button = row.createEl("button", { cls: `tm-task-menu-icon-button ${icon.cls}`, attr: { type: "button", role: "menuitemradio", "aria-label": icon.label, title: icon.label, "aria-checked": String(Boolean(icon.active)) } });
        button.toggleClass("is-active", Boolean(icon.active));
        if (icon.icon) setIcon(button, icon.icon);
        else button.setText(icon.text ?? "");
        button.addEventListener("click", () => { if (icon.open) icon.open(button); else if (icon.run) act(icon.run); });
        return button;
      });
      const keyed = buttons[entry.buttons.findIndex(icon => icon.shortcut)];
      shortcuts.set(entry.key, () => { if (keyed) keyed.click(); else buttons[0]?.focus(); });
    }
  }

  const focusable = (): HTMLElement[] => Array.from(element.querySelectorAll<HTMLElement>("button"));
  element.addEventListener("keydown", event => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const items = focusable();
    const index = items.indexOf(event.target as HTMLElement);
    const move = (to: number): void => { items[(to + items.length) % items.length]?.focus(); };
    const target = event.target as HTMLElement;
    const inRow = Boolean(target.closest(".tm-task-menu-icons"));
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? items.length - 1 : index - 1);
    // Left and right move within a row of icons; right opens a submenu.
    else if (event.key === "ArrowRight" && inRow) move(index + 1);
    else if (event.key === "ArrowLeft" && inRow) move(index - 1);
    else if (event.key === "ArrowRight" && target.hasClass("has-submenu")) target.click();
    else if (event.key === "Escape") close();
    else if (shortcuts.has(event.key)) shortcuts.get(event.key)!();
    else return;
    event.preventDefault(); event.stopPropagation();
  });

  // At the pointer, flipped to stay inside the window.
  const win = doc.defaultView ?? window;
  const box = element.getBoundingClientRect();
  const margin = 8;
  const left = options.at.x + box.width <= win.innerWidth - margin ? options.at.x : options.at.x - box.width;
  const top = options.at.y + box.height <= win.innerHeight - margin ? options.at.y : options.at.y - box.height;
  element.style.left = `${Math.max(margin, Math.min(left, win.innerWidth - box.width - margin))}px`;
  element.style.top = `${Math.max(margin, Math.min(top, win.innerHeight - box.height - margin))}px`;

  const outside = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!element.contains(target) && !target?.closest?.(SUBMENUS)) close();
  };
  doc.addEventListener("pointerdown", outside, true);
  win.addEventListener("blur", close);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", outside, true);
    win.removeEventListener("blur", close);
    const hadFocus = element.contains(doc.activeElement);
    element.remove();
    if (open === menu) open = undefined;
    if (hadFocus && options.returnFocus?.isConnected) options.returnFocus.focus({ preventScroll: true });
    options.onClose?.();
  }
  const menu: TaskMenu = { element, close };
  open = menu;
  focusable()[0]?.focus();
  return menu;
}

/** How many of the tasks carry a tag: every one, some, or none. */
export type TagState = "all" | "some" | "none";

export interface TagsPopoverOptions {
  anchor: HTMLElement;
  beside?: boolean;
  /** The tags to offer, those on the tasks first; `state` of one not listed is "none". */
  tags: Array<{ name: string; state: TagState }>;
  /** `on` adds the tag to every task, otherwise it comes off all of them. */
  toggle: (tag: string, on: boolean) => void;
  /** Text already in the search field. */
  query?: string;
  /** Tags typed into the input (commas separate several; a tag may have spaces), added to every task. */
  add: (tags: string[]) => void;
}

/**
 * Tags for one or many tasks: an input that adds new tags (Enter), and a list of tags to check or uncheck.
 * A tag some of the tasks have shows a dash; checking it adds it to the rest. It stays open for several
 * changes; Escape or a click outside closes it.
 */
export function openTagsPopover(options: TagsPopoverOptions): { element: HTMLElement; close(): void } {
  const doc = options.anchor.ownerDocument;
  const element = doc.body.createDiv({ cls: "tm-options-dropdown tm-choice-popover tm-tags-popover", attr: { role: "dialog", "aria-label": "Tags" } });
  const input = element.createEl("input", { type: "text", cls: "tm-options-input", attr: { placeholder: "Add or find a tag", "aria-label": "Tag", spellcheck: "false" } });
  input.value = options.query ?? "";
  const list = element.createDiv({ attr: { role: "listbox", "aria-multiselectable": "true", "aria-label": "Tags" } });
  const states = new Map(options.tags.map(tag => [tag.name, tag.state]));
  const paint = (): void => {
    list.empty();
    const query = input.value.trim().replace(/^#/, "").toLocaleLowerCase();
    for (const [name, state] of states) {
      if (query && !name.toLocaleLowerCase().includes(query)) continue;
      const option = list.createDiv({ cls: "tm-options-option", attr: { role: "option", tabindex: "-1", "aria-selected": String(state === "all"), "data-value": name } });
      option.createSpan({ cls: "tm-options-option-label", text: name });
      const check = option.createSpan({ cls: "tm-options-check", attr: { "aria-hidden": "true" } });
      if (state !== "none") setIcon(check, state === "all" ? "check" : "minus");
      option.addEventListener("click", () => toggle(name));
    }
    if (!list.childElementCount) list.createDiv({ cls: "tm-options-option is-action", text: query ? `Press Enter to add “${input.value.trim().replace(/^#/, "")}”` : "No tags yet" });
  };
  const toggle = (name: string): void => {
    const on = states.get(name) !== "all";
    states.set(name, on ? "all" : "none");
    options.toggle(name, on);
    paint();
    Array.from(list.querySelectorAll<HTMLElement>("[role=option]")).find(option => option.getAttribute("data-value") === name)?.focus();
  };
  input.addEventListener("input", paint);
  element.addEventListener("keydown", event => {
    if (event.isComposing) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>("[role=option]"));
    const index = items.indexOf(event.target as HTMLElement);
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") (items[index + 1] ?? items[0])?.focus();
    else if (event.key === "ArrowUp") (index <= 0 ? input : items[index - 1]).focus();
    else if (event.key === "Enter" && event.target === input) {
      const names = input.value.split(",").map(tag => tag.trim().replace(/^#/, "").replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);
      if (!names.length) return;
      options.add(names);
      for (const name of names) states.set(name, "all");
      input.value = "";
      paint();
    } else if ((event.key === "Enter" || event.key === " ") && index >= 0) toggle(items[index].getAttribute("data-value")!);
    else return;
    event.preventDefault(); event.stopPropagation();
  });
  paint();
  placePopover(element, options.anchor, options.beside);

  const outside = (event: PointerEvent): void => { if (!element.contains(event.target as Node)) close(); };
  doc.addEventListener("pointerdown", outside, true);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", outside, true);
    element.remove();
    if (options.anchor.isConnected) options.anchor.focus({ preventScroll: true });
  }
  input.focus();
  return { element, close };
}
