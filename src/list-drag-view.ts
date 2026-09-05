import { setIcon } from "obsidian";
import type { Task } from "./types";
import type { ListDropGroup, ListPlacement } from "./list-drag";

interface DropIntent { group?: ListDropGroup; anchor?: Task; placement?: ListPlacement; indicator: string }

export class ListDragController {
  private taskId?: string;
  private original?: Task;
  private busy = false;
  private highlighted?: HTMLElement;
  private targets = new Map<HTMLElement, (point: { clientX: number; clientY: number }) => DropIntent>();
  constructor(private readonly getTask: (id: string) => Task | undefined,
    private readonly drop: (task: Task, group?: ListDropGroup, anchor?: Task, placement?: ListPlacement) => Promise<void>) {}

  private clear(): void {
    this.highlighted?.removeAttribute("data-drop-position");
    this.highlighted = undefined;
  }
  private mark(element: HTMLElement, position: string): void {
    this.clear();
    element.setAttribute("data-drop-position", position);
    this.highlighted = element;
  }
  private commit(group?: ListDropGroup, anchor?: Task, placement?: ListPlacement): void {
    const original = this.original;
    this.taskId = undefined;
    this.clear();
    if (!original || this.busy) return;
    this.busy = true;
    void this.drop(original, group, anchor, placement).finally(() => { this.busy = false; });
  }
  group(element: HTMLElement, group: ListDropGroup): void {
    this.targets.set(element, () => ({ group, indicator: "group" }));
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
      this.commit(group);
    });
  }
  row(row: HTMLElement, primary: HTMLElement, task: Task, group?: ListDropGroup): void {
    const handle = primary.createEl("button", { cls: "clickable-icon tm-list-drag-handle", attr: { "aria-label": `Drag ${task.title}`, title: "Drag to reorder; drop to the right to nest, or to the left to outdent" } });
    setIcon(handle, "grip-vertical");
    primary.prepend(handle);
    row.draggable = true;
    row.addEventListener("dragstart", event => {
      if (this.busy || (event.target instanceof HTMLElement && event.target.closest("input"))) { event.preventDefault(); return; }
      this.taskId = task.id;
      this.original = task;
      event.stopPropagation();
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => { this.taskId = undefined; row.removeClass("is-dragging"); this.clear(); });
    const intent = (event: { clientX: number; clientY: number }): { anchor: Task; placement: ListPlacement } => {
      const rect = row.getBoundingClientRect();
      const left = primary.getBoundingClientRect().left;
      let anchor = task;
      let placement: ListPlacement = event.clientX > left + 64 ? "child" : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (event.clientX < left - 16 && anchor.parentId) {
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
      return { ...result, group, indicator: result.anchor.id !== task.id ? "outdent" : result.placement };
    });
    // Pointer dragging on the grip works with mouse, pen and touch, including
    // browsers that do not initiate native HTML dragging from buttons.
    let pointer: number | undefined;
    let origin = { x: 0, y: 0 };
    let dragging = false;
    const hit = (event: PointerEvent): { element: HTMLElement; target: DropIntent } | undefined => {
      let element = row.ownerDocument.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      while (element) {
        const resolve = this.targets.get(element);
        if (resolve) return { element, target: resolve(event) };
        element = element.parentElement;
      }
      return undefined;
    };
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.busy) return;
      event.preventDefault(); event.stopPropagation();
      pointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      dragging = false;
      row.draggable = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (pointer !== event.pointerId) return;
      if (!dragging && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      dragging = true;
      this.taskId = task.id;
      this.original = task;
      row.addClass("is-dragging");
      const found = hit(event);
      if (found) this.mark(found.element, found.target.indicator);
      else this.clear();
    });
    const reset = (): void => { pointer = undefined; dragging = false; row.draggable = true; row.removeClass("is-dragging"); this.taskId = undefined; this.clear(); };
    handle.addEventListener("pointerup", event => {
      if (pointer !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const found = dragging ? hit(event) : undefined;
      if (found) this.commit(found.target.group, found.target.anchor, found.target.placement);
      reset();
      handle.releasePointerCapture(event.pointerId);
    });
    handle.addEventListener("pointercancel", reset);
    handle.addEventListener("lostpointercapture", reset);
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
      this.commit(group, anchor, placement);
    });
  }
}
