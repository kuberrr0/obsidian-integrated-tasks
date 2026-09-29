import { taskTimeLabel, taskTimeDurationLabel } from "./task-row-details";
import { taskTitleLabel } from "./task-title";
import { Notice, setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { formatDuration } from "./parser";
import { addDays, SLOT_MINUTES, calendarDate, calendarDays, calendarTime, localDate, minuteTime, resizedRange, selectionPreset, shiftCalendar, timeMinutes, type CalendarPreset, type CalendarScope } from "./calendar";
import type { Task } from "./types";

export interface CalendarOptions {
  planning?: boolean;
  planningOpen?: boolean;
  planningChanged?: (open: boolean) => void;
  anchor: string;
  scope: CalendarScope;
  tasks: Task[];
  dateFormat: string;
  navigate: (anchor: string, scope: CalendarScope) => void;
  create: (preset: CalendarPreset) => void;
  edit: (task: Task) => void;
  toggle?: (task: Task, completed: boolean) => Promise<void>;
  bind?: (card: HTMLElement, task: Task) => void;
  /** The colour of the task's project, which tints its card. */
  color?: (task: Task) => string | undefined;
  /** Colour each checkbox by its task's priority. */
  priorityColors?: boolean;
  dragStart?: (task: Task) => void;
  resize: (task: Task, date: string, time: string, duration: number) => Promise<void>;
  move: (task: Task, date: string, time?: string) => Promise<void>;
  /** A restored time-grid scroll position; without one, day and week views open near the current time. */
  initialScrollTop?: number;
}

/** Unscheduled tasks render in pages so a large vault does not build every card at once. */
export const UNSCHEDULED_PAGE = 200;
const HOUR_HEIGHT = 48;
const DEFAULT_SLOT = 36; // 09:00
const KEY_SAVE_DELAY_MS = 500;

/** Render inside the task view; all writes go through its existing task store. */
export function renderCalendar(container: HTMLElement, options: CalendarOptions): void {
  const root = container.createDiv({ cls: `tm-calendar is-${options.scope}-scope`, attr: { tabindex: "0" } });
  root.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest?.("input, textarea, select, [contenteditable=true], [role=slider]")) return;
    const key = event.key.toLowerCase();
    const scope = key === "d" ? "four-day" : key === "w" ? "week" : key === "m" ? "month" : undefined;
    if (scope) { event.preventDefault(); options.navigate(options.anchor, scope); container.querySelector?.<HTMLElement>(".tm-calendar")?.focus(); }
    else if (key === "t") {
      event.preventDefault(); options.navigate(todayIso(), options.scope);
      container.querySelector?.<HTMLElement>(".tm-calendar")?.focus();
    }
    else if (key === "arrowleft" || key === "arrowright") {
      event.preventDefault(); options.navigate(shiftCalendar(options.anchor, options.scope, key === "arrowleft" ? -1 : 1), options.scope);
      container.querySelector?.<HTMLElement>(".tm-calendar")?.focus();
    }
  });
  const byDate = new Map<string, Task[]>();
  const byMonth = new Map<string, Task[]>();
  for (const task of options.tasks) {
    const key = calendarDate(task) ?? "";
    const group = byDate.get(key) ?? [];
    group.push(task);
    byDate.set(key, group);
    if (key && options.scope === "year") {
      const month = byMonth.get(key.slice(0, 7)) ?? [];
      month.push(task);
      byMonth.set(key.slice(0, 7), month);
    }
  }
  let dragged: Task | undefined;
  let grabOffsetMinutes = 0;
  let moving = false;
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar" });
  const controls = toolbar.createDiv({ cls: "tm-calendar-controls" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]] as const) {
    const button = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", () => options.navigate(shiftCalendar(options.anchor, options.scope, delta), options.scope));
  }
  const today = controls.createEl("button", { text: "Today" });
  today.addEventListener("click", () => options.navigate(todayIso(), options.scope));
  const date = localDate(options.anchor);
  const days = options.scope === "four-day" ? Array.from({ length: 4 }, (_, i) => addDays(options.anchor, i)) : options.scope === "week" ? calendarDays(options.anchor, "week") : [];
  const title = options.scope === "year" ? String(date.getFullYear()) : date.toLocaleDateString(undefined, { month: "long", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}) });
  toolbar.createEl("h2", { text: title });
  const scopes = controls.createDiv({ cls: "tm-calendar-scopes", attr: { "aria-label": "Calendar scope" } });
  for (const [scope, label] of [["four-day", "4D"], ["week", "W"], ["month", "M"]] as const) {
    const button = scopes.createEl("button", { text: label, attr: { "aria-label": scope === "four-day" ? "4 days" : scope === "week" ? "Week" : "Month", "aria-pressed": String(options.scope === scope) } });
    button.addEventListener("click", () => options.navigate(options.anchor, scope));
  }
  const body = root.createDiv({ cls: "tm-calendar-body" });
  // Stable scroll keys let the task view restore scroll positions across re-renders.
  const surface = body.createDiv({ cls: "tm-calendar-surface", attr: { "data-tm-scroll-key": "calendar-surface" } });
  const planner = options.planning ? body.createEl("aside", { cls: "tm-calendar-planner", attr: { "aria-label": "Plan tasks", "data-tm-scroll-key": "calendar-planner" } }) : undefined;
  if (planner) {
    planner.hidden = !options.planningOpen;
    const plan = toolbar.createEl("button", { cls: "tm-calendar-plan-toggle", text: "Plan tasks", attr: { "aria-expanded": String(!planner.hidden) } });
    const icon = plan.createSpan(); setIcon(icon, "panel-right");
    plan.addEventListener("click", () => {
      planner.hidden = !planner.hidden;
      plan.setAttribute("aria-expanded", String(!planner.hidden));
      options.planningChanged?.(!planner.hidden);
    });
  }

  const dropTarget = (element: HTMLElement, targetDate: string, getTime?: (event: DragEvent) => string): void => {
    element.addEventListener("dragover", event => {
      if (!dragged || moving) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      element.addClass("is-drop-target");
    });
    element.addEventListener("dragleave", () => element.removeClass("is-drop-target"));
    element.addEventListener("drop", event => {
      element.removeClass("is-drop-target");
      if (!dragged || moving) return;
      event.preventDefault();
      event.stopPropagation();
      const task = dragged;
      dragged = undefined;
      moving = true;
      void options.move(task, targetDate, getTime?.(event)).catch(cause => {
        new Notice(cause instanceof Error ? cause.message : "Could not reschedule task.");
      }).finally(() => { moving = false; });
    });
  };
  const taskCard = (parent: HTMLElement, task: Task): HTMLElement => {
    const time = calendarTime(task);
    // A plain container: the checkbox, title button and resize sliders are its interactive parts.
    const card = parent.createDiv({ cls: `tm-calendar-task${task.completed ? " is-completed" : ""}`,
      attr: { title: `${task.title}${task.durationMinutes ? ` · ${formatDuration(task.durationMinutes)}` : ""}` } });
    const color = options.color?.(task);
    if (color) card.style.setProperty("--tm-project-color", color);
    const checkbox = card.createEl("input", { cls: `tm-calendar-check${options.priorityColors && task.priority ? ` is-p${task.priority}` : ""}`, type: "checkbox", attr: { "aria-label": `Complete ${taskTitleLabel(task.title)}` } });
    checkbox.checked = task.completed;
    checkbox.disabled = !options.toggle;
    checkbox.addEventListener("click", event => event.stopPropagation());
    checkbox.addEventListener("pointerdown", event => event.stopPropagation());
    checkbox.addEventListener("keydown", event => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      checkbox.disabled = true;
      void options.toggle?.(task, checkbox.checked).catch(cause => {
        checkbox.checked = task.completed;
        new Notice(cause instanceof Error ? cause.message : "Could not complete task.");
      }).finally(() => { checkbox.disabled = false; });
    });
    // Focus keys let the task view put focus back on the same control after re-rendering.
    const title = card.createEl("button", { cls: "tm-calendar-task-title", text: taskTitleLabel(task.title), attr: { type: "button", "data-tm-focus-key": `calendar-title:${task.id}` } });
    title.addEventListener("click", event => { event.stopPropagation(); options.edit(task); });
    const timeLabel = taskTimeDurationLabel(time, task.durationMinutes);
    if (timeLabel) card.createSpan({ cls: "tm-calendar-task-time", text: timeLabel });
    if (task.deadline && calendarDate(task) === task.deadline && (time ?? "") === (task.deadlineTime ?? "")) {
      setIcon(card.createSpan({ cls: "tm-calendar-task-flag", attr: { "aria-label": "Deadline" } }), "flag");
    }
    card.draggable = true;
    // Without selection, a click anywhere on the card opens the editor, as the title does.
    if (!options.bind) card.addEventListener("click", event => { event.stopPropagation(); options.edit(task); });
    options.bind?.(card, task);
    card.addEventListener("dragstart", event => {
      options.dragStart?.(task);
      dragged = task;
      grabOffsetMinutes = card.hasClass("is-timed")
        ? Math.max(0, (event.clientY - card.getBoundingClientRect().top) / parent.getBoundingClientRect().height * 1440)
        : 0;
      event.stopPropagation();
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }
    });
    card.addEventListener("dragend", () => { dragged = undefined; root.querySelectorAll(".is-drop-target").forEach(el => el.removeClass("is-drop-target")); });
    return card;
  };
  const dateCell = (parent: HTMLElement, day: string, compact = false, outside = false): void => {
    const cell = parent.createDiv({ cls: `tm-calendar-cell${day === todayIso() ? " is-today" : ""}${outside ? " is-outside" : ""}` });
    const tasks = byDate.get(day) ?? [];
    const button = cell.createEl("button", { cls: "tm-calendar-date", text: String(localDate(day).getDate()), attr: { "aria-label": `Open day view for ${formatDate(day, options.dateFormat)}` } });
    button.addEventListener("click", () => options.navigate(day, "day"));
    cell.addEventListener("click", event => { if (event.target === cell) options.create({ scheduledDate: day }); });
    dropTarget(cell, day);
    if (compact) {
      if (tasks.length) {
        const count = cell.createEl("button", { cls: "tm-calendar-count", text: String(tasks.length), attr: { "aria-label": `Show ${tasks.length} tasks on ${day}` } });
        count.addEventListener("click", () => options.navigate(day, "day"));
      }
    } else for (const task of tasks) taskCard(cell, task);
  };
  const monthGrid = (parent: HTMLElement, anchor: string, compact: boolean): void => {
    const grid = parent.createDiv({ cls: `tm-calendar-grid${compact ? " is-compact" : ""}` });
    for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.createDiv({ cls: "tm-calendar-weekday", text: weekday });
    for (const day of calendarDays(anchor, "month")) dateCell(grid, day, compact, day.slice(0, 7) !== anchor.slice(0, 7));
  };

  const renderHours = (timeline: HTMLElement): void => {
    for (let hour = 0; hour < 24; hour++) {
      const label = timeline.createDiv({ cls: "tm-calendar-hour", text: taskTimeLabel(minuteTime(hour * 60)).replace(" ", "").toLowerCase() });
      label.style.top = `${hour * HOUR_HEIGHT}px`;
    }
  };
  // Each lane is one tab stop; arrow keys move between its slots and to the same time on adjacent days.
  const slotLanes: HTMLElement[][] = [];
  const focusSlot = (laneIndex: number, slotIndex: number): void => {
    const slots = slotLanes[laneIndex];
    for (const slot of slots) if (slot.getAttribute("tabindex") === "0") slot.setAttribute("tabindex", "-1");
    slots[slotIndex].setAttribute("tabindex", "0");
    slots[slotIndex].focus();
  };
  const renderDayLane = (timeline: HTMLElement, day: string): void => {
    const tasks = byDate.get(day) ?? [];
    const lane = timeline.createDiv({ cls: "tm-calendar-lane", attr: { "aria-label": `Daily schedule for ${day}` } });
    let entrySlot = DEFAULT_SLOT;
    if (day === todayIso()) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const marker = lane.createSpan({ cls: "tm-calendar-now", attr: { "aria-hidden": "true" } });
      marker.style.top = `${minutes / 15 * 12}px`;
      entrySlot = Math.floor(minutes / SLOT_MINUTES);
    }
    const laneIndex = slotLanes.length;
    const slots: HTMLElement[] = [];
    slotLanes.push(slots);
    for (let slot = 0; slot < 96; slot++) {
      const button = lane.createEl("button", { cls: `tm-calendar-slot${slot > 0 && slot % 4 === 0 ? " is-hour-start" : ""}`, attr: {
        "aria-label": `Create task on ${day} at ${minuteTime(slot * 15)}`, tabindex: slot === entrySlot ? "0" : "-1"
      } });
      button.addEventListener("click", event => { if (event.detail === 0) options.create(selectionPreset(day, slot, slot)); });
      slots.push(button);
    }
    lane.addEventListener("keydown", event => {
      const index = slots.indexOf(event.target as HTMLElement);
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      // Past the first or last day, left and right fall through to the calendar's period keys.
      if (!vertical && !(horizontal && slotLanes[laneIndex + horizontal])) return;
      event.preventDefault();
      event.stopPropagation();
      if (vertical) focusSlot(laneIndex, Math.max(0, Math.min(slots.length - 1, index + vertical)));
      else focusSlot(laneIndex + horizontal, index);
    });
    const minutesAt = (clientY: number): number => {
      const bounds = lane.getBoundingClientRect();
      return (clientY - bounds.top) / bounds.height * 1440;
    };
    const slotAt = (clientY: number): number => Math.max(0, Math.min(95, Math.floor(minutesAt(clientY) / SLOT_MINUTES)));
    let start: number | undefined;
    let selection: HTMLElement | undefined;
    const paint = (end: number): void => {
      if (start === undefined || !selection) return;
      const preset = selectionPreset(day, start, end);
      selection.style.top = `${Math.min(start, end) * 12}px`;
      selection.style.height = `${preset.durationMinutes! / 15 * 12}px`;
      selection.setText(`${preset.scheduledTime} · ${formatDuration(preset.durationMinutes!)}`);
    };
    lane.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !(event.target instanceof HTMLElement) || !event.target.hasClass("tm-calendar-slot")) return;
      event.preventDefault();
      start = slotAt(event.clientY);
      lane.setPointerCapture(event.pointerId);
      selection = lane.createDiv({ cls: "tm-calendar-selection" });
      paint(start);
    });
    lane.addEventListener("pointermove", event => paint(slotAt(event.clientY)));
    lane.addEventListener("pointerup", event => {
      if (start === undefined) return;
      const preset = selectionPreset(day, start, slotAt(event.clientY));
      start = undefined;
      selection?.remove();
      lane.releasePointerCapture(event.pointerId);
      options.create(preset);
    });
    lane.addEventListener("pointercancel", () => { start = undefined; selection?.remove(); });
    dropTarget(lane, day, event => {
      const start = Math.round((minutesAt(event.clientY) - grabOffsetMinutes) / SLOT_MINUTES) * SLOT_MINUTES;
      return minuteTime(Math.max(0, Math.min(1440 - SLOT_MINUTES, start)));
    });
    // Separate columns keep overlapping tasks individually draggable and clickable.
    const timed = tasks.filter(task => calendarTime(task)).sort((a, b) => timeMinutes(calendarTime(a)!) - timeMinutes(calendarTime(b)!));
    const ends: number[] = [];
    const placements = timed.map(task => {
      const begin = timeMinutes(calendarTime(task)!);
      const end = Math.min(1440, begin + (task.durationMinutes ?? 30));
      let column = ends.findIndex(value => value <= begin);
      if (column < 0) column = ends.length;
      ends[column] = end;
      return { task, begin, end, column };
    });
    for (const { task, begin, end, column } of placements) {
      const card = taskCard(lane, task);
      card.addClass("is-timed");
      card.style.top = `${begin / 15 * 12}px`;
      card.style.height = `${Math.max(12, (end - begin) / 15 * 12)}px`;
      card.style.left = `calc(${column / ends.length * 100}% + 2px)`;
      card.style.width = `calc(${100 / ends.length}% - 4px)`;
      const preview = card.createSpan({ cls: "tm-calendar-resize-preview" });
      const restore = (): void => {
        card.style.top = `${begin / 15 * 12}px`;
        card.style.height = `${Math.max(12, (end - begin) / 15 * 12)}px`;
        card.removeClass("is-resizing");
        card.draggable = true;
        preview.setText("");
      };
      for (const edge of ["start", "end"] as const) {
        const handle = card.createSpan({ cls: `tm-calendar-resize-handle is-${edge}`, attr: {
          role: "slider", tabindex: "0", "aria-label": `Resize ${edge === "start" ? "start time" : "end time"} of ${task.title}`, "data-tm-focus-key": `resize-${edge}:${task.id}`,
          "aria-valuemin": "0", "aria-valuemax": "1440", "aria-valuenow": String(edge === "start" ? begin : end),
          "aria-valuetext": minuteTime(edge === "start" ? begin : end), "aria-orientation": "vertical"
        } });
        let pointer: number | undefined;
        let initialY = 0;
        let range = { start: begin, duration: end - begin };
        const update = (target: number): void => {
          range = resizedRange(begin, end, edge, target);
          card.style.top = `${range.start / 15 * 12}px`;
          card.style.height = `${Math.max(12, range.duration / 15 * 12)}px`;
          preview.setText(`${minuteTime(range.start)} · ${formatDuration(range.duration)}`);
          const boundary = edge === "start" ? range.start : range.start + range.duration;
          handle.setAttribute("aria-valuenow", String(boundary));
          handle.setAttribute("aria-valuetext", minuteTime(boundary));
        };
        let keyTimer: number | undefined;
        const reset = (): void => { range = { start: begin, duration: end - begin }; restore(); };
        const save = (): void => {
          window.clearTimeout(keyTimer);
          keyTimer = undefined;
          if (range.start === begin && range.duration === end - begin) { reset(); return; }
          moving = true;
          card.setAttribute("aria-busy", "true");
          void options.resize(task, day, minuteTime(range.start), range.duration).catch(cause => {
            new Notice(cause instanceof Error ? cause.message : "Could not resize task.");
          }).finally(() => { moving = false; card.removeAttribute("aria-busy"); reset(); });
        };
        handle.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
        handle.addEventListener("pointerdown", event => {
          if (event.button !== 0 || moving) return;
          event.preventDefault();
          event.stopPropagation();
          pointer = event.pointerId;
          initialY = event.clientY;
          range = { start: begin, duration: end - begin };
          card.draggable = false;
          card.addClass("is-resizing");
          handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", event => {
          if (pointer !== event.pointerId) return;
          event.stopPropagation();
          if (Math.abs(event.clientY - initialY) < 3) return;
          update(minutesAt(event.clientY));
        });
        handle.addEventListener("pointerup", event => {
          if (pointer !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          pointer = undefined;
          handle.releasePointerCapture(event.pointerId);
          save();
        });
        const cancel = (): void => { if (pointer !== undefined) { pointer = undefined; restore(); } };
        handle.addEventListener("pointercancel", cancel);
        handle.addEventListener("lostpointercapture", cancel);
        // Arrow keys preview live; the change saves once the keys pause, or on blur, so
        // each press does not re-render the calendar and drop focus.
        handle.addEventListener("keydown", event => {
          if (event.key === "Escape" && keyTimer !== undefined) {
            event.preventDefault(); event.stopPropagation();
            window.clearTimeout(keyTimer); keyTimer = undefined; reset();
            return;
          }
          if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (moving) return;
          window.clearTimeout(keyTimer);
          keyTimer = window.setTimeout(save, KEY_SAVE_DELAY_MS);
          card.addClass("is-resizing");
          update((edge === "start" ? range.start : range.start + range.duration) + (event.key === "ArrowUp" ? -15 : 15));
        });
        handle.addEventListener("keyup", event => {
          if (keyTimer === undefined || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
          window.clearTimeout(keyTimer);
          keyTimer = window.setTimeout(save, KEY_SAVE_DELAY_MS);
        });
        handle.addEventListener("blur", () => { if (keyTimer !== undefined) save(); });
      }
    }
  };
  const scrollTimeGrid = (scroll: HTMLElement, range: string[]): void => {
    if (options.initialScrollTop !== undefined) { scroll.scrollTop = options.initialScrollTop; return; }
    if (!range.includes(todayIso())) return;
    const now = new Date();
    scroll.scrollTop = Math.max(0, (now.getHours() + now.getMinutes() / 60 - 1) * HOUR_HEIGHT);
  };
  if (options.scope === "day" || options.scope === "week" || options.scope === "four-day") {
    if (options.scope === "day") {
      const allDay = surface.createDiv({ cls: "tm-calendar-allday" });
      allDay.createSpan({ text: "all-day" });
      for (const task of (byDate.get(options.anchor) ?? []).filter(task => !calendarTime(task))) taskCard(allDay, task);
      const scroll = surface.createDiv({ cls: "tm-calendar-day-scroll", attr: { "data-tm-scroll-key": "calendar-grid" } });
      const timeline = scroll.createDiv({ cls: "tm-calendar-timeline" });
      renderHours(timeline);
      renderDayLane(timeline, options.anchor);
      scrollTimeGrid(scroll, [options.anchor]);
    } else {
      // One scroll surface keeps all seven timelines and the hour labels aligned.
      const scroll = surface.createDiv({ cls: "tm-calendar-day-scroll tm-calendar-week-scroll", attr: { "data-tm-scroll-key": "calendar-grid" } });
      const week = scroll.createDiv({ cls: `tm-calendar-week${options.scope === "four-day" ? " is-four-day" : ""}` });
      const header = week.createDiv({ cls: "tm-calendar-week-header" });
      header.createSpan({ cls: "tm-calendar-week-gutter", text: "all-day" });
      for (const day of days) {
        const column = header.createDiv({ cls: `tm-calendar-week-heading${day === todayIso() ? " is-today" : ""}` });
        const button = column.createEl("button", { cls: "tm-calendar-date", text: localDate(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), attr: { "aria-label": `New task on ${formatDate(day, options.dateFormat)}` } });
        button.addEventListener("click", () => options.create({ scheduledDate: day }));
        for (const task of (byDate.get(day) ?? []).filter(task => !calendarTime(task))) taskCard(column, task);
        dropTarget(column, day);
      }
      const timeline = week.createDiv({ cls: "tm-calendar-timeline tm-calendar-week-timeline" });
      renderHours(timeline);
      const columns = timeline.createDiv({ cls: "tm-calendar-week-columns" });
      for (const day of days) {
        const column = columns.createDiv({ cls: "tm-calendar-week-day" });
        renderDayLane(column, day);
      }
      scrollTimeGrid(scroll, days);
    }
  } else if (options.scope === "month") monthGrid(surface, options.anchor, false);
  else {
    const year = surface.createDiv({ cls: "tm-calendar-year", attr: { "data-tm-scroll-key": "calendar-year" } });
    for (let month = 0; month < 12; month++) {
      const section = year.createDiv();
      const anchor = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
      section.createEl("h3", { text: localDate(anchor).toLocaleDateString(undefined, { month: "long" }) });
      monthGrid(section, anchor, true);
      const monthTasks = byMonth.get(anchor.slice(0, 7)) ?? [];
      if (monthTasks.length) {
        const list = section.createEl("details", { cls: "tm-calendar-month-tasks" });
        list.createEl("summary", { text: `${monthTasks.length} tasks — expand to drag` });
        // Closed lists stay empty until first opened.
        let built = false;
        list.addEventListener("toggle", () => {
          if (built || !list.open) return;
          built = true;
          for (const task of monthTasks) taskCard(list, task);
        });
      }
    }
  }
  const unscheduled = byDate.get("") ?? [];
  if (unscheduled.length || planner) {
    const tray = (planner ?? surface).createEl("section", { cls: "tm-calendar-unscheduled", attr: { "data-tm-scroll-key": "calendar-tray" } });
    tray.createEl("h3", { text: "Unscheduled" });
    tray.createEl("p", { cls: "tm-calendar-plan-hint", text: unscheduled.length ? "Drag a task onto the calendar to schedule it." : "No unscheduled tasks." });
    const list = tray.createDiv({ cls: "tm-calendar-unscheduled-list" });
    let shown = 0;
    const showMore = (): HTMLElement | undefined => {
      const page = unscheduled.slice(shown, shown + UNSCHEDULED_PAGE);
      shown += page.length;
      return page.map(task => taskCard(list, task))[0];
    };
    showMore();
    if (shown < unscheduled.length) {
      const more = tray.createEl("button", { cls: "tm-show-more-tasks" });
      const label = (): void => {
        const remaining = unscheduled.length - shown;
        more.setText(`Show ${Math.min(UNSCHEDULED_PAGE, remaining)} more (${remaining} hidden)`);
      };
      label();
      more.addEventListener("click", () => {
        const first = showMore();
        if (shown < unscheduled.length) { label(); return; }
        // The button goes away, so keep focus on the first newly shown task.
        more.remove();
        first?.querySelector<HTMLElement>(".tm-calendar-task-title")?.focus();
      });
    }
  }
}
