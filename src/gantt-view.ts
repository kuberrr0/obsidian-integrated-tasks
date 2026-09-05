import { Notice, setIcon } from "obsidian";
import { addDays, localDate } from "./calendar";
import { formatDate, todayIso } from "./date";
import { projectHierarchy } from "./project-hierarchy";
import { daysBetween, ganttDateAt, ganttSelection, ganttRange, resizeProjectDate, GANTT_ZOOMS, type GanttZoom, type GanttHandle, type ProjectDateField } from "./gantt";
import type { Project } from "./types";

interface GanttOptions {
  projects: Project[];
  anchor: string;
  zoom: GanttZoom;
  dateFormat: string;
  navigate: (anchor: string, zoom: GanttZoom) => void;
  open: (project: Project) => void;
  update: (project: Project, changes: Partial<Record<ProjectDateField, string>>) => Promise<void>;
}
export function renderGantt(container: HTMLElement, options: GanttOptions): void {
  const root = container.createDiv({ cls: "tm-gantt" });
  const { days, width } = GANTT_ZOOMS[options.zoom];
  const start = options.anchor;
  const end = addDays(start, days - 1);
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]] as const) {
    const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", () => options.navigate(addDays(start, delta * days), options.zoom));
  }
  const today = toolbar.createEl("button", { text: "Today" });
  today.addEventListener("click", () => options.navigate(addDays(todayIso(), -2), options.zoom));
  const first = toolbar.createEl("button", { text: "First project" });
  const earliest = options.projects.map(project => project.scheduledDate).filter((date): date is string => Boolean(date)).sort()[0];
  first.disabled = !earliest;
  first.addEventListener("click", () => { if (earliest) options.navigate(addDays(earliest, -1), options.zoom); });
  toolbar.createEl("h2", { text: `${formatDate(start, options.dateFormat)} – ${formatDate(end, options.dateFormat)}` });
  const zoom = toolbar.createEl("select", { attr: { "aria-label": "Gantt zoom" } });
  for (const value of ["week", "month", "quarter"] as const) zoom.createEl("option", { value, text: value[0].toUpperCase() + value.slice(1) });
  zoom.value = options.zoom;
  zoom.addEventListener("change", () => options.navigate(start, zoom.value as GanttZoom));
  const scroll = root.createDiv({ cls: "tm-gantt-scroll", attr: { "aria-label": "Project timeline" } });
  scroll.style.setProperty("--tm-gantt-width", `${days * width}px`);
  scroll.style.setProperty("--tm-gantt-day", `${width}px`);
  const header = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-header" });
  header.createDiv({ cls: "tm-gantt-label", text: "Project" });
  const dates = header.createDiv({ cls: "tm-gantt-dates" });
  for (let index = 0; index < days; index++) {
    const day = addDays(start, index);
    const label = options.zoom === "quarter" ? String(localDate(day).getDate()) : localDate(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    dates.createDiv({ cls: `tm-gantt-date${day === todayIso() ? " is-today" : ""}`, text: label, attr: { title: formatDate(day, options.dateFormat) } });
  }
  let busy = false;
  const persist = async (project: Project, changes: Partial<Record<ProjectDateField, string>>, rebuild = false): Promise<void> => {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await options.update(project, changes);
      Object.assign(project, changes);
      if (rebuild && root.isConnected) {
        const left = scroll.scrollLeft;
        const top = scroll.scrollTop;
        root.remove();
        renderGantt(container, options);
        const next = container.querySelector<HTMLElement>(".tm-gantt-scroll");
        if (next) { next.scrollLeft = left; next.scrollTop = top; }
      }
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Could not update project dates.");
    } finally { busy = false; root.removeAttribute("aria-busy"); }
  };
  for (const { project, depth } of projectHierarchy(options.projects)) {
    const row = scroll.createDiv({ cls: `tm-gantt-row${project.archived ? " is-archived" : ""}` });
    const label = row.createEl("button", { cls: "tm-gantt-label", text: project.name, attr: { title: project.path, "aria-label": `Open ${project.name} project note` } });
    label.style.paddingLeft = `${12 + depth * 16}px`;
    label.addEventListener("click", () => options.open(project));
    const track = row.createDiv({ cls: "tm-gantt-track" });
    const todayOffset = daysBetween(start, todayIso());
    if (todayOffset >= 0 && todayOffset < days) {
      const marker = track.createSpan({ cls: "tm-gantt-today" });
      marker.style.left = `${todayOffset * width}px`;
    }
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
        selection.setText(`${formatDate(dates.scheduledDate, options.dateFormat)} – ${formatDate(dates.endDate, options.dateFormat)}`);
      };
      const resetSelection = (): void => { pointer = undefined; selection.hidden = true; hint.hidden = false; };
      track.addEventListener("pointerdown", event => {
        if (event.button !== 0 || busy) return;
        event.preventDefault();
        pointer = event.pointerId;
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
      const missing = !project.scheduledDate ? "Set start date" : !project.deadline && !project.endDate ? "Set end date or deadline" : "Finish is before start";
      const edit = track.createEl("button", { cls: "tm-gantt-jump", text: missing });
      edit.addEventListener("click", () => options.open(project));
      continue;
    }
    const bar = track.createEl("button", { cls: "tm-gantt-bar", text: project.name });
    bar.addEventListener("click", event => {
      if (busy) return;
      if (project.endDate || event.detail === 0) { options.open(project); return; }
      const clicked = ganttDateAt(start, event.clientX - track.getBoundingClientRect().left, width, days);
      const date = clicked < range.start ? range.start : clicked > range.end ? range.end : clicked;
      void persist(project, { endDate: date }, true);
    });
    const jump = track.createEl("button", { cls: "tm-gantt-jump", text: `Show ${formatDate(range.start, options.dateFormat)}` });
    jump.addEventListener("click", () => options.navigate(addDays(project.scheduledDate!, -1), options.zoom));
    const preview = track.createSpan({ cls: "tm-gantt-preview" });
    preview.hidden = true;
    const handles = new Map<GanttHandle, HTMLButtonElement>();
    const fieldFor = (handle: GanttHandle): ProjectDateField => handle === "start" ? "scheduledDate" : handle === "end" ? "endDate" : project.deadline ? "deadline" : "endDate";
    for (const handle of ["start", "finish", ...(range.marker ? ["end" as const] : [])] as GanttHandle[]) {
      const button = track.createEl("button", { cls: `tm-gantt-handle is-${handle}`, attr: { "aria-label": `${project.name}: change ${handle === "start" ? "start date" : handle === "end" || !project.deadline ? "end date" : "deadline"}` } });
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
    for (const [handle, button] of handles) {
      let pointer: number | undefined;
      let origin = 0;
      let delta = 0;
      const reset = (): void => { pointer = undefined; delta = 0; preview.hidden = true; row.removeClass("is-resizing"); paint(project); };
      const save = async (change: number): Promise<void> => {
        const { field, value } = resizeProjectDate(project, handle, change);
        if (value === project[field] || busy) return;
        await persist(project, { [field]: value });
        reset();
      };
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || busy) return;
        event.preventDefault(); event.stopPropagation();
        pointer = event.pointerId; origin = event.clientX; delta = 0;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", event => {
        if (pointer !== event.pointerId) return;
        delta = Math.round((event.clientX - origin) / width);
        const { field, value } = resizeProjectDate(project, handle, delta);
        paint({ ...project, [field]: value });
        row.addClass("is-resizing");
        preview.hidden = false;
        preview.setText(`${field === "scheduledDate" ? "Start" : field === "deadline" ? "Deadline" : "End"}: ${formatDate(value, options.dateFormat)}`);
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
}
