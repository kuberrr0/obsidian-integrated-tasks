import { Notice, setIcon } from "obsidian";
import { addDays, daysBetween } from "./calendar";
import { formatDate, todayIso } from "./date";
import { projectHierarchy } from "./project-hierarchy";
import { ganttSegments, ganttZoomFor, shiftGantt, GANTT_MAX_SCALE, GANTT_MIN_SCALE, ganttDateAt, ganttSelection, ganttRange, resizeProjectDate, GANTT_ZOOMS, type GanttZoom, type GanttHandle, type ProjectDateField } from "./gantt";
import type { Project } from "./types";
import type { ProjectDraft } from "./project-creator";
import { projectStatuses, renderProjectProgress, type ProjectStatus } from "./project-progress";
import { renderProjectDeadline } from "./project-header-details";
import { renderThingsProjectDeadline } from "./things-row-details";

interface GanttOptions {
  projects: Project[];
  anchor: string;
  zoom: GanttZoom;
  dateFormat: string;
  /** Moves to `anchor`: in a range's own scale, or (moving within a zoomed scale) in `scale`. */
  navigate: (anchor: string, zoom: GanttZoom, scale?: number) => void;
  viewportChanged?: (anchor: string) => void;
  /** A scale zoomed to (pixels per day) instead of the range's own; the timeline then redraws itself. */
  scale?: number;
  zoomed?: (anchor: string, zoom: GanttZoom, scale: number) => void;
  open: (project: Project) => void;
  edit?: (project: Project, field: keyof ProjectDraft) => void;
  update: (project: Project, changes: Partial<Record<ProjectDateField, string>>) => Promise<void>;
  /** Draw deadlines as the Things style does ("N days left"), rather than as a pill. */
  things?: boolean;
}

// Arrow keys preview date changes live and save once they pause, so focus is not lost per key.
const KEY_SAVE_DELAY_MS = 500;
/** Each zoom button (or + and - key) press scales the timeline by this much. */
const ZOOM_STEP = 1.5;
export function renderGantt(container: HTMLElement, options: GanttOptions): void {
  const root = container.createDiv({ cls: "tm-gantt" });
  // Zoomed in or out, the scale reads as the range nearest it.
  const scale = options.scale === undefined ? undefined : Math.min(GANTT_MAX_SCALE, Math.max(GANTT_MIN_SCALE, options.scale));
  const zoom = scale === undefined ? options.zoom : ganttZoomFor(scale);
  const width = scale ?? GANTT_ZOOMS[zoom].width;
  const period = GANTT_ZOOMS[zoom].days;
  let anchor = options.anchor;
  let start = anchor;
  let days = period;
  let interacting = false;
  const painters: Array<() => void> = [];
  const detailPainters = new Map<Project, () => void>();
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar tm-gantt-toolbar" });
  const controls = toolbar.createDiv({ cls: "tm-calendar-controls" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]] as const) {
    const button = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", () => options.navigate(shiftGantt(anchor, zoom, delta), zoom, scale));
  }
  const today = controls.createEl("button", { text: "Today" });
  today.addEventListener("click", () => options.navigate(addDays(todayIso(), -2), zoom, scale));
  const scopes = controls.createDiv({ cls: "tm-calendar-scopes", attr: { "aria-label": "Gantt date range" } });
  for (const [value, label] of [["month", "M"], ["quarter", "Q"], ["year", "Y"], ["five-year", "5Y"]] as const) {
    const button = scopes.createEl("button", { text: label, attr: { "aria-label": value === "five-year" ? "5 years" : value[0].toUpperCase() + value.slice(1), "aria-pressed": String(zoom === value) } });
    button.addEventListener("click", () => options.navigate(anchor, value));
  }
  const zooming = toolbar.createDiv({ cls: "tm-gantt-zoom" });
  for (const [factor, icon, label] of [[1 / ZOOM_STEP, "zoom-out", "Zoom out"], [ZOOM_STEP, "zoom-in", "Zoom in"]] as const) {
    const button = zooming.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.disabled = factor > 1 ? width >= GANTT_MAX_SCALE : width <= GANTT_MIN_SCALE;
    button.addEventListener("click", () => zoomBy(factor));
  }
  const scroll: HTMLElement = root.createDiv({ cls: "tm-gantt-scroll", attr: { "aria-label": "Project timeline", tabindex: "0", "data-tm-scroll-key": "gantt", "data-tm-scroll-axis": "y" } });
  const buffer = Math.max(period, Math.ceil((scroll.clientWidth || 1200) / width));
  days = buffer * 5;
  start = addDays(anchor, -buffer * 2);
  scroll.style.setProperty("--tm-gantt-width", `${days * width}px`);
  scroll.style.setProperty("--tm-gantt-day", `${width}px`);
  const header = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-header" });
  header.createDiv({ cls: "tm-gantt-label", text: "Project" });
  const dates = header.createDiv({ cls: "tm-gantt-dates" });
  let segments = ganttSegments(start, days, zoom);
  const paintDates = (): void => {
    segments = ganttSegments(start, days, zoom);
    dates.empty();
    for (const segment of segments) {
      const cell = dates.createDiv({ cls: "tm-gantt-date", text: segment.label, attr: { title: formatDate(segment.start, options.dateFormat) } });
      if (segment.year) cell.createSpan({ cls: "tm-gantt-year", text: segment.year });
      cell.style.width = `${segment.days * width}px`;
      cell.style.flexBasis = `${segment.days * width}px`;
    }
  };
  paintDates();

  /**
   * Zooms by `factor` about a point of the timeline (`at`, in pixels from the dates' left edge; else the middle of the
   * dates in view), keeping the date there in place: the timeline redraws at the new scale.
   */
  const zoomBy = (factor: number, at?: number): void => {
    const next = Math.min(GANTT_MAX_SCALE, Math.max(GANTT_MIN_SCALE, width * factor));
    if (Math.abs(next - width) < 0.001 || !root.isConnected) return;
    const labelWidth = header.firstElementChild?.getBoundingClientRect().width ?? 330;
    const x = Math.max(0, at !== undefined && Number.isFinite(at) ? at : (scroll.clientWidth - labelWidth) / 2);
    // Days from the timeline's start: to the point, then to the dates' left edge at the new scale.
    const left = (scroll.scrollLeft + x) / width - x / next;
    const day = Math.floor(left);
    const nextAnchor = addDays(start, day);
    const nextZoom = ganttZoomFor(next);
    const top = scroll.scrollTop;
    const focused = scroll.ownerDocument.activeElement === scroll;
    options.zoomed?.(nextAnchor, nextZoom, next);
    root.remove();
    renderGantt(container, { ...options, anchor: nextAnchor, zoom: nextZoom, scale: next });
    const redrawn = container.querySelector<HTMLElement>(".tm-gantt-scroll");
    if (!redrawn) return;
    redrawn.scrollLeft += (left - day) * next;
    redrawn.scrollTop = top;
    if (focused) redrawn.focus({ preventScroll: true });
  };
  // The wheel zooms about the pointer over the dates, or anywhere with Ctrl/Cmd held (as a trackpad's pinch does);
  // elsewhere it scrolls. Wheel steps between frames zoom once.
  let wheelFactor = 1;
  let wheelAt = 0;
  let wheelFrame: number | undefined;
  scroll.addEventListener("wheel", event => {
    if (!event.deltaY || !(event.ctrlKey || event.metaKey || header.contains(event.target as Node))) return;
    event.preventDefault();
    const labelWidth = header.firstElementChild?.getBoundingClientRect().width ?? 330;
    wheelAt = event.clientX - scroll.getBoundingClientRect().left - labelWidth;
    wheelFactor *= Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
    wheelFrame ??= (scroll.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
      wheelFrame = undefined;
      const factor = wheelFactor;
      wheelFactor = 1;
      zoomBy(factor, wheelAt);
    });
  }, { passive: false });
  // Dragging with the right mouse button pans the timeline, across and down.
  let pan: { id: number; x: number; y: number } | undefined;
  scroll.addEventListener("pointerdown", event => {
    if (event.button !== 2) return;
    event.preventDefault();
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
    scroll.setPointerCapture(event.pointerId);
    scroll.addClass("is-panning");
  });
  scroll.addEventListener("pointermove", event => {
    if (pan?.id !== event.pointerId) return;
    scroll.scrollLeft -= event.clientX - pan.x;
    scroll.scrollTop -= event.clientY - pan.y;
    pan.x = event.clientX;
    pan.y = event.clientY;
  });
  const endPan = (event: PointerEvent): void => {
    if (pan?.id !== event.pointerId) return;
    pan = undefined;
    scroll.removeClass("is-panning");
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) scroll.addEventListener(type, endPan);
  // The right button pans here; the timeline has no menu of its own.
  scroll.addEventListener("contextmenu", event => event.preventDefault());
  // With the timeline focused, + and - zoom in and out.
  scroll.addEventListener("keydown", event => {
    if (event.target !== scroll || event.ctrlKey || event.metaKey || event.altKey) return;
    const factor = event.key === "+" || event.key === "=" ? ZOOM_STEP : event.key === "-" ? 1 / ZOOM_STEP : undefined;
    if (!factor) return;
    event.preventDefault();
    zoomBy(factor);
  });
  const syncViewport = (): void => {
    const labelWidth = header.firstElementChild?.getBoundingClientRect().width ?? 330;
    const visibleDays = Math.max(1, Math.ceil((scroll.clientWidth - labelWidth) / width));
    anchor = addDays(start, Math.floor(scroll.scrollLeft / width));
    options.viewportChanged?.(anchor);
    if (interacting) return;
    const offset = Math.floor(scroll.scrollLeft / width);
    if (offset < buffer || offset + visibleDays > days - buffer) {
      const shift = offset - buffer * 2;
      start = addDays(start, shift);
      paintDates();
      for (const paint of painters) paint();
      scroll.scrollLeft -= shift * width;
    }
  };
  scroll.addEventListener("scroll", syncViewport);
  let busy = false;
  const persist = async (project: Project, changes: Partial<Record<ProjectDateField, string>>, rebuild = false): Promise<void> => {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await options.update(project, changes);
      Object.assign(project, changes);
      detailPainters.get(project)?.();
      if (rebuild && root.isConnected) {
        const fraction = scroll.scrollLeft % width;
        const top = scroll.scrollTop;
        root.remove();
        renderGantt(container, { ...options, anchor });
        const next = container.querySelector<HTMLElement>(".tm-gantt-scroll");
        if (next) { next.scrollLeft += fraction; next.scrollTop = top; }
      }
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not update project dates.");
    } finally { busy = false; root.removeAttribute("aria-busy"); }
  };
  const statuses = projectStatuses(options.projects);
  const groups: Array<[ProjectStatus, string]> = [["active", "Active"], ["completed", "Completed"], ["archived", "Archived"]];
  const grouped = groups.flatMap(([status, group]) => projectHierarchy(options.projects.filter(project => statuses.get(project.path) === status))
    .map(entry => ({ ...entry, group })));
  let previousGroup = "";
  for (const { project, depth, group } of grouped) {
    if (group !== previousGroup) {
      const heading = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-group" });
      heading.createDiv({ cls: "tm-gantt-label", text: group, attr: { role: "heading", "aria-level": "2" } });
      heading.createDiv({ cls: "tm-gantt-track", attr: { "aria-hidden": "true" } });
      previousGroup = group;
    }
    const row = scroll.createDiv({ cls: `tm-gantt-row${project.archived ? " is-archived" : statuses.get(project.path) === "completed" ? " is-completed" : ""}` });
    const label = row.createDiv({ cls: "tm-gantt-label tm-gantt-project" });
    label.style.paddingLeft = `${12 + depth * 16}px`;
    const icon = label.createSpan({ cls: "tm-project-icon" });
    renderProjectProgress(icon, project, false);
    const content = label.createDiv({ cls: "tm-gantt-project-content" });
    const title = content.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path, "aria-label": `Open ${project.name} project note` } });
    title.addEventListener("click", () => options.open(project));
    const metadata = content.createDiv({ cls: "tm-project-header-metadata" });
    const paintDetails = (): void => {
      metadata.empty();
      const edit = (field: keyof ProjectDraft): void => options.edit ? options.edit(project, field) : options.open(project);
      if (options.things) renderThingsProjectDeadline(metadata, project, { dateFormat: options.dateFormat, edit });
      else renderProjectDeadline(metadata, project, edit, options.dateFormat);
      metadata.hidden = !metadata.childElementCount;
    };
    detailPainters.set(project, paintDetails);
    paintDetails();
    const track = row.createDiv({ cls: "tm-gantt-track" });
    const grid = track.createDiv({ cls: "tm-gantt-grid", attr: { "aria-hidden": "true" } });
    const paintGrid = (): void => {
      grid.empty();
      for (const segment of segments) {
        const line = grid.createSpan({ cls: "tm-gantt-grid-line" });
        line.style.left = `${segment.offset * width}px`;
      }
    };
    painters.push(paintGrid);
    paintGrid();
    const marker = track.createSpan({ cls: "tm-gantt-today" });
    const paintToday = (): void => {
      const todayOffset = daysBetween(start, todayIso());
      marker.hidden = todayOffset < 0 || todayOffset >= days;
      marker.style.left = `${todayOffset * width}px`;
    };
    painters.push(paintToday);
    paintToday();
    const range = ganttRange(project);
    if (!range && !project.scheduledDate && !project.endDate && !project.deadline) {
      track.addClass("is-unscheduled");
      // Dragging needs a pointer; the keyboard opens the project editor at its start date instead.
      track.setAttribute("role", "button");
      track.setAttribute("tabindex", "0");
      track.setAttribute("aria-label", `Set dates for ${project.name}`);
      track.addEventListener("keydown", event => {
        if (event.target !== track || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        if (options.edit) options.edit(project, "date"); else options.open(project);
      });
      const hint = track.createSpan({ cls: "tm-gantt-undated", text: "Drag to set dates" });
      const selection = track.createDiv({ cls: "tm-gantt-selection" });
      selection.hidden = true;
      let pointer: number | undefined;
      let first = "";
      let last = "";
      const dateAt = (event: PointerEvent): string => ganttDateAt(start, event.clientX - track.getBoundingClientRect().left, width, days);
      const paintSelection = (): void => {
        const dates = ganttSelection(first, last);
        selection.hidden = false;
        selection.style.left = `${daysBetween(start, dates.scheduledDate) * width + 2}px`;
        selection.style.width = `${(daysBetween(dates.scheduledDate, dates.endDate) + 1) * width - 4}px`;
      };
      const resetSelection = (): void => { pointer = undefined; interacting = false; selection.hidden = true; hint.hidden = false; };
      track.addEventListener("pointerdown", event => {
        if (event.button !== 0 || busy) return;
        event.preventDefault();
        pointer = event.pointerId; interacting = true;
        first = last = dateAt(event);
        hint.hidden = true;
        track.setPointerCapture(event.pointerId);
        paintSelection();
      });
      track.addEventListener("pointermove", event => {
        if (pointer !== event.pointerId) return;
        last = dateAt(event);
        paintSelection();
      });
      track.addEventListener("pointerup", event => {
        if (pointer !== event.pointerId) return;
        last = dateAt(event);
        const dates = ganttSelection(first, last);
        resetSelection();
        track.releasePointerCapture(event.pointerId);
        void persist(project, dates, true);
      });
      track.addEventListener("pointercancel", resetSelection);
      track.addEventListener("lostpointercapture", () => { if (pointer !== undefined) resetSelection(); });
      continue;
    }
    if (!range) {
      const missing = !project.scheduledDate ? "Set start date" : !project.endDate ? "Set end date" : "Finish is before start";
      const edit = track.createEl("button", { cls: "tm-gantt-jump", text: missing });
      edit.addEventListener("click", () => options.open(project));
      continue;
    }
    const bar = track.createEl("button", { cls: "tm-gantt-bar" });
    bar.addEventListener("click", () => { if (!busy) options.open(project); });
    const jump = track.createEl("button", { cls: "tm-gantt-jump", text: `Show ${formatDate(range.start, options.dateFormat)}` });
    jump.addEventListener("click", () => options.navigate(addDays(project.scheduledDate!, -1), zoom, scale));
    const handles = new Map<GanttHandle, HTMLButtonElement>();
    const fieldFor = (handle: GanttHandle): ProjectDateField => handle === "start" ? "scheduledDate" : "endDate";
    for (const handle of ["start", "finish"] as GanttHandle[]) {
      const button = track.createEl("button", { cls: `tm-gantt-handle is-${handle}`, attr: { "aria-label": `${project.name}: change ${handle === "start" ? "start date" : "end date"}` } });
      handles.set(handle, button);
    }
    const paint = (candidate: Project): void => {
      const span = ganttRange(candidate)!;
      const from = daysBetween(start, span.start);
      const to = daysBetween(start, span.end) + 1;
      bar.hidden = to <= 0 || from >= days;
      jump.hidden = !bar.hidden;
      bar.style.left = `${Math.max(0, from) * width + 2}px`;
      bar.style.width = `${Math.max(8, (Math.min(days, to) - Math.max(0, from)) * width - 4)}px`;
      bar.setText(`${formatDate(span.start, options.dateFormat)} – ${formatDate(span.end, options.dateFormat)}`);
      bar.setAttribute("title", `${project.name}: ${formatDate(span.start, options.dateFormat)} – ${formatDate(span.end, options.dateFormat)} (end date)`);
      for (const [handle, button] of handles) {
        const date = candidate[fieldFor(handle)]!;
        const offset = daysBetween(start, date);
        button.hidden = offset < 0 || offset >= days;
        button.style.left = `${offset * width + (handle === "finish" ? width - 10 : 2)}px`;
        button.setAttribute("title", `${handle === "start" ? "Start" : "End"}: ${formatDate(date, options.dateFormat)} — drag or use arrow keys`);
      }
    };
    if (project.color) {
      bar.addClass("tm-project-colored");
      for (const element of [bar, ...handles.values()]) element.style.setProperty("--tm-project-color", project.color);
    }
    paint(project);
    painters.push(() => paint(project));
    for (const [handle, button] of handles) {
      let pointer: number | undefined;
      let origin = 0;
      let originScroll = 0;
      let delta = 0;
      let keyDelta = 0;
      let keyTimer: number | undefined;
      const reset = (): void => { pointer = undefined; interacting = false; delta = 0; row.removeClass("is-resizing"); paint(project); };
      const save = async (change: number): Promise<void> => {
        const { field, value } = resizeProjectDate(project, handle, change);
        if (value === project[field] || busy) { reset(); return; }
        await persist(project, { [field]: value });
        reset();
      };
      const saveKeys = (): void => {
        window.clearTimeout(keyTimer);
        keyTimer = undefined;
        const change = keyDelta;
        keyDelta = 0;
        void save(change);
      };
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || busy) return;
        event.preventDefault(); event.stopPropagation();
        pointer = event.pointerId; interacting = true; origin = event.clientX; originScroll = scroll.scrollLeft; delta = 0;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", event => {
        if (pointer !== event.pointerId) return;
        delta = Math.round((event.clientX - origin + scroll.scrollLeft - originScroll) / width);
        const { field, value } = resizeProjectDate(project, handle, delta);
        paint({ ...project, [field]: value });
        row.addClass("is-resizing");
      });
      button.addEventListener("pointerup", event => {
        if (pointer !== event.pointerId) return;
        const change = delta;
        reset();
        button.releasePointerCapture(event.pointerId);
        void save(change);
      });
      button.addEventListener("pointercancel", reset);
      button.addEventListener("lostpointercapture", () => { if (pointer !== undefined) reset(); });
      button.addEventListener("keydown", event => {
        if (event.key === "Escape" && keyTimer !== undefined) {
          event.preventDefault();
          window.clearTimeout(keyTimer); keyTimer = undefined; keyDelta = 0; reset();
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        if (busy) return;
        keyDelta += event.key === "ArrowLeft" ? -1 : 1;
        const { field, value } = resizeProjectDate(project, handle, keyDelta);
        paint({ ...project, [field]: value });
        row.addClass("is-resizing");
        window.clearTimeout(keyTimer);
        keyTimer = window.setTimeout(saveKeys, KEY_SAVE_DELAY_MS);
      });
      button.addEventListener("keyup", event => {
        if (keyTimer === undefined || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        window.clearTimeout(keyTimer);
        keyTimer = window.setTimeout(saveKeys, KEY_SAVE_DELAY_MS);
      });
      button.addEventListener("blur", () => { if (keyTimer !== undefined) saveKeys(); });
    }
  }
  const initial = buffer * 2 * width;
  scroll.scrollLeft = initial;
  if (Math.abs(scroll.scrollLeft - initial) < 1) { syncViewport(); return; }
  // Drawn in a hidden tab, the timeline can't scroll yet: it scrolls to its dates once it's shown.
  const Observer = scroll.ownerDocument?.defaultView?.ResizeObserver;
  if (!Observer) return;
  const shown = new Observer(() => {
    if (!scroll.isConnected) { shown.disconnect(); return; }
    if (!scroll.clientWidth) return;
    shown.disconnect();
    scroll.scrollLeft = initial;
    syncViewport();
  });
  shown.observe(scroll);

}
