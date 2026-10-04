import type { Task } from "./types";

/** A list in the task sidebar that takes dropped tasks, as Things' lists do: Inbox, a project and a note in the file
 * tree take them in, Today schedules them for today, and a tag is added to them. A calendar's day (and hour) in another
 * pane schedules them then; without a date, their dates come off. */
export type SidebarDrop = { kind: "inbox" } | { kind: "today" } | { kind: "project"; path: string } | { kind: "note"; path: string } | { kind: "tag"; tag: string }
  | { kind: "schedule"; date?: string; time?: string };

/** The tasks being dragged in a task view, and what dropping them on a sidebar list does. */
export interface TaskDrag {
  tasks: Task[];
  drop(target: SidebarDrop): Promise<void>;
  /** The dragged row's height, for the slot a list in another pane opens for it. */
  height?: number;
}

export interface DropPoint { clientX: number; clientY: number }

/**
 * A place in another pane that takes dragged tasks where they land, as a calendar's hours or a list: it shows where
 * they would land, as it does for its own tasks, and drops them there.
 */
export interface DropZone {
  hover(point: DropPoint, drag: TaskDrag): void;
  leave(): void;
  drop(point: DropPoint, drag: TaskDrag): Promise<void>;
}

/** A drop target under the pointer: a sidebar list (`drop`) or a pane's drop zone (`zone`). */
export type DropTarget = { element: HTMLElement; drop: SidebarDrop; zone?: undefined } | { element: HTMLElement; zone: DropZone; drop?: undefined };

const ATTRIBUTE = "data-tm-drop";
const ZONE_ATTRIBUTE = "data-tm-drop-zone";
const zones = new WeakMap<HTMLElement, DropZone>();
/** Marks a native drag of tasks, so the sidebar tells it from a file or text dragged over it. */
export const TASK_DRAG_TYPE = "application/x-tm-task";

let current: TaskDrag | undefined;
const listeners = new Set<(drag: TaskDrag | undefined) => void>();

/** Calls `listener` as a drag of tasks starts (with it) and ends (with nothing); returns how to stop listening. */
export function onTaskDrag(listener: (drag: TaskDrag | undefined) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Makes `element` a place to drop tasks on. */
export function markDropTarget(element: HTMLElement, drop: SidebarDrop): void {
  element.setAttribute(ATTRIBUTE, JSON.stringify(drop));
}

/** Makes `element` a drop zone for tasks dragged in another pane; marking it again replaces its zone. */
export function markDropZone(element: HTMLElement, zone: DropZone): void {
  element.setAttribute(ZONE_ATTRIBUTE, "");
  zones.set(element, zone);
}

export function dropTargetOf(element: Element | null): DropTarget | undefined {
  const area = element?.closest<HTMLElement>(`[${ZONE_ATTRIBUTE}]`);
  const zone = area && zones.get(area);
  if (area && zone) return { element: area, zone };
  const target = element?.closest<HTMLElement>(`[${ATTRIBUTE}]`);
  if (!target) return undefined;
  try {
    const drop = JSON.parse(target.getAttribute(ATTRIBUTE) ?? "") as SidebarDrop;
    return { element: target, drop };
  } catch { return undefined; }
}

/** The sidebar list (or drop zone) under a point, if any. */
export function dropTargetAt(doc: Document, x: number, y: number): DropTarget | undefined {
  return dropTargetOf(doc.elementFromPoint(x, y));
}

/** Starts a drag of tasks. It ends when the pointer is let go or the native drag ends; a sidebar list dropped on
 * reads the drag first. */
export function startTaskDrag(doc: Document, drag: TaskDrag): TaskDrag {
  current = drag;
  for (const listener of listeners) listener(drag);
  const end = (): void => {
    doc.removeEventListener("dragend", end, true);
    doc.removeEventListener("pointerup", end, true);
    if (current !== drag) return;
    current = undefined;
    for (const listener of listeners) listener(undefined);
  };
  doc.addEventListener("dragend", end, true);
  doc.addEventListener("pointerup", end, true);
  return drag;
}

/** The drag of tasks in progress, if any. */
export function activeTaskDrag(): TaskDrag | undefined { return current; }

/** Shows or hides the drop highlight on a sidebar list. */
export function highlightDropTarget(element: HTMLElement | undefined, on: boolean): void {
  element?.classList.toggle("is-drop-target", on);
}
