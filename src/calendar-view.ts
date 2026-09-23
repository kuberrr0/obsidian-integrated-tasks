import { taskTimeLabel, taskTimeDurationLabel } from "./task-row-details";
import { taskTitleLabel } from "./task-title";
import { renderDescriptionIndicator } from "./task-description-indicator";
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
  dragStart?: (task: Task) => void;
  resize: (task: Task, date: string, time: string, duration: number) => Promise<void>;
  move: (task: Task, date: string, time?: string) => Promise<void>;
}

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
  for (const task of options.tasks) {
    const key = calendarDate(task) ?? "";
    const group = byDate.get(key) ?? [];
    group.push(task);
    byDate.set(key, group);
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
  const surface = body.createDiv({ cls: "tm-calendar-surface" });
  const planner = options.planning ? body.createEl("aside", { cls: "tm-calendar-planner", attr: { "aria-label": "Plan tasks" } }) : undefined;
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
    const card = parent.createDiv({ cls: `tm-calendar-task${task.completed ? " is-completed" : ""}`,
      attr: { role: "button", tabindex: "0", title: `${task.title}${task.durationMinutes ? ` · ${formatDuration(task.durationMinutes)}` : ""}`, "aria-label": `Edit ${task.title}` } });
    const checkbox = card.createEl("input", { cls: "tm-calendar-check", type: "checkbox", attr: { "aria-label": `Complete ${taskTitleLabel(task.title)}` } });
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
    card.addEventListener("keydown", event => {
      if (!options.bind && event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); event.stopPropagation(); options.edit(task);
      }
    });
    const title = card.createSpan({ cls: "tm-calendar-task-title", text: taskTitleLabel(task.title) });
    const timeLabel = taskTimeDurationLabel(time, task.durationMinutes);
    if (timeLabel) card.createSpan({ cls: "tm-calendar-task-time", text: timeLabel });
    if (task.deadline && calendarDate(task) === task.deadline && (time ?? "") === (task.deadlineTime ?? "")) {
      setIcon(card.createSpan({ cls: "tm-calendar-task-flag", attr: { "aria-label": "Deadline" } }), "flag");
    }
    renderDescriptionIndicator(title, task.description);
    card.draggable = true;
    card.addEventListener("click", event => {
      if (!options.bind || (event.target as HTMLElement).closest(".tm-calendar-task-title")) {
        event.stopPropagation(); options.edit(task);
      }
    });
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
      label.style.top = `${hour * 48}px`;
    }
  };
  const renderDayLane = (timeline: HTMLElement, day: string): void => {
    const tasks = byDate.get(day) ?? [];
    const lane = timeline.createDiv({ cls: "tm-calendar-lane", attr: { "aria-label": `Daily schedule for ${day}` } });
    if (day === todayIso()) {
      const now = new Date();
      const marker = lane.createSpan({ cls: "tm-calendar-now", attr: { "aria-hidden": "true" } });
      marker.style.top = `${(now.getHours() * 60 + now.getMinutes()) / 15 * 12}px`;
    }
    for (let slot = 0; slot < 96; slot++) {
      const button = lane.createEl("button", { cls: `tm-calendar-slot${slot > 0 && slot % 4 === 0 ? " is-hour-start" : ""}`, attr: { "aria-label": `Create task on ${day} at ${minuteTime(slot * 15)}` } });
      button.addEventListener("click", event => { if (event.detail === 0) options.create(selectionPreset(day, slot, slot)); });
    }
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
          role: "slider", tabindex: "0", "aria-label": `Resize ${edge === "start" ? "start time" : "end time"} of ${task.title}`,
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
        const save = (): void => {
          if (range.start === begin && range.duration === end - begin) { restore(); return; }
          moving = true;
          card.setAttribute("aria-busy", "true");
          void options.resize(task, day, minuteTime(range.start), range.duration).catch(cause => {
            restore();
            new Notice(cause instanceof Error ? cause.message : "Could not resize task.");
          }).finally(() => { moving = false; card.removeAttribute("aria-busy"); restore(); });
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
        handle.addEventListener("keydown", event => {
          if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (moving) return;
          update((edge === "start" ? begin : end) + (event.key === "ArrowUp" ? -15 : 15));
          save();
        });
      }
    }
  };
  if (options.scope === "day" || options.scope === "week" || options.scope === "four-day") {
    if (options.scope === "day") {
      const allDay = surface.createDiv({ cls: "tm-calendar-allday" });
      allDay.createSpan({ text: "all-day" });
      for (const task of (byDate.get(options.anchor) ?? []).filter(task => !calendarTime(task))) taskCard(allDay, task);
      const scroll = surface.createDiv({ cls: "tm-calendar-day-scroll" });
      const timeline = scroll.createDiv({ cls: "tm-calendar-timeline" });
      renderHours(timeline);
      renderDayLane(timeline, options.anchor);
    } else {
      // One scroll surface keeps all seven timelines and the hour labels aligned.
      const scroll = surface.createDiv({ cls: "tm-calendar-day-scroll tm-calendar-week-scroll" });
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
    }
  } else if (options.scope === "month") monthGrid(surface, options.anchor, false);
  else {
    const year = surface.createDiv({ cls: "tm-calendar-year" });
    for (let month = 0; month < 12; month++) {
      const section = year.createDiv();
      const anchor = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
      section.createEl("h3", { text: localDate(anchor).toLocaleDateString(undefined, { month: "long" }) });
      monthGrid(section, anchor, true);
      const monthTasks = options.tasks.filter(task => calendarDate(task)?.slice(0, 7) === anchor.slice(0, 7));
      if (monthTasks.length) {
        const list = section.createEl("details", { cls: "tm-calendar-month-tasks" });
        list.createEl("summary", { text: `${monthTasks.length} tasks — expand to drag` });
        for (const task of monthTasks) taskCard(list, task);
      }
    }
  }
  const unscheduled = byDate.get("") ?? [];
  if (unscheduled.length || planner) {
    const tray = (planner ?? surface).createEl("section", { cls: "tm-calendar-unscheduled" });
    tray.createEl("h3", { text: "Unscheduled" });
    tray.createEl("p", { cls: "tm-calendar-plan-hint", text: unscheduled.length ? "Drag a task onto the calendar to schedule it." : "No unscheduled tasks." });
    for (const task of unscheduled) taskCard(tray, task);
  }
}
