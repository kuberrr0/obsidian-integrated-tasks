import { Platform, setIcon } from "obsidian";
import type { Task } from "./types";
import { isStructuralGroup, type ListDropGroup, type ListPlacement } from "./list-drag";
import { taskTitleLabel } from "./task-title";
import { activeTaskDrag, dropTargetAt, highlightDropTarget, TASK_DRAG_TYPE, type SidebarDrop, type TaskDrag } from "./sidebar-drop";

interface DropIntent {
  group?: ListDropGroup;
  anchor?: Task;
  placement?: ListPlacement;
  indicator: string;
  /** Where the drop gap goes, and how deeply it is indented. */
  gap?: { element: HTMLElement; where: "before" | "after" | "start" | "end"; depth: number };
}

/** How long each drag motion takes: lifting, a gap moving, rows sliding, and settling on drop. */
export const DRAG_MOTION_MS = 150;
const DRAG_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** Moving this far right of where the row was grabbed nests it; it un-nests back within NEST_RELEASE_PX. */
const NEST_PX = 24;
const NEST_RELEASE_PX = 16;
/** Once above or below a row is chosen, the other side needs the lifted row this far past the row's middle. */
const SIDE_HYSTERESIS_PX = 4;
/** What makes way for the gap, sliding as rows do: rows, the gap, group headings, a list's "Show more" and "Add task". */
const MOVERS = ".tm-task-item:not(.tm-drag-preview), .tm-drop-gap, .tm-section > h2, .tm-show-more-tasks, .tm-add-task-row";
/** What the pointer can rest on mid-slide: a row, the gap or a group heading. */
const HOLDERS = ".tm-task-item, .tm-drop-gap, .tm-section > h2";
/** On touch screens a row lifts for dragging after a press held this long (and within PRESS_SLOP px of where it began). */
const LONG_PRESS_MS = 350;
const PRESS_SLOP = 8;

function motion(doc: Document): number {
  return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : DRAG_MOTION_MS;
}

function depthOf(row: HTMLElement): number {
  return Number.parseInt(row.style.getPropertyValue("--tm-depth") || "0", 10) || 0;
}

/** The last row of `row`'s subtree: rows below it that are indented deeper. */
function subtreeEnd(row: HTMLElement): HTMLElement {
  const depth = depthOf(row);
  let end = row;
  for (let next = row.nextElementSibling as HTMLElement | null; next; next = next.nextElementSibling as HTMLElement | null) {
    if (next.classList.contains("tm-drop-gap") || next.classList.contains("tm-drag-source")) continue;
    if (!next.classList.contains("tm-task-item") || next.classList.contains("tm-drag-preview")) break;
    if (depthOf(next) <= depth) break;
    end = next;
  }
  return end;
}

export class ListDragController {
  private taskId?: string;
  private original?: Task;
  private busy = false;
  private highlighted?: HTMLElement;
  private targets = new Map<HTMLElement, (point: { clientX: number; clientY: number }) => DropIntent>();
  /** Rows by task, to find the dragged set and ancestors when placing the gap. */
  private rows = new Map<string, HTMLElement>();
  /** Each row's task and group, to resolve drops made beside the gap rather than on a row. */
  private rowTasks = new WeakMap<HTMLElement, Task>();
  private rowGroups = new Map<string, ListDropGroup | undefined>();
  /** The grabbed row and where the pointer grabbed it: moving left of that point over the gap outdents it. */
  private home?: { row: HTMLElement; x: number };
  /** Whether the gap was placed by the lift or by moving left over it, rather than by hovering a row. */
  private sideways = false;
  /** The pointer drag in progress: its gap, collapsed source rows and current drop intent. */
  private gap?: HTMLElement;
  private gapKey?: string;
  private intent?: DropIntent;
  /** The slot as chosen by position alone, before moving right nests it; un-nesting returns to it. */
  private flat?: DropIntent;
  private sources: HTMLElement[] = [];
  /** Rows (and the gap) sliding into place, with how far each started from where it now sits. */
  private slides = new WeakMap<HTMLElement, { animation: Animation; delta: number }>();
  /** Identifies drop targets so the gap only moves when the drop position changes. */
  private keys = new WeakMap<HTMLElement, number>();
  private lastKey = 0;
  constructor(private readonly getTask: (id: string) => Task | undefined,
    private readonly drop: (task: Task, group?: ListDropGroup, anchor?: Task, placement?: ListPlacement) => Promise<void>, private readonly allowNesting = true,
    private readonly dragStart: (task: Task) => Task[] | void = () => {}) {}

  private clear(): void {
    this.highlighted?.removeAttribute("data-drop-position");
    this.highlighted = undefined;
  }
  private mark(element: HTMLElement, position: string): void {
    this.clear();
    element.setAttribute("data-drop-position", position);
    this.highlighted = element;
  }
  private commit(group?: ListDropGroup, anchor?: Task, placement?: ListPlacement): Promise<void> {
    const original = this.original;
    this.taskId = undefined;
    this.clear();
    if (!original || this.busy) return Promise.resolve();
    this.busy = true;
    return this.drop(original, group, anchor, placement).finally(() => { this.busy = false; });
  }

  /** How far `row` is still shifted from its place by a slide in progress: 0 once it has settled. */
  private slideOffset(row: Element): number {
    const slide = row.instanceOf(HTMLElement) ? this.slides.get(row) : undefined;
    if (!slide || slide.animation.playState === "finished" || slide.animation.playState === "idle") return 0;
    const progress = slide.animation.effect?.getComputedTiming().progress;
    return progress === null || progress === undefined ? 0 : slide.delta * (1 - progress);
  }

  /** `element`'s box where it will rest once the row (or gap) holding it stops sliding. */
  private settledRect(element: Element): { left: number; right: number; top: number; bottom: number; height: number } {
    const rect = element.getBoundingClientRect();
    const holder = element.closest(HOLDERS);
    const shift = holder ? this.slideOffset(holder) : 0;
    return { left: rect.left, right: rect.right, top: rect.top - shift, bottom: rect.bottom - shift, height: rect.height };
  }

  /**
   * What will be under the point once sliding rows settle. Rows (and the gap) slide aside for 150ms after the gap
   * moves; aiming at where they are drawn mid-slide would move the gap again, and again. And while they slide,
   * or beside an indented gap, the point can fall where no row is drawn, on the list itself, which would read
   * as its empty end. So unless a resting row (or the gap) is under the point, find by height the row (or gap)
   * whose resting place holds it; only below them all is it the list's end.
   */
  private settledAt(doc: Document, x: number, y: number): HTMLElement | null {
    const stack = doc.elementsFromPoint?.(x, y) ?? [];
    const under = stack.length ? stack : [doc.elementFromPoint(x, y)].filter((element): element is Element => element !== null);
    const first = under[0];
    if (!first?.instanceOf(HTMLElement)) return null;
    const holder = first.closest(HOLDERS);
    if (holder && this.slideOffset(holder) === 0) return first;
    const list = (holder ?? first).closest<HTMLElement>(".tm-task-list");
    if (!list) {
      // A heading mid-slide: whatever rests under the point, a row, the gap or a heading.
      const scope = holder?.closest(".tm-main-view");
      if (!scope) return first;
      for (const element of Array.from(scope.querySelectorAll<HTMLElement>(HOLDERS))) {
        if (element.classList.contains("tm-drag-preview") || element.classList.contains("tm-drag-source")) continue;
        const rect = this.settledRect(element);
        if (rect.height > 0 && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return element;
      }
      return first;
    }
    let nearest: { element: HTMLElement; distance: number } | undefined;
    let bottom = -Infinity;
    for (const child of Array.from(list.children)) {
      if (!child.instanceOf(HTMLElement) || child.classList.contains("tm-drag-preview")) continue;
      if (!this.targets.has(child) && !child.classList.contains("tm-drop-gap")) continue;
      const rect = this.settledRect(child);
      if (rect.height <= 0) continue;
      if (y >= rect.top && y < rect.bottom) return child;
      bottom = Math.max(bottom, rect.bottom);
      const distance = y < rect.top ? rect.top - y : y - rect.bottom;
      if (!nearest || distance < nearest.distance) nearest = { element: child, distance };
    }
    // Above or between the rows, the nearest one; below them all, the list (its end).
    return nearest && y < bottom ? nearest.element : list;
  }

  /**
   * Moves something while every row it displaces slides from where it was to where it lands,
   * so rows glide aside as the drop gap opens, closes or moves. A row whose resting place the change
   * leaves alone keeps sliding as it was; one that moves glides on from where it is drawn.
   */
  private slide(scope: Element | Document, change: () => void): void {
    const rows = Array.from(scope.querySelectorAll<HTMLElement>(MOVERS));
    // Read every position first, then change and read again, then start animations: one layout each way.
    const before = new Map(rows.map(row => { const top = row.getBoundingClientRect().top; return [row, { drawn: top, rest: top - this.slideOffset(row) }]; }));
    change();
    const duration = motion(scope.instanceOf(Document) ? scope : scope.ownerDocument);
    const after = new Map(rows.filter(row => row.isConnected).map(row => [row, row.getBoundingClientRect().top - this.slideOffset(row)]));
    for (const row of rows) {
      const rest = after.get(row);
      const was = before.get(row)!;
      if (rest === undefined) { this.slides.get(row)?.animation.cancel(); continue; }
      if (Math.abs(rest - was.rest) < 0.5) continue;
      this.slides.get(row)?.animation.cancel();
      this.slides.delete(row);
      const delta = was.drawn - rest;
      if (!duration || typeof row.animate !== "function" || Math.abs(delta) < 0.5) continue;
      this.slides.set(row, { animation: row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration, easing: DRAG_EASING }), delta });
    }
  }

  /**
   * Where the gap would sit, as one key however it is described: "after row 3" and "before row 4" are the
   * same slot, as are slots that only folded-away dragged rows separate. Its list, the row shown above it, and its depth.
   */
  private slotKey(place: NonNullable<DropIntent["gap"]>): string {
    const shown = (element: Element | null): boolean => Boolean(element?.instanceOf(HTMLElement) && element !== this.gap
      && !element.classList.contains("tm-drag-source") && !element.classList.contains("tm-drag-preview"));
    const container = place.where === "start" || place.where === "end" ? place.element : place.element.parentElement;
    let above: Element | null = place.where === "start" ? null : place.where === "end" ? place.element.lastElementChild
      : place.where === "after" ? place.element : place.element.previousElementSibling;
    while (above && !shown(above)) above = above.previousElementSibling;
    return `${container ? this.targetKey(container) : 0}:${above?.instanceOf(HTMLElement) ? this.targetKey(above) : "start"}:${place.depth}`;
  }

  /** Opens (or moves) the drop gap to where the dragged rows would land; rows slide aside unless `animate` is off. */
  private placeGap(intent: DropIntent | undefined, height: number, doc: Document, animate = true): void {
    const place = intent?.gap;
    if (!place) return;
    // The latest description of the slot decides the drop, even when the gap stays where it is.
    // The grabbed row's own slot is no drop: letting go there puts the row back.
    this.intent = intent?.indicator === "none" ? undefined : intent;
    const key = this.slotKey(place);
    if (key === this.gapKey) return;
    this.gapKey = key;
    const move = (): void => {
      if (!this.gap) {
        this.gap = doc.createElement("div");
        this.gap.className = "tm-drop-gap";
        this.gap.setAttribute("aria-hidden", "true");
        this.targets.set(this.gap, () => this.intent ?? { indicator: "none" });
      }
      this.gap.style.setProperty("--tm-gap-height", `${height}px`);
      this.gap.style.setProperty("--tm-depth", String(place.depth));
      if (place.where === "before") place.element.before(this.gap);
      else if (place.where === "after") place.element.after(this.gap);
      else if (place.where === "start") place.element.prepend(this.gap);
      else place.element.append(this.gap);
    };
    if (animate) this.slide(place.element.closest(".tm-main-view") ?? doc, move);
    else move();
  }

  private targetKey(element: HTMLElement): number {
    let key = this.keys.get(element);
    if (key === undefined) { key = ++this.lastKey; this.keys.set(element, key); }
    return key;
  }

  /** The nearest row above the gap that still shows (dragged rows are folded away). */
  private rowAboveGap(): HTMLElement | undefined {
    for (let row = this.gap?.previousElementSibling; row; row = row.previousElementSibling) {
      if (row.instanceOf(HTMLElement) && this.rowTasks.has(row) && !row.classList.contains("tm-drag-source") && !row.classList.contains("tm-drag-preview")) return row;
    }
    return undefined;
  }

  /** `row`, or the ancestor row that encloses it at `depth`. */
  private rowAtDepth(row: HTMLElement, depth: number): HTMLElement | undefined {
    let current: HTMLElement | undefined = row;
    while (current && depthOf(current) > depth) {
      const parentId: string | undefined = this.rowTasks.get(current)?.parentId;
      current = parentId ? this.rows.get(parentId) : undefined;
    }
    return current && depthOf(current) === depth ? current : undefined;
  }

  /**
   * Moving left over the gap, as over a row: far enough left of where the row was grabbed outdents it,
   * a level per 24px. Nesting needs a task's title, so moving right does nothing. Undefined when the depth stays.
   */
  private besideGap(x: number): DropIntent | undefined {
    if (!this.allowNesting || !this.home || !this.gap) return undefined;
    const dx = x - this.home.x;
    const depth = Math.max(0, depthOf(this.home.row) - (dx <= -16 ? Math.max(1, Math.floor(-dx / 24)) : 0));
    const above = this.rowAboveGap();
    if (depth >= depthOf(this.gap) || !above) return undefined;
    // After the ancestor at that depth, which encloses the row above the gap.
    const row = this.rowAtDepth(above, depth);
    const anchor = row && this.rowTasks.get(row);
    if (!row || !anchor) return undefined;
    return { group: this.rowGroups.get(anchor.id), anchor, placement: "after", indicator: "outdent", gap: this.gapFor(row, anchor, anchor, "after") };
  }

  /** The row shown just above where `place` puts the gap (dragged rows are folded away), if any. */
  private rowAbove(place: NonNullable<DropIntent["gap"]>): HTMLElement | undefined {
    let above: Element | null = place.where === "start" ? null : place.where === "end" ? place.element.lastElementChild
      : place.where === "after" ? place.element : place.element.previousElementSibling;
    for (; above; above = above.previousElementSibling) {
      if (above.instanceOf(HTMLElement) && this.rowTasks.has(above) && !above.classList.contains("tm-drag-source") && !above.classList.contains("tm-drag-preview")) return above;
    }
    return undefined;
  }

  /**
   * `flat` nested one level deeper when the pointer has moved right of where the row was grabbed: the task becomes
   * the last subtask of the nearest row above the slot at the slot's level. Otherwise `flat` as it is.
   */
  private nested(flat: DropIntent, x: number): DropIntent {
    if (!this.allowNesting || !this.home || !flat.gap) return flat;
    const dx = x - this.home.x;
    if (dx < (this.intent?.placement === "child" ? NEST_RELEASE_PX : NEST_PX)) return flat;
    const above = this.rowAbove(flat.gap);
    const parentRow = above && this.rowAtDepth(above, flat.gap.depth);
    const parent = parentRow && this.rowTasks.get(parentRow);
    if (!parentRow || !parent) return flat;
    return { group: this.rowGroups.get(parent.id), anchor: parent, placement: "child", indicator: "child", gap: this.gapFor(parentRow, parent, parent, "child") };
  }

  /** The last top-level task in a list, so a drop at the end of a section lands after it in the note. */
  private lastRow(list: HTMLElement): Task | undefined {
    const row = Array.from(list.children).reverse().find((row): row is HTMLElement =>
      row.instanceOf(HTMLElement) && this.rowTasks.has(row) && !row.classList.contains("tm-drag-source")
      && !row.classList.contains("tm-drag-preview") && depthOf(row) === 0);
    return row && this.rowTasks.get(row);
  }

  /** Where a drop on this row would put the gap: before it, after its subtree, or after an ancestor's. */
  private gapFor(row: HTMLElement, task: Task, anchor: Task, placement: ListPlacement): DropIntent["gap"] {
    const depth = depthOf(row);
    if (placement === "before") return { element: row, where: "before", depth };
    if (placement === "child") return { element: subtreeEnd(row), where: "after", depth: depth + 1 };
    if (anchor.id === task.id) return { element: subtreeEnd(row), where: "after", depth };
    // Outdent: after the ancestor's whole subtree, at its depth.
    const ancestor = this.rows.get(anchor.id);
    return ancestor ? { element: subtreeEnd(ancestor), where: "after", depth: depthOf(ancestor) } : { element: subtreeEnd(row), where: "after", depth };
  }

  /**
   * Folds the dragged rows (and their subtasks) away. They shrink to nothing rather than leave the page,
   * so the grabbed row keeps the pointer capture.
   */
  private liftSources(rows: HTMLElement[]): void {
    const all = new Set<HTMLElement>();
    for (const row of rows) {
      const end = subtreeEnd(row);
      for (let next: Element | null = row; next; next = next.nextElementSibling) {
        if (next.instanceOf(HTMLElement) && next.classList.contains("tm-task-item")) all.add(next);
        if (next === end) break;
      }
    }
    this.sources = [...all];
    for (const row of this.sources) row.addClass("tm-drag-source");
  }

  /** Brings the folded rows back: sliding open after a cancelled drag, at once when the drop redraws them anyway. */
  private restoreSources(animated: boolean): void {
    const rows = this.sources.filter(row => row.isConnected);
    this.sources = [];
    const show = (): void => { for (const row of rows) row.removeClass("tm-drag-source"); };
    if (animated && rows.length) this.slide(rows[0].closest(".tm-main-view") ?? rows[0].ownerDocument, show);
    else show();
  }

  private removeGap(animated: boolean): void {
    const gap = this.gap;
    this.gap = undefined;
    this.home = undefined;
    this.sideways = false;
    this.gapKey = undefined;
    this.intent = undefined;
    this.flat = undefined;
    if (!gap) return;
    this.targets.delete(gap);
    if (animated && gap.isConnected) this.slide(gap.closest(".tm-main-view") ?? gap.ownerDocument, () => gap.remove());
    else gap.remove();
  }

  /**
   * Above a group's heading: after the last top-level task of the list above (or at the start of this
   * group when nothing is above it).
   */
  private aboveHeading(list: HTMLElement, group: ListDropGroup): DropIntent {
    const lists = Array.from(list.closest(".tm-main-view")?.querySelectorAll<HTMLElement>(".tm-task-list") ?? []);
    const previous = lists[lists.indexOf(list) - 1];
    if (!previous) return { group, indicator: "group", gap: { element: list, where: "start", depth: 0 } };
    const last = Array.from(previous.children).reverse().find((row): row is HTMLElement =>
      row.instanceOf(HTMLElement) && row.classList.contains("tm-task-item") && !row.classList.contains("tm-drag-source")
      && !row.classList.contains("tm-drag-preview") && depthOf(row) === 0 && this.targets.has(row));
    if (!last) return this.targets.get(previous)?.({ clientX: 0, clientY: 0 }) ?? { group, indicator: "group", gap: { element: list, where: "start", depth: 0 } };
    // Resolve as a point just below the row, level with its title: "after", neither nested nor outdented.
    const title = this.settledRect(last.querySelector(".tm-task-primary") ?? last);
    return this.targets.get(last)!({ clientX: title.left, clientY: this.settledRect(last).bottom - 1 });
  }

  /** The start of a group's list: before its first top-level task still shown (in a section or note, that task's place). */
  private groupStart(list: HTMLElement, group: ListDropGroup): DropIntent {
    const first = Array.from(list.children).find((row): row is HTMLElement =>
      row.instanceOf(HTMLElement) && this.rowTasks.has(row) && !row.classList.contains("tm-drag-source")
      && !row.classList.contains("tm-drag-preview") && depthOf(row) === 0);
    const task = first && this.rowTasks.get(first);
    return { group, indicator: "group", gap: { element: list, where: "start", depth: 0 }, ...task && isStructuralGroup(group) ? { anchor: task, placement: "before" as const } : {} };
  }

  /**
   * A group's heading takes drops as a row would: over its top half, the end of the group above; over its bottom
   * half, the start of its own group. Having chosen one, the other needs the lifted row a few pixels past the middle.
   */
  private overHeading(title: HTMLElement, list: HTMLElement, group: ListDropGroup, y: number): DropIntent {
    const above = this.aboveHeading(list, group);
    const start = this.groupStart(list, group);
    const current = this.flat?.gap ? this.slotKey(this.flat.gap) : undefined;
    const rect = this.settledRect(title);
    const shift = current === this.slotKey(start.gap!) ? -SIDE_HYSTERESIS_PX : above.gap && current === this.slotKey(above.gap) ? SIDE_HYSTERESIS_PX : 0;
    return y < rect.top + rect.height / 2 + shift ? above : start;
  }

  group(element: HTMLElement, group: ListDropGroup): void {
    // Dropped on a group but not on a row: the gap waits at the end of the group's list,
    // except over the heading of a list group, which belongs to what is above it.
    const list = (): HTMLElement => element.matches(".tm-task-list") ? element : element.querySelector<HTMLElement>(".tm-task-list") ?? element;
    this.targets.set(element, point => {
      const items = list();
      const title = items !== element && !element.closest(".tm-kanban")
        ? Array.from(element.children).find((child): child is HTMLElement => child.instanceOf(HTMLElement) && child.tagName === "H2") : undefined;
      if (title && point.clientY < items.getBoundingClientRect().top) return this.overHeading(title, items, group, point.clientY);
      // In a section or note, the end of the list is a place in the note: after its last task.
      const last = isStructuralGroup(group) ? this.lastRow(items) : undefined;
      return { group, indicator: "group", gap: { element: items, where: "end", depth: 0 }, ...last ? { anchor: last, placement: "after" as const } : {} };
    });
    element.addEventListener("dragover", event => {
      if (!this.taskId || this.busy) return;
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.mark(element, "group");
    });
    element.addEventListener("dragleave", event => { if (!element.contains(event.relatedTarget as Node | null)) this.clear(); });
    element.addEventListener("drop", event => {
      if (!this.taskId) return;
      event.preventDefault(); event.stopPropagation();
      void this.commit(group);
    });
  }
  row(row: HTMLElement, primary: HTMLElement, task: Task, group?: ListDropGroup): void {
    this.rows.set(task.id, row);
    this.rowTasks.set(row, task);
    this.rowGroups.set(task.id, group);
    const handle = primary.createEl("button", { cls: "clickable-icon tm-list-drag-handle", attr: { "aria-label": `Drag ${task.title}`, title: "Drag to reorder; move right to nest under the task above, or left to outdent" } });
    setIcon(handle, "grip-vertical");
    primary.prepend(handle);
    row.draggable = true;
    let suppressClickUntil = 0;
    row.addEventListener("click", event => {
      if (Date.now() > suppressClickUntil) return;
      event.preventDefault(); event.stopImmediatePropagation();
      suppressClickUntil = 0;
    }, true);
    row.addEventListener("dragstart", event => {
      if (this.busy || (event.target instanceof HTMLElement && event.target.closest("input"))) { event.preventDefault(); return; }
      this.dragStart(task);
      this.taskId = task.id;
      this.original = task;
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
      }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => { suppressClickUntil = Date.now() + 250; this.taskId = undefined; row.removeClass("is-dragging"); this.clear(); });
    const intent = (event: { clientX: number; clientY: number }): { anchor: Task; placement: ListPlacement } => {
      // Measured where the row will rest, should it be sliding aside.
      const rect = this.settledRect(row);
      const left = primary.getBoundingClientRect().left;
      let anchor = task;
      // Above or below the row by its middle; having chosen one side, the other needs a few pixels past it.
      const current = this.flat?.anchor?.id === task.id ? this.flat.placement : undefined;
      const middle = rect.top + rect.height / 2 + (current === "before" ? SIDE_HYSTERESIS_PX : current === "after" ? -SIDE_HYSTERESIS_PX : 0);
      let placement: ListPlacement = event.clientY < middle ? "before" : "after";
      if (this.allowNesting && event.clientX < left - 16 && anchor.parentId) {
        let levels = Math.max(1, Math.floor((left - event.clientX) / 24));
        while (anchor.parentId && levels-- > 0) {
          const parent = this.getTask(anchor.parentId);
          if (!parent) break;
          anchor = parent;
        }
        placement = "after";
      }
      return { anchor, placement };
    };
    this.targets.set(row, point => {
      const result = intent(point);
      return { ...result, group, indicator: result.anchor.id !== task.id ? "outdent" : result.placement, gap: this.gapFor(row, task, result.anchor, result.placement) };
    });
    // Use the same pointer drag on the title and body; native dragging is
    // unreliable on nested controls and can compete with text selection.
    let pointer: number | undefined;
    let origin = { x: 0, y: 0 };
    let dragging = false;
    let preview: HTMLElement | undefined;
    let previewOffset = { x: 0, y: 0 };
    /** Where the floating row was placed when lifted; it then follows the pointer by a transform, which needs no layout. */
    let previewBase = { left: 0, top: 0 };
    let previewShift = { x: 0, y: 0 };
    /** The latest pointer position, handled once per frame however many moves arrive. */
    let latest: { clientX: number; clientY: number } | undefined;
    let frameScheduled = false;
    let frameId = 0;
    let sourceRect: DOMRect | undefined;
    // Dropping on a list in the task sidebar: the drag it reads, the list under the pointer, and, once the pointer
    // leaves the view (which clips the lifted row), a label with the task's name that follows it instead.
    let sidebar: TaskDrag | undefined;
    let over: { element: HTMLElement; drop: SidebarDrop } | undefined;
    let chip: HTMLElement | undefined;
    let label = taskTitleLabel(task.title);
    const hit = (point: { clientX: number; clientY: number }): { element: HTMLElement; target: DropIntent } | undefined => {
      let element = this.settledAt(row.ownerDocument, point.clientX, point.clientY);
      while (element) {
        const resolve = this.targets.get(element);
        if (resolve) return { element, target: resolve(point) };
        element = element.parentElement;
      }
      return undefined;
    };
    /** Glides the floating row onto `to` (the gap, or back to its slot); resolves when it arrives, at once without motion. */
    const glide = async (to: DOMRect): Promise<void> => {
      const current = preview;
      if (!current) return;
      const from = current.getBoundingClientRect();
      // It settles back to the row's size and shadow as it lands.
      current.addClass("is-settling");
      const duration = motion(row.ownerDocument);
      if (!duration || typeof current.animate !== "function") return;
      current.querySelector(".tm-drag-count")?.remove();
      const shifted = (x: number, y: number): string => `translate3d(${x}px, ${y}px, 0px)`;
      const animation = current.animate([{ transform: shifted(previewShift.x, previewShift.y) },
        { transform: shifted(previewShift.x + to.left - from.left, previewShift.y + to.top - from.top) }], { duration, easing: DRAG_EASING, fill: "forwards" });
      await animation.finished.catch(() => {});
    };
    // Touch: a long press lifts the row (armed), and moving the finger then drags it. Before that, a quick
    // horizontal move is a swipe (see TaskMainView.bindSwipe) and a vertical one scrolls the list.
    let press: { timer: number; id: number; x: number; y: number } | undefined;
    let armed = false;
    const cancelPress = (): void => {
      if (press) row.ownerDocument.defaultView?.clearTimeout(press.timer);
      press = undefined;
    };
    row.addEventListener("pointerdown", event => {
      if (event.button !== 0 || (Platform.isMacOS && event.ctrlKey) || this.busy) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, label, select, textarea, a, button") &&
          !target.closest(".tm-task-title, .tm-list-drag-handle")) return;
      if (event.pointerType === "touch") {
        cancelPress();
        const win = row.ownerDocument.defaultView ?? window;
        const at = { id: event.pointerId, x: event.clientX, y: event.clientY };
        press = { ...at, timer: win.setTimeout(() => {
          press = undefined;
          pointer = at.id;
          origin = { x: at.x, y: at.y };
          dragging = false;
          armed = true;
          row.draggable = false;
          row.addClass("is-drag-armed");
          win.navigator.vibrate?.(10);
        }, LONG_PRESS_MS) };
        return;
      }
      event.stopPropagation();
      pointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      dragging = false;
      row.draggable = false;
    });
    // Once lifted, the finger drags the row instead of scrolling the list or opening a sidebar.
    row.addEventListener("touchmove", event => {
      if (!armed && !dragging) return;
      event.preventDefault(); event.stopPropagation();
    }, { passive: false });
    // A long press would also open the context menu (the task's actions); lifting the row takes its place.
    row.addEventListener("contextmenu", event => {
      if (!armed && !dragging) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    /** One frame's work for the latest pointer position: read where it is, move the gap, then move what follows the pointer. */
    const update = (): void => {
      frameScheduled = false;
      const point = latest;
      const current = preview;
      if (!point || !dragging || !current) return;
      const doc = row.ownerDocument;
      const side = sidebar ? dropTargetAt(doc, point.clientX, point.clientY) : undefined;
      const bounds = (row.closest(".tm-main-view") ?? row.parentElement)?.getBoundingClientRect();
      const outside = Boolean(bounds && (point.clientX < bounds.left || point.clientX > bounds.right || point.clientY < bounds.top || point.clientY > bounds.bottom));
      const height = sourceRect?.height ?? 0;
      // Above or below is judged by the lifted row's middle, wherever on it the row was grabbed.
      const found = hit({ clientX: point.clientX, clientY: point.clientY - previewOffset.y + height / 2 });
      // The gap marks the drop. Hovering the gap keeps its slot, except that moving left over the grabbed
      // row's own slot (or where earlier left moves took it) outdents it.
      if (found && found.element !== this.gap) { this.sideways = false; this.flat = found.target; }
      else if (found && this.sideways) { const beside = this.besideGap(point.clientX); if (beside) this.flat = beside; }
      // Then, wherever the slot is, moving right of where the row was grabbed nests it under the row above.
      if (this.flat) this.placeGap(this.nested(this.flat, point.clientX), height, doc);
      // Writes last, so this frame lays out once.
      previewShift = { x: point.clientX - previewOffset.x - previewBase.left, y: point.clientY - previewOffset.y - previewBase.top };
      current.style.transform = `translate3d(${previewShift.x}px, ${previewShift.y}px, 0px)`;
      if (side?.element !== over?.element) {
        highlightDropTarget(over?.element, false);
        over = side;
        highlightDropTarget(over?.element, true);
      }
      if (outside) {
        chip ??= doc.body.createDiv({ cls: "tm-drag-chip", text: label, attr: { "aria-hidden": "true" } });
        chip.style.left = `${point.clientX + 12}px`;
        chip.style.top = `${point.clientY + 8}px`;
      } else {
        chip?.remove();
        chip = undefined;
      }
      current.toggleClass("is-outside", outside);
    };
    const win = (): Window => row.ownerDocument.defaultView ?? window;
    /** Handles the pending pointer position now (before a drop reads where it lands). */
    const flush = (): void => {
      if (!frameScheduled) return;
      win().cancelAnimationFrame(frameId);
      update();
    };
    const cancelFrame = (): void => {
      if (frameScheduled) win().cancelAnimationFrame(frameId);
      frameScheduled = false;
      latest = undefined;
    };
    row.addEventListener("pointermove", event => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) cancelPress();
      if (pointer !== event.pointerId) return;
      if (!dragging && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      event.preventDefault();
      const doc = row.ownerDocument;
      if (!dragging) {
        // Capturing on press retargets ordinary pill/title clicks to the row.
        // Keep their original target unless this gesture becomes a drag.
        row.setPointerCapture(event.pointerId);
        const moving = this.dragStart(task) || [task];
        sidebar = activeTaskDrag();
        label = moving.length > 1 ? `${moving.length} tasks` : taskTitleLabel(task.title);
        const rect = row.getBoundingClientRect();
        sourceRect = rect;
        previewOffset = { x: origin.x - rect.left, y: origin.y - rect.top };
        // Lift: a floating copy of the row, selected-looking, with a count when several tasks move together.
        preview = row.cloneNode(true) as HTMLElement;
        preview.removeAttribute("data-drop-position");
        preview.removeClass("is-dragging");
        preview.addClass("tm-drag-preview", "is-selected");
        preview.setAttribute("aria-hidden", "true");
        preview.inert = true;
        preview.draggable = false;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
        if (moving.length > 1) {
          const count = preview.createSpan({ cls: "tm-drag-count", text: String(moving.length) });
          count.style.left = `${previewOffset.x + 8}px`;
          count.style.top = `${previewOffset.y + 2}px`;
        }
        // Keep the layout's ancestor styles, including kanban card formatting.
        row.parentElement?.appendChild(preview);
        doc.body.addClass("tm-list-dragging");
        // Placed over the row once; Obsidian panes can establish a containing block for fixed children,
        // so correct for its displacement. From here on the copy only moves by transform.
        preview.style.left = `${rect.left}px`;
        preview.style.top = `${rect.top}px`;
        const placed = preview.getBoundingClientRect();
        preview.style.left = `${2 * rect.left - placed.left}px`;
        preview.style.top = `${2 * rect.top - placed.top}px`;
        previewBase = { left: rect.left, top: rect.top };
        previewShift = { x: 0, y: 0 };
        listenForEscape();
        // The dragged rows' slots close, and the gap opens where the grabbed row was.
        const rows = moving.map(item => this.rows.get(item.id)).filter((item): item is HTMLElement => Boolean(item?.isConnected));
        if (!rows.includes(row)) rows.push(row);
        // The gap takes the grabbed row's place, so a single row lifts without anything moving.
        this.slide(row.closest(".tm-main-view") ?? doc, () => {
          const lifted: DropIntent = { indicator: "none", gap: { element: row, where: "before", depth: depthOf(row) } };
          this.placeGap(lifted, rect.height, doc, false);
          // Moving right from its own slot nests it under the row above.
          this.flat = lifted;
          this.home = { row, x: origin.x };
          this.sideways = true;
          this.liftSources(rows);
        });
        dragging = true;
        this.taskId = task.id;
        this.original = task;
        row.addClass("is-dragging");
      }
      latest = { clientX: event.clientX, clientY: event.clientY };
      if (frameScheduled) return;
      frameScheduled = true;
      frameId = win().requestAnimationFrame(update);
    });
    const reset = (): void => {
      cancelFrame();
      row.ownerDocument.body.removeClass("tm-list-dragging");
      preview?.remove();
      preview = undefined;
      chip?.remove();
      chip = undefined;
      highlightDropTarget(over?.element, false);
      over = undefined;
      sidebar = undefined;
      stopEscape?.();
      cancelPress();
      armed = false;
      row.removeClass("is-drag-armed");
      pointer = undefined; dragging = false; row.draggable = true; row.removeClass("is-dragging"); this.taskId = undefined; this.clear();
    };
    const cancelDrag = (): void => {
      this.removeGap(false);
      this.restoreSources(false);
      reset();
    };
    /** No drop: the row flies back and its slot reopens. */
    const flyBack = (): void => {
      cancelFrame();
      stopEscape?.();
      chip?.remove();
      chip = undefined;
      this.removeGap(true);
      this.restoreSources(true);
      void glide(sourceRect ?? row.getBoundingClientRect()).then(reset);
    };
    // Escape abandons the drag in flight; the key goes no further (it would clear the selection or close a card).
    let stopEscape: (() => void) | undefined;
    const listenForEscape = (): void => {
      const doc = row.ownerDocument;
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== "Escape" || !dragging || pointer === undefined) return;
        event.preventDefault(); event.stopPropagation();
        const id = pointer;
        pointer = undefined;
        suppressClickUntil = Date.now() + 250;
        try { row.releasePointerCapture(id); } catch { /* Already released. */ }
        flyBack();
      };
      doc.addEventListener("keydown", onKey, true);
      stopEscape = () => { doc.removeEventListener("keydown", onKey, true); stopEscape = undefined; };
    };
    row.addEventListener("pointerup", event => {
      cancelPress();
      if (pointer !== event.pointerId) return;
      // A long press let go without moving selects nothing.
      if (armed && !dragging) suppressClickUntil = Date.now() + 250;
      if (dragging) { event.preventDefault(); event.stopPropagation(); }
      // The last move counts, even if its frame has not run yet.
      if (dragging) flush();
      const target = dragging ? this.intent : undefined;
      if (dragging) suppressClickUntil = Date.now() + 250;
      const captured = dragging;
      pointer = undefined;
      if (captured) row.releasePointerCapture(event.pointerId);
      if (!captured) { reset(); return; }
      // Dropped on a sidebar list: the rows come back at once, and the list's change redraws them.
      const onSidebar = over && sidebar;
      if (onSidebar) {
        const drop = over!.drop;
        this.removeGap(false);
        this.restoreSources(false);
        reset();
        this.original = undefined;
        void onSidebar.drop(drop);
        return;
      }
      const gap = this.gap;
      if (target?.gap && gap?.isConnected) {
        // Drop: the floating row settles into the gap, then the move is written and the list redraws.
        void glide(gap.getBoundingClientRect()).then(async () => {
          reset();
          await this.commit(target.group, target.anchor, target.placement);
          // The list redraws on the next frame; a drop that changed nothing redraws nothing, so then
          // close the gap and bring the rows back (on the redrawn list, this finds nothing to do).
          const win = row.ownerDocument.defaultView;
          if (win) await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
          this.removeGap(false);
          this.restoreSources(false);
        });
        return;
      }
      flyBack();
    });
    row.addEventListener("pointerleave", event => { if (!dragging && !(armed && event.pointerId === pointer)) reset(); });
    row.addEventListener("pointercancel", () => { if (dragging) cancelDrag(); else reset(); });
    // Only the row losing its own capture ends the drag. On touch, the element first pressed (such as the title)
    // holds the pointer until the drag moves the capture to the row; its lostpointercapture bubbles up here.
    row.addEventListener("lostpointercapture", event => { if (event.target === row && dragging && pointer !== undefined) cancelDrag(); });
    row.addEventListener("dragover", event => {
      if (!this.taskId || this.busy) return;
      event.preventDefault(); event.stopPropagation();
      const { anchor, placement } = intent(event);
      this.mark(row, anchor.id !== task.id ? "outdent" : placement);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", event => { if (!row.contains(event.relatedTarget as Node | null)) this.clear(); });
    row.addEventListener("drop", event => {
      if (!this.taskId) return;
      event.preventDefault(); event.stopPropagation();
      const { anchor, placement } = intent(event);
      void this.commit(group, anchor, placement);
    });
  }
}
