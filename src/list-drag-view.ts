import { Platform, setIcon } from "obsidian";
import type { Task } from "./types";
import type { ListDropGroup, ListPlacement } from "./list-drag";

interface DropIntent {
  group?: ListDropGroup;
  anchor?: Task;
  placement?: ListPlacement;
  indicator: string;
  /** Where the drop gap goes, and how deeply it is indented. */
  gap?: { element: HTMLElement; where: "before" | "after" | "end"; depth: number };
}

/** How long each drag motion takes: lifting, a gap moving, rows sliding, and settling on drop. */
export const DRAG_MOTION_MS = 150;
const DRAG_EASING = "cubic-bezier(0.2, 0, 0, 1)";

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
  /** The pointer drag in progress: its gap, collapsed source rows and current drop intent. */
  private gap?: HTMLElement;
  private gapKey?: string;
  private intent?: DropIntent;
  private sources: HTMLElement[] = [];
  private slides = new WeakMap<HTMLElement, Animation>();
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

  /**
   * Moves something while every row it displaces slides from where it was to where it lands,
   * so rows glide aside as the drop gap opens, closes or moves.
   */
  private slide(scope: ParentNode, change: () => void): void {
    const rows = Array.from(scope.querySelectorAll<HTMLElement>(".tm-task-item:not(.tm-drag-preview), .tm-drop-gap"));
    // Measured mid-slide, so a slide interrupted by the next one continues from where the row is.
    const before = new Map(rows.map(row => [row, row.getBoundingClientRect().top]));
    change();
    const duration = motion(scope instanceof Document ? scope : (scope as Element).ownerDocument);
    for (const row of rows) {
      this.slides.get(row)?.cancel();
      if (!row.isConnected || !duration || typeof row.animate !== "function") continue;
      const delta = before.get(row)! - row.getBoundingClientRect().top;
      if (Math.abs(delta) < 0.5) continue;
      this.slides.set(row, row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration, easing: DRAG_EASING }));
    }
  }

  /** Opens (or moves) the drop gap to where the dragged rows would land; rows slide aside unless `animate` is off. */
  private placeGap(intent: DropIntent | undefined, height: number, doc: Document, animate = true): void {
    const place = intent?.gap;
    const key = place ? `${this.targetKey(place.element)}:${place.where}:${place.depth}` : undefined;
    if (!place || key === this.gapKey) return;
    this.gapKey = key;
    this.intent = intent;
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
        if (next instanceof HTMLElement && next.classList.contains("tm-task-item")) all.add(next);
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
    this.gapKey = undefined;
    this.intent = undefined;
    if (!gap) return;
    this.targets.delete(gap);
    if (animated && gap.isConnected) this.slide(gap.closest(".tm-main-view") ?? gap.ownerDocument, () => gap.remove());
    else gap.remove();
  }

  group(element: HTMLElement, group: ListDropGroup): void {
    // Dropped on a group but not on a row: the gap waits at the end of the group's list.
    const list = (): HTMLElement => element.matches(".tm-task-list") ? element : element.querySelector<HTMLElement>(".tm-task-list") ?? element;
    this.targets.set(element, () => ({ group, indicator: "group", gap: { element: list(), where: "end", depth: 0 } }));
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
    const handle = primary.createEl("button", { cls: "clickable-icon tm-list-drag-handle", attr: { "aria-label": `Drag ${task.title}`, title: "Drag to reorder; drop to the right to nest, or to the left to outdent" } });
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
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => { suppressClickUntil = Date.now() + 250; this.taskId = undefined; row.removeClass("is-dragging"); this.clear(); });
    const intent = (event: { clientX: number; clientY: number }): { anchor: Task; placement: ListPlacement } => {
      const rect = row.getBoundingClientRect();
      const left = primary.getBoundingClientRect().left;
      let anchor = task;
      let placement: ListPlacement = this.allowNesting && event.clientX > left + 64 ? "child" : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
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
    let sourceRect: DOMRect | undefined;
    const hit = (event: PointerEvent): { element: HTMLElement; target: DropIntent } | undefined => {
      let element = row.ownerDocument.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      while (element) {
        const resolve = this.targets.get(element);
        if (resolve) return { element, target: resolve(event) };
        element = element.parentElement;
      }
      return undefined;
    };
    /** Glides the floating row onto `to` (the gap, or back to its slot); resolves when it arrives, at once without motion. */
    const glide = async (to: DOMRect): Promise<void> => {
      const current = preview;
      if (!current) return;
      const from = current.getBoundingClientRect();
      const duration = motion(row.ownerDocument);
      if (!duration || typeof current.animate !== "function") return;
      current.querySelector(".tm-drag-count")?.remove();
      const animation = current.animate([{ transform: "none" }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }], { duration, easing: DRAG_EASING, fill: "forwards" });
      await animation.finished.catch(() => {});
    };
    row.addEventListener("pointerdown", event => {
      // Touch drags on a row are swipe gestures (see TaskMainView.bindSwipe), not reordering.
      if (event.pointerType === "touch" || event.button !== 0 || (Platform.isMacOS && event.ctrlKey) || this.busy) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, label, select, textarea, a, button") &&
          !target.closest(".tm-task-title, .tm-list-drag-handle")) return;
      event.stopPropagation();
      pointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      dragging = false;
      row.draggable = false;
    });
    row.addEventListener("pointermove", event => {
      if (pointer !== event.pointerId) return;
      if (!dragging && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      event.preventDefault();
      const doc = row.ownerDocument;
      if (!dragging) {
        // Capturing on press retargets ordinary pill/title clicks to the row.
        // Keep their original target unless this gesture becomes a drag.
        row.setPointerCapture(event.pointerId);
        const moving = this.dragStart(task) || [task];
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
        // The dragged rows' slots close, and the gap opens where the grabbed row was.
        const rows = moving.map(item => this.rows.get(item.id)).filter((item): item is HTMLElement => Boolean(item?.isConnected));
        if (!rows.includes(row)) rows.push(row);
        // The gap takes the grabbed row's place, so a single row lifts without anything moving.
        this.slide(row.closest(".tm-main-view") ?? doc, () => {
          this.placeGap({ indicator: "none", gap: { element: row, where: "before", depth: depthOf(row) } }, rect.height, doc, false);
          this.intent = undefined;
          this.liftSources(rows);
        });
      }
      if (preview) {
        const left = event.clientX - previewOffset.x;
        const top = event.clientY - previewOffset.y;
        preview.style.left = `${left}px`;
        preview.style.top = `${top}px`;
        // Obsidian panes can establish a containing block for fixed children.
        // Correct its viewport displacement while retaining the card's styles.
        const bounds = preview.getBoundingClientRect();
        preview.style.left = `${left + (left - bounds.left)}px`;
        preview.style.top = `${top + (top - bounds.top)}px`;
      }
      dragging = true;
      this.taskId = task.id;
      this.original = task;
      row.addClass("is-dragging");
      const found = hit(event);
      // The gap marks the drop; hovering the gap itself keeps it where it is.
      if (found && found.element !== this.gap) this.placeGap(found.target, sourceRect?.height ?? row.getBoundingClientRect().height, doc);
    });
    const reset = (): void => {
      preview?.remove();
      preview = undefined;
      pointer = undefined; dragging = false; row.draggable = true; row.removeClass("is-dragging"); this.taskId = undefined; this.clear();
    };
    const cancelDrag = (): void => {
      this.removeGap(false);
      this.restoreSources(false);
      reset();
    };
    row.addEventListener("pointerup", event => {
      if (pointer !== event.pointerId) return;
      if (dragging) { event.preventDefault(); event.stopPropagation(); }
      const target = dragging ? this.intent : undefined;
      if (dragging) suppressClickUntil = Date.now() + 250;
      const captured = dragging;
      pointer = undefined;
      if (captured) row.releasePointerCapture(event.pointerId);
      if (!captured) { reset(); return; }
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
      // No drop target: the row flies back and its slot reopens.
      this.removeGap(true);
      this.restoreSources(true);
      void glide(sourceRect ?? row.getBoundingClientRect()).then(reset);
    });
    row.addEventListener("pointerleave", () => { if (!dragging) reset(); });
    row.addEventListener("pointercancel", () => { if (dragging) cancelDrag(); else reset(); });
    row.addEventListener("lostpointercapture", () => { if (dragging && pointer !== undefined) cancelDrag(); });
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
