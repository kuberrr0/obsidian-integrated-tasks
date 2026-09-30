import type { Task } from "./types";

/** A list in the task sidebar that takes dropped tasks, as Things' lists do: Inbox and a project take them in,
 * Today schedules them for today, and a tag is added to them. */
export type SidebarDrop = { kind: "inbox" } | { kind: "today" } | { kind: "project"; path: string } | { kind: "tag"; tag: string };

/** The tasks being dragged in a task view, and what dropping them on a sidebar list does. */
export interface TaskDrag { tasks: Task[]; drop(target: SidebarDrop): Promise<void> }

const ATTRIBUTE = "data-tm-drop";
/** Marks a native drag of tasks, so the sidebar tells it from a file or text dragged over it. */
export const TASK_DRAG_TYPE = "application/x-tm-task";

let current: TaskDrag | undefined;

/** Makes `element` a place to drop tasks on. */
export function markDropTarget(element: HTMLElement, drop: SidebarDrop): void {
  element.setAttribute(ATTRIBUTE, JSON.stringify(drop));
}

export function dropTargetOf(element: Element | null): { element: HTMLElement; drop: SidebarDrop } | undefined {
  const target = element?.closest<HTMLElement>(`[${ATTRIBUTE}]`);
  if (!target) return undefined;
  try {
    const drop = JSON.parse(target.getAttribute(ATTRIBUTE) ?? "") as SidebarDrop;
    return { element: target, drop };
  } catch { return undefined; }
}

/** The sidebar list under a point, if any. */
export function dropTargetAt(doc: Document, x: number, y: number): { element: HTMLElement; drop: SidebarDrop } | undefined {
  return dropTargetOf(doc.elementFromPoint(x, y));
}

/** Starts a drag of tasks. It ends when the pointer is let go or the native drag ends; a sidebar list dropped on
 * reads the drag first. */
export function startTaskDrag(doc: Document, drag: TaskDrag): TaskDrag {
  current = drag;
  const end = (): void => {
    doc.removeEventListener("dragend", end, true);
    doc.removeEventListener("pointerup", end, true);
    if (current === drag) current = undefined;
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
