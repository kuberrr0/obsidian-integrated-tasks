import { setIcon } from "obsidian";
import { addDays } from "./calendar";
import { formatDate, parseDateTimeExpression, parseTimeExpression, todayIso } from "./date";
import { durationToMinutes, formatDuration } from "./parser";
import { taskTimeLabel } from "./task-row-details";

/** What the popover edits: a date, its time, and (for a schedule) how long it takes. */
export interface DatePopoverValue {
  date?: string;
  time?: string;
  duration?: number;
}

export type DatePopoverKind = "scheduled" | "deadline";

export interface DatePopoverOptions {
  /** The element the popover opens beside. */
  anchor: HTMLElement;
  /** A schedule takes a date, time and duration; a deadline a date and time. */
  kind: DatePopoverKind;
  value: DatePopoverValue;
  dateFormat: string;
  now?: Date;
  /** Called once, when the popover closes with a change. */
  save: (value: DatePopoverValue) => void;
}

export interface DatePopover {
  element: HTMLElement;
  /** Closes the popover; `commit` saves pending changes (default), otherwise they are dropped. */
  close(commit?: boolean): void;
}

let open: DatePopover | undefined;

/** "Mo" … "Su": weeks start on Monday, as in Things. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function monthStart(date: string): string { return `${date.slice(0, 7)}-01`; }

function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  const next = new Date(year, value - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Monday of the week after `today`: "Next week", as Things means it. */
export function nextWeek(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7;
  return addDays(today, 7 - weekday);
}

/** Minutes from "30m", "1h", "1h30m", "1.5h" or a bare number of minutes. */
export function parseDurationInput(text: string): number | undefined {
  const value = text.trim().toLowerCase().replace(/\s+/g, "").replace(/mins?$|minutes?$/, "m").replace(/hrs?$|hours?$/, "h");
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) > 0 ? Number(value) : undefined;
  const decimal = /^(\d+(?:\.\d+)?)h$/.exec(value);
  if (decimal) return Math.round(Number(decimal[1]) * 60) || undefined;
  return durationToMinutes(value);
}

/** A duration inside a phrase: "30m", "1h30m", "1.5 hours", "45 min", optionally after "for". */
const DURATION = /(?:^|\s)(?:for\s+)?(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h)(?:\s*\d+\s*(?:minutes?|mins?|m))?|\d+\s*(?:minutes?|mins?|m))(?=\s|$)/i;

/**
 * Reads the popover's one input: a date, a time and (for a schedule) a duration, in any order and each
 * optional — "next fri 3pm 30m", "tomorrow", "3pm", "45m". What is left out keeps its current value;
 * a time alone keeps the date (today when there is none). "no time" and "no duration" clear them.
 * Returns undefined when the text is not something it understands.
 */
export function parseWhenInput(text: string, kind: DatePopoverKind, current: DatePopoverValue, now = new Date(), dateFormat = "YYYY-MM-DD"): DatePopoverValue | undefined {
  let rest = text.trim();
  if (!rest) return undefined;
  const next: DatePopoverValue = { ...current };
  let understood = false;
  rest = rest.replace(/(?:^|\s)no\s+time(?=\s|$)/i, () => { next.time = undefined; understood = true; return " "; });
  // A deadline has no duration; "30m" must not be read as "in 30 minutes".
  if (kind === "deadline" && DURATION.test(rest)) return undefined;
  if (kind === "scheduled") {
    rest = rest.replace(/(?:^|\s)no\s+duration(?=\s|$)/i, () => { next.duration = undefined; understood = true; return " "; });
    const duration = DURATION.exec(rest);
    if (duration) {
      const minutes = parseDurationInput(duration[1]);
      if (!minutes) return undefined;
      next.duration = minutes;
      understood = true;
      rest = rest.slice(0, duration.index) + " " + rest.slice(duration.index + duration[0].length);
    }
  }
  rest = rest.replace(/\s+/g, " ").trim();
  if (rest) {
    const dateTime = parseDateTimeExpression(rest, now, dateFormat);
    const time = dateTime ? undefined : parseTimeExpression(rest, now);
    if (dateTime) { next.date = dateTime.date; if (dateTime.time) next.time = dateTime.time; }
    else if (time) { next.time = time; next.date ??= todayIso(now); }
    else return undefined;
    understood = true;
  }
  return understood ? next : undefined;
}

/** "Fri, Oct 9, 2026, 3:00 PM · 30m", or "No date". */
export function describeWhen(value: DatePopoverValue): string {
  const when = value.date ? [formatDate(value.date, "ddd, MMM D, YYYY"), value.time && taskTimeLabel(value.time)].filter(Boolean).join(", ") : "No date";
  return value.duration ? `${when} · ${formatDuration(value.duration)}` : when;
}

/**
 * A Things-like date picker: one natural-language input for the date, time and duration
 * ("next fri 3pm 30m"), Today / Tomorrow / Next week / No date, and a month calendar.
 * Picking a date saves and closes; Enter in the input, or a click outside, saves what was typed.
 * Escape closes without saving. Only one popover is open at a time.
 */
export function openDatePopover(options: DatePopoverOptions): DatePopover {
  open?.close();
  const doc = options.anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const now = options.now ?? new Date();
  const today = todayIso(now);
  const initial = { ...options.value };
  const pending: DatePopoverValue = { ...options.value };
  let month = monthStart(pending.date ?? today);

  const element = doc.body.createDiv({ cls: "tm-date-popover", attr: { role: "dialog", "aria-label": options.kind === "deadline" ? "Deadline" : "When" } });

  // One input on top; underneath, what it reads as (or, while empty, the current value).
  const top = element.createDiv({ cls: "tm-date-popover-row tm-date-popover-input" });
  setIcon(top.createSpan({ cls: "tm-date-popover-icon", attr: { "aria-hidden": "true" } }), "calendar");
  const placeholder = options.kind === "scheduled" ? "Type a date, time or duration" : "Type a date or time";
  const input = top.createEl("input", { type: "text", attr: { placeholder, "aria-label": options.kind === "scheduled" ? "Date, time and duration" : "Date and time", spellcheck: "false" } });
  const hint = element.createDiv({ cls: "tm-date-popover-hint" });
  const read = (): DatePopoverValue | undefined => parseWhenInput(input.value, options.kind, pending, now, options.dateFormat);
  const paintHint = (): void => {
    const typed = input.value.trim();
    const value = typed ? read() : pending;
    hint.setText(value ? describeWhen(value) : `Not a ${options.kind === "scheduled" ? "date, time or duration" : "date or time"}`);
    hint.toggleClass("is-invalid", !value);
  };
  input.addEventListener("input", paintHint);
  paintHint();

  const divider = (): void => { element.createDiv({ cls: "tm-date-popover-divider" }); };
  const choice = (icon: string, label: string, pick: () => void): void => {
    const button = element.createEl("button", { cls: "tm-date-popover-row tm-date-popover-choice", attr: { type: "button" } });
    setIcon(button.createSpan({ cls: "tm-date-popover-icon", attr: { "aria-hidden": "true" } }), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", pick);
  };
  const pickDate = (date: string | undefined): void => {
    pending.date = date;
    // A time belongs to a date: no date, no time.
    if (!date) pending.time = undefined;
    close(true, false);
  };
  divider();
  choice("calendar", "Today", () => pickDate(today));
  choice("sunrise", "Tomorrow", () => pickDate(addDays(today, 1)));
  choice("square-arrow-right", "Next week", () => pickDate(nextWeek(today)));
  divider();
  choice("calendar-x", "No date", () => pickDate(undefined));
  divider();

  // The month calendar: today in the accent colour, the chosen date in a circle.
  const calendar = element.createDiv({ cls: "tm-date-popover-calendar" });
  const paintCalendar = (): void => {
    calendar.empty();
    const header = calendar.createDiv({ cls: "tm-date-popover-month" });
    header.createSpan({ cls: "tm-date-popover-month-label", text: formatDate(month, "MMM YYYY") });
    const nav = header.createDiv({ cls: "tm-date-popover-nav" });
    const navButton = (icon: string, label: string, go: () => void): void => {
      const button = nav.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
      setIcon(button, icon);
      button.addEventListener("click", () => { go(); paintCalendar(); });
    };
    navButton("chevron-left", "Previous month", () => { month = shiftMonth(month, -1); });
    navButton("circle", "This month", () => { month = monthStart(today); });
    navButton("chevron-right", "Next month", () => { month = shiftMonth(month, 1); });
    const grid = calendar.createDiv({ cls: "tm-date-popover-grid", attr: { role: "grid" } });
    for (const name of WEEKDAYS) grid.createSpan({ cls: "tm-date-popover-weekday", text: name });
    const [year, value] = month.split("-").map(Number);
    const lead = (new Date(year, value - 1, 1).getDay() + 6) % 7;
    let day = addDays(month, -lead);
    for (let cell = 0; cell < 42; cell++, day = addDays(day, 1)) {
      const date = day;
      const button = grid.createEl("button", { cls: "tm-date-popover-day", text: String(Number(date.slice(8))), attr: { type: "button", "aria-label": formatDate(date, "dddd, MMMM D, YYYY"), "data-date": date } });
      button.toggleClass("is-outside", date.slice(0, 7) !== month.slice(0, 7));
      button.toggleClass("is-today", date === today);
      button.toggleClass("is-selected", date === pending.date);
      button.addEventListener("click", () => pickDate(date));
    }
  };
  paintCalendar();

  // Enter takes what was typed and closes; text that is not understood stays for correcting.
  element.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(false); return; }
    if (event.key !== "Enter" || event.isComposing || event.target !== input) return;
    event.preventDefault(); event.stopPropagation();
    if (input.value.trim() && !read()) { paintHint(); return; }
    close(true);
  });

  // Beside the anchor, below it when there is room, and always inside the window.
  const place = (): void => {
    const anchor = options.anchor.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const margin = 8;
    const below = anchor.bottom + 4 + box.height <= win.innerHeight - margin;
    const top = below ? anchor.bottom + 4 : Math.max(margin, anchor.top - 4 - box.height);
    const left = Math.min(Math.max(margin, anchor.left), win.innerWidth - box.width - margin);
    element.style.top = `${Math.max(margin, top)}px`;
    element.style.left = `${Math.max(margin, left)}px`;
  };
  place();

  // A click outside saves what was typed and closes.
  const outside = (event: PointerEvent): void => {
    if (!element.contains(event.target as Node)) close(true);
  };
  doc.addEventListener("pointerdown", outside, true);
  win.addEventListener("resize", place);

  let closed = false;
  /** `typed` reads the input first (off when a date was just picked, which is what counts). */
  function close(commit = true, typed = true): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", outside, true);
    win.removeEventListener("resize", place);
    if (commit && typed && input.value.trim()) Object.assign(pending, read() ?? {});
    element.remove();
    if (open === popover) open = undefined;
    const changed = pending.date !== initial.date || pending.time !== initial.time || pending.duration !== initial.duration;
    if (commit && changed) options.save({ ...pending });
    if (options.anchor.isConnected) options.anchor.focus({ preventScroll: true });
  }

  const popover: DatePopover = { element, close: commit => close(commit) };
  open = popover;
  input.focus();
  return popover;
}
