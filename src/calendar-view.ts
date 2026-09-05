import { Notice, setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { formatDuration } from "./parser";
import { calendarDate, calendarDays, calendarTime, localDate, minuteTime, resizedRange, selectionPreset, shiftCalendar, timeMinutes, type CalendarPreset, type CalendarScope } from "./calendar";
import type { Task } from "./types";

export interface CalendarOptions {
  anchor: string;
  scope: CalendarScope;
  tasks: Task[];
  dateFormat: string;
  navigate: (anchor: string, scope: CalendarScope) => void;
  create: (preset: CalendarPreset) => void;
  edit: (task: Task) => void;
  resize: (task: Task, date: string, time: string, duration: number) => Promise<void>;
  move: (task: Task, date: string, time?: string) => Promise<void>;
}

/** Render inside the task view; all writes go through its existing task store. */
export function renderCalendar(container: HTMLElement, options: CalendarOptions): void {
  const root = container.createDiv({ cls: "tm-calendar" });
  const byDate = new Map<string, Task[]>();
  for (const task of options.tasks) {
    const key = calendarDate(task) ?? "";
    const group = byDate.get(key) ?? [];
    group.push(task);
    byDate.set(key, group);
  }
  let dragged: Task | undefined;
  let moving = false;
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]] as const) {
    const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", () => options.navigate(shiftCalendar(options.anchor, options.scope, delta), options.scope));
  }
  const today = toolbar.createEl("button", { text: "Today" });
  today.addEventListener("click", () => options.navigate(todayIso(), options.scope));
  const date = localDate(options.anchor);
  const days = options.scope === "week" ? calendarDays(options.anchor, "week") : [];
  const title = options.scope === "day" ? formatDate(options.anchor, options.dateFormat)
    : options.scope === "week" ? `${formatDate(days[0], options.dateFormat)} – ${formatDate(days[6], options.dateFormat)}`
    : options.scope === "year" ? String(date.getFullYear()) : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  toolbar.createEl("h2", { text: title });
  const scopes = toolbar.createDiv({ cls: "tm-calendar-scopes", attr: { "aria-label": "Calendar scope" } });
  for (const scope of ["day", "week", "month", "year"] as const) {
    const button = scopes.createEl("button", { text: scope[0].toUpperCase() + scope.slice(1), attr: { "aria-pressed": String(options.scope === scope) } });
    button.addEventListener("click", () => options.navigate(options.anchor, scope));
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
  const taskCard = (parent: HTMLElement, task: Task): HTMLButtonElement => {
    const time = calendarTime(task);
    const card = parent.createEl("button", { cls: `tm-calendar-task${task.completed ? " is-completed" : ""}`, text: `${time ? `${time} ` : ""}${task.title}`,
      attr: { title: `${task.title}${task.durationMinutes ? ` · ${formatDuration(task.durationMinutes)}` : ""}`, "aria-label": `Edit ${task.title}` } });
    card.draggable = true;
    card.addEventListener("click", event => { event.stopPropagation(); options.edit(task); });
    card.addEventListener("dragstart", event => {
      dragged = task;
      event.stopPropagation();
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }
    });
    card.addEventListener("dragend", () => { dragged = undefined; root.querySelectorAll(".is-drop-target").forEach(el => el.removeClass("is-drop-target")); });
    return card;
  };
  const dateCell = (parent: HTMLElement, day: string, compact = false, outside = false): void => {
    const cell = parent.createDiv({ cls: `tm-calendar-cell${day === todayIso() ? " is-today" : ""}${outside ? " is-outside" : ""}` });
    const tasks = byDate.get(day) ?? [];
    const button = cell.createEl("button", { cls: "tm-calendar-date", text: String(localDate(day).getDate()), attr: { "aria-label": `New task on ${formatDate(day, options.dateFormat)}` } });
    button.addEventListener("click", () => options.create({ scheduledDate: day }));
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
      const label = timeline.createDiv({ cls: "tm-calendar-hour", text: minuteTime(hour * 60) });
      label.style.top = `${hour * 48}px`;
    }
  };
  const renderDayLane = (timeline: HTMLElement, day: string): void => {
    const tasks = byDate.get(day) ?? [];
    const lane = timeline.createDiv({ cls: "tm-calendar-lane", attr: { "aria-label": `Daily schedule for ${day}` } });
    for (let slot = 0; slot < 96; slot++) {
      const button = lane.createEl("button", { cls: "tm-calendar-slot", attr: { "aria-label": `Create task on ${day} at ${minuteTime(slot * 15)}` } });
      button.addEventListener("click", event => { if (event.detail === 0) options.create(selectionPreset(day, slot, slot)); });
    }
    const slotAt = (clientY: number): number => Math.max(0, Math.min(95, Math.floor((clientY - lane.getBoundingClientRect().top) / 12)));
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
    dropTarget(lane, day, event => minuteTime(slotAt(event.clientY) * 15));
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
      card.style.left = `calc(${column / ends.length * 85}% + 2px)`;
      card.style.width = `calc(${85 / ends.length}% - 4px)`;
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
          update((event.clientY - lane.getBoundingClientRect().top) / 12 * 15);
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
  if (options.scope === "day" || options.scope === "week") {
    if (options.scope === "day") {
      const allDay = root.createDiv({ cls: "tm-calendar-allday" });
      allDay.createSpan({ text: "No time" });
      for (const task of (byDate.get(options.anchor) ?? []).filter(task => !calendarTime(task))) taskCard(allDay, task);
      const scroll = root.createDiv({ cls: "tm-calendar-day-scroll" });
      const timeline = scroll.createDiv({ cls: "tm-calendar-timeline" });
      renderHours(timeline);
      renderDayLane(timeline, options.anchor);
    } else {
      // One scroll surface keeps all seven timelines and the hour labels aligned.
      const scroll = root.createDiv({ cls: "tm-calendar-day-scroll tm-calendar-week-scroll" });
      const week = scroll.createDiv({ cls: "tm-calendar-week" });
      const header = week.createDiv({ cls: "tm-calendar-week-header" });
      header.createSpan({ cls: "tm-calendar-week-gutter", text: "No time" });
      for (const day of days) {
        const column = header.createDiv({ cls: `tm-calendar-week-heading${day === todayIso() ? " is-today" : ""}` });
        const button = column.createEl("button", { cls: "tm-calendar-date", text: localDate(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), attr: { "aria-label": `New task on ${formatDate(day, options.dateFormat)}` } });
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
  } else if (options.scope === "month") monthGrid(root, options.anchor, false);
  else {
    const year = root.createDiv({ cls: "tm-calendar-year" });
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
  if (unscheduled.length) {
    const tray = root.createEl("section", { cls: "tm-calendar-unscheduled" });
    tray.createEl("h3", { text: "Unscheduled — drag onto a date" });
    for (const task of unscheduled) taskCard(tray, task);
  }
}
