import { Notice, setIcon } from "obsidian";
import { addDays } from "./calendar";
import { formatDate, todayIso } from "./date";
import { projectHierarchy } from "./project-hierarchy";
import { ganttSegments, daysBetween, ganttDateAt, ganttSelection, ganttRange, resizeProjectDate, GANTT_ZOOMS, type GanttZoom, type GanttHandle, type ProjectDateField } from "./gantt";
import type { Project } from "./types";
import type { ProjectDraft } from "./project-creator";
import { renderProjectProgress } from "./project-progress";
import { renderProjectDeadline } from "./project-header-details";

interface GanttOptions {
  projects: Project[];
  anchor: string;
  zoom: GanttZoom;
  dateFormat: string;
  navigate: (anchor: string, zoom: GanttZoom) => void;
  viewportChanged?: (anchor: string) => void;
  open: (project: Project) => void;
  edit?: (project: Project, field: keyof ProjectDraft) => void;
  update: (project: Project, changes: Partial<Record<ProjectDateField, string>>) => Promise<void>;
}
export function renderGantt(container: HTMLElement, options: GanttOptions): void {
  const root = container.createDiv({ cls: "tm-gantt" });
  const { days: period, width } = GANTT_ZOOMS[options.zoom];
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
    button.addEventListener("click", () => options.navigate(addDays(anchor, delta * period), options.zoom));
  }
  const today = controls.createEl("button", { text: "Today" });
  today.addEventListener("click", () => options.navigate(addDays(todayIso(), -2), options.zoom));
  const first = toolbar.createEl("button", { cls: "tm-gantt-first", text: "First project" });
  const earliest = options.projects.map(project => project.scheduledDate).filter((date): date is string => Boolean(date)).sort()[0];
  first.disabled = !earliest;
  first.addEventListener("click", () => { if (earliest) options.navigate(addDays(earliest, -1), options.zoom); });
  const scopes = controls.createDiv({ cls: "tm-calendar-scopes", attr: { "aria-label": "Gantt date range" } });
  for (const [value, label] of [["month", "M"], ["quarter", "Q"], ["year", "Y"], ["five-year", "5Y"]] as const) {
    const button = scopes.createEl("button", { text: label, attr: { "aria-label": value === "five-year" ? "5 years" : value[0].toUpperCase() + value.slice(1), "aria-pressed": String(options.zoom === value) } });
    button.addEventListener("click", () => options.navigate(anchor, value));
  }
  const scroll = root.createDiv({ cls: "tm-gantt-scroll", attr: { "aria-label": "Project timeline", tabindex: "0" } });
  const buffer = Math.max(period, Math.ceil((scroll.clientWidth || 1200) / width));
  days = buffer * 5;
  start = addDays(anchor, -buffer * 2);
  scroll.style.setProperty("--tm-gantt-width", `${days * width}px`);
  scroll.style.setProperty("--tm-gantt-day", `${width}px`);
  const header = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-header" });
  header.createDiv({ cls: "tm-gantt-label", text: "Project" });
  const dates = header.createDiv({ cls: "tm-gantt-dates" });
  let segments = ganttSegments(start, days, options.zoom);
  const paintDates = (): void => {
    segments = ganttSegments(start, days, options.zoom);
    dates.empty();
    for (const segment of segments) {
      const cell = dates.createDiv({ cls: "tm-gantt-date", text: segment.label, attr: { title: formatDate(segment.start, options.dateFormat) } });
      cell.style.width = `${segment.days * width}px`;
      cell.style.flexBasis = `${segment.days * width}px`;
    }
  };
  paintDates();
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
  const grouped = [false, true].flatMap(archived => projectHierarchy(options.projects.filter(project => project.archived === archived))
    .map(entry => ({ ...entry, group: archived ? "Archived" : "Active" })));
  let previousGroup = "";
  for (const { project, depth, group } of grouped) {
    if (group !== previousGroup) {
      const heading = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-group" });
      heading.createDiv({ cls: "tm-gantt-label", text: group, attr: { role: "heading", "aria-level": "2" } });
      heading.createDiv({ cls: "tm-gantt-track", attr: { "aria-hidden": "true" } });
      previousGroup = group;
    }
    const row = scroll.createDiv({ cls: `tm-gantt-row${project.archived ? " is-archived" : ""}` });
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
      renderProjectDeadline(metadata, project, field => options.edit ? options.edit(project, field) : options.open(project), options.dateFormat);
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
      track.setAttribute("aria-label", `Drag to schedule ${project.name}`);
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
    jump.addEventListener("click", () => options.navigate(addDays(project.scheduledDate!, -1), options.zoom));
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
      bar.setAttribute("title", `${project.name}: ${formatDate(span.start, options.dateFormat)} – ${formatDate(span.end, options.dateFormat)} (${span.finishField === "deadline" ? "deadline" : "end date"})`);
      for (const [handle, button] of handles) {
        const date = candidate[fieldFor(handle)]!;
        const offset = daysBetween(start, date);
        button.hidden = offset < 0 || offset >= days;
        button.style.left = `${offset * width + (handle === "finish" ? width - 10 : handle === "end" ? width / 2 - 6 : 2)}px`;
        button.setAttribute("title", `${handle === "start" ? "Start" : fieldFor(handle) === "deadline" ? "Deadline" : "End"}: ${formatDate(date, options.dateFormat)} — drag or use arrow keys`);
      }
    };
    paint(project);
    painters.push(() => paint(project));
    for (const [handle, button] of handles) {
      let pointer: number | undefined;
      let origin = 0;
      let originScroll = 0;
      let delta = 0;
      const reset = (): void => { pointer = undefined; interacting = false; delta = 0; row.removeClass("is-resizing"); paint(project); };
      const save = async (change: number): Promise<void> => {
        const { field, value } = resizeProjectDate(project, handle, change);
        if (value === project[field] || busy) return;
        await persist(project, { [field]: value });
        reset();
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
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        void save(event.key === "ArrowLeft" ? -1 : 1);
      });
    }
  }
  scroll.scrollLeft = buffer * 2 * width;
  syncViewport();

}
