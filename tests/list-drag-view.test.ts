// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { ListDragController } from "../src/list-drag-view";
import { scanTasks } from "../src/parser";
import type { Task } from "../src/types";

beforeAll(() => installObsidianDom());
/** How far an element's inline `translate3d` moves it. */
const translation = (element: HTMLElement): { x: number; y: number } => {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(element.style.transform);
  return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : { x: 0, y: 0 };
};
// happy-dom lays nothing out: every element sits where its inline left/top (and translate) put it, 300×40.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const shift = translation(this);
    const left = (parseFloat(this.style.left) || 0) + shift.x, top = (parseFloat(this.style.top) || 0) + shift.y;
    return { left, top, right: left + 300, bottom: top + 40, width: 300, height: 40, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  // Pointer moves are handled once per frame; here each frame runs at once.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(performance.now()); return 0; });
});
afterEach(() => { vi.restoreAllMocks(); document.body.empty(); });

function fire(element: Element, type: string, init: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ button: 0, pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0, ...init })) Object.defineProperty(event, key, { value });
  element.dispatchEvent(event);
  return event;
}

/** A list of rows as the task view renders them; `depths` indents rows like subtasks. */
function list(markdown: string, options: { dragged?: (task: Task) => Task[]; allowNesting?: boolean } = {}) {
  const tasks = scanTasks("Work.md", markdown);
  const drop = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn(options.dragged ?? ((task: Task) => [task]));
  const controller = new ListDragController(id => tasks.find(task => task.id === id), drop, options.allowNesting ?? true, start);
  const view = document.body.createDiv({ cls: "tm-main-view" });
  const element = view.createDiv({ cls: "tm-task-list" });
  const rows = tasks.map(task => {
    const row = element.createDiv({ cls: "tm-task-row tm-task-item", attr: { "data-task-id": task.id } });
    row.style.setProperty("--tm-depth", String(task.indent / 2));
    const primary = row.createDiv({ cls: "tm-task-primary" });
    const title = primary.createEl("button", { cls: "tm-task-title", text: task.title });
    // Titles start after the handle and checkbox: x 80–380 of the row's 0–300.
    title.style.left = "80px";
    const pill = row.createSpan({ cls: "tm-pill", attr: { role: "button" } });
    controller.row(row, primary, task);
    return { row, title, pill };
  });
  let under: Element | null = null;
  document.elementFromPoint = () => under;
  const point = (element: Element | null) => { under = element; };
  return { tasks, rows, drop, start, controller, element, point };
}
const gap = () => document.querySelector<HTMLElement>(".tm-drop-gap");
const preview = () => document.querySelector<HTMLElement>(".tm-drag-preview");
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

it.each(["title", "body"] as const)("drags an unselected task from its %s and suppresses the post-drag edit click", async surface => {
  const { tasks, rows, drop, start, point } = list("- [ ] A\n- [ ] B");
  const grab = surface === "title" ? rows[0].title : rows[0].row;
  fire(grab, "pointerdown");
  expect(start).not.toHaveBeenCalled();
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(start).toHaveBeenCalledExactlyOnceWith(tasks[0]);
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], undefined, tasks[1], "after"));
  expect(rows[0].row.draggable).toBe(true);
  const click = fire(rows[0].row, "click");
  expect(click.defaultPrevented).toBe(true);
});

it("says when a drag is in progress, and when it ends, so a redraw can wait for it", async () => {
  const { rows, controller, drop, point } = list("- [ ] A\n- [ ] B");
  const idle = vi.fn();
  controller.onIdle = idle;
  fire(rows[0].row, "pointerdown");
  expect(controller.dragging).toBe(false);
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(controller.dragging).toBe(true);
  // Another row's reset (the pointer leaving it) does not end this drag.
  fire(rows[1].row, "pointerleave");
  expect(controller.dragging).toBe(true);
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledOnce());
  expect(controller.dragging).toBe(false);
  expect(idle).toHaveBeenCalledOnce();
});

it("keeps title clicks available if the pointer never starts a drag", () => {
  const { rows, drop, start } = list("- [ ] A");
  fire(rows[0].title, "pointerdown");
  expect(fire(rows[0].row, "pointerup").defaultPrevented).toBe(false);
  expect(fire(rows[0].row, "click").defaultPrevented).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(drop).not.toHaveBeenCalled();
  expect(preview()).toBeNull();
});

it("lifts the row: a floating copy follows the pointer and the gap takes the row's place", () => {
  const { rows, point } = list("- [ ] A\n- [ ] B");
  point(null);
  fire(rows[0].row, "pointerdown", { clientX: 15, clientY: 10 });
  fire(rows[0].row, "pointermove", { clientX: 18, clientY: 10 });
  expect(preview()).toBeNull();
  fire(rows[0].row, "pointermove", { clientX: 45, clientY: 30 });
  const copy = preview()!;
  expect(copy.classList.contains("is-selected")).toBe(true);
  expect(copy.querySelector(".tm-drag-count")).toBeNull();
  // The copy keeps the grabbed point (15, 10) under the pointer; happy-dom has no containing-block offset.
  expect([copy.style.width, copy.style.height]).toEqual(["300px", "40px"]);
  expect(copy.getBoundingClientRect()).toMatchObject({ left: 30, top: 20 });
  expect(rows[0].row.classList.contains("tm-drag-source")).toBe(true);
  // Its slot folds away, set on the row itself so that no layout's row sizing outweighs it.
  expect([rows[0].row.style.height, rows[0].row.style.opacity]).toEqual(["0px", "0"]);
  expect(gap()!.nextElementSibling).toBe(rows[0].row);
  expect(gap()!.style.getPropertyValue("--tm-gap-height")).toBe("40px");
});

it("shows a closed hand for the whole drag, and settles the lifted row as it drops", async () => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[0].row, "pointerdown", { clientY: 20 });
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(document.body.classList.contains("tm-list-dragging")).toBe(true);
  const lifted = preview()!;
  expect(lifted.classList.contains("is-settling")).toBe(false);
  fire(rows[0].row, "pointerup", { clientY: 30 });
  expect(lifted.classList.contains("is-settling")).toBe(true);
  await vi.waitFor(() => expect(drop).toHaveBeenCalledOnce());
  expect(document.body.classList.contains("tm-list-dragging")).toBe(false);
});

it("folds away every dragged row and its subtasks, and counts the dragged tasks by the pointer", () => {
  const { tasks, rows, point } = list("- [ ] A\n  - [ ] A child\n- [ ] B\n- [ ] C", { dragged: () => [tasks[0], tasks[2]] });
  point(null);
  fire(rows[0].row, "pointerdown", { clientX: 20, clientY: 5 });
  fire(rows[0].row, "pointermove", { clientX: 20, clientY: 30 });
  expect(rows.map(({ row }) => row.classList.contains("tm-drag-source"))).toEqual([true, true, true, false]);
  const count = preview()!.querySelector<HTMLElement>(".tm-drag-count")!;
  expect(count.textContent).toBe("2");
  expect([count.style.left, count.style.top]).toEqual(["28px", "7px"]);
});

it("moves the gap to the drop position: after a row's subtasks, or nested one level deeper", () => {
  const { rows, point } = list("- [ ] A\n- [ ] B\n  - [ ] B child\n- [ ] C");
  // Grabbed at its middle, so the pointer is where the lifted row's middle is.
  fire(rows[0].row, "pointerdown", { clientY: 20 });
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientX: 0, clientY: 30 });
  // After B means after B's whole subtree.
  expect(gap()!.previousElementSibling).toBe(rows[2].row);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  // Moving right of where it was grabbed: under B, after B's subtasks.
  fire(rows[0].row, "pointermove", { clientX: 100, clientY: 30 });
  expect(gap()!.previousElementSibling).toBe(rows[2].row);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  fire(rows[0].row, "pointermove", { clientX: 0, clientY: 10 });
  expect(gap()!.nextElementSibling).toBe(rows[1].row);
  // Hovering the gap itself leaves it where it is.
  point(gap());
  fire(rows[0].row, "pointermove", { clientX: 0, clientY: 12 });
  expect(gap()!.nextElementSibling).toBe(rows[1].row);
  expect(document.querySelectorAll(".tm-drop-gap")).toHaveLength(1);
});

it("waits at the end of a group's list when dropped on the group, not a row", async () => {
  const { tasks, rows, drop, controller, element, point } = list("- [ ] A\n- [ ] B");
  const group = { property: "priority" as const, value: 1 };
  controller.group(element, group);
  fire(rows[0].row, "pointerdown");
  point(element);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(element.lastElementChild).toBe(gap());
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], group, undefined, undefined));
});

/** A task list above a titled section, as a project page lays them out. */
function sections(kanban = false) {
  const tasks = scanTasks("Work.md", "- [ ] A\n  - [ ] A child\n- [ ] B\n- [ ] C");
  const drop = vi.fn().mockResolvedValue(undefined);
  const controller = new ListDragController(id => tasks.find(task => task.id === id), drop, !kanban);
  const view = document.body.createDiv({ cls: "tm-main-view" });
  const root = kanban ? view.createDiv({ cls: "tm-kanban" }) : view;
  const top = { destination: "Work.md" }, plan = { destination: "Work.md#Plan" };
  const first = root.createDiv({ cls: "tm-task-list" });
  const section = root.createEl("section", { cls: "tm-section" });
  const heading = section.createEl("h2", { text: "Plan" });
  const second = section.createDiv({ cls: "tm-task-list" });
  // The heading (60–100, its middle at 80) sits above the section's list, which starts at 100.
  heading.style.top = "60px";
  second.style.top = "100px";
  const row = (list: HTMLElement, task: Task, depth: number, group: typeof top) => {
    const element = list.createDiv({ cls: "tm-task-row tm-task-item", attr: { "data-task-id": task.id } });
    element.style.setProperty("--tm-depth", String(depth));
    controller.row(element, element.createDiv({ cls: "tm-task-primary" }), task, group);
    return element;
  };
  const rows = [row(first, tasks[0], 0, top), row(first, tasks[1], 1, top), row(second, tasks[2], 0, plan), row(second, tasks[3], 0, plan)];
  controller.group(first, top);
  controller.group(section, plan);
  controller.group(second, plan);
  let under: Element | null = heading;
  document.elementFromPoint = () => under;
  return { tasks, rows, drop, first, second, heading, point: (element: Element | null) => { under = element; } };
}

it("drops a task hovering a group's heading after the last task above the heading, not into the group", async () => {
  const { tasks, rows, drop } = sections();
  fire(rows[3], "pointerdown");
  fire(rows[3], "pointermove", { clientY: 50 });
  // After A's whole subtree, at the top level, in the list above the heading.
  expect(gap()!.previousElementSibling).toBe(rows[1]);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  fire(rows[3], "pointerup", { clientY: 50 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[3], { destination: "Work.md" }, tasks[0], "after"));
});

it("takes a heading as a row: its bottom half starts its group, before the group's first task", async () => {
  const { tasks, rows, drop, second } = sections();
  // Grabbed at its middle, so the lifted row's middle is the pointer.
  fire(rows[0], "pointerdown", { clientY: 20 });
  // 85 is in the heading's bottom half: the start of Plan, before B.
  fire(rows[0], "pointermove", { clientY: 85 });
  expect(second.firstElementChild).toBe(gap());
  // Back over the middle, but not 4px past it, keeps the start; well past it is the end of the list above.
  fire(rows[0], "pointermove", { clientY: 78 });
  expect(second.firstElementChild).toBe(gap());
  fire(rows[0], "pointermove", { clientY: 70 });
  expect(second.firstElementChild).not.toBe(gap());
  fire(rows[0], "pointermove", { clientY: 85 });
  fire(rows[0], "pointerup", { clientY: 85 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], { destination: "Work.md#Plan" }, tasks[2], "before"));
});

it("drops above every heading into the empty list waiting there", async () => {
  const { tasks, rows, drop, first } = sections();
  // Every task sits under a heading: the note's own list above them is empty.
  first.replaceChildren();
  fire(rows[3], "pointerdown");
  fire(rows[3], "pointermove", { clientY: 50 });
  expect(first.firstElementChild).toBe(gap());
  fire(rows[3], "pointerup", { clientY: 50 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[3], { destination: "Work.md" }, undefined, undefined));
});

it("starts the group when nothing is above its heading, and leaves board columns as they are", () => {
  const list = sections();
  list.first.remove();
  fire(list.rows[3], "pointerdown");
  fire(list.rows[3], "pointermove", { clientY: 50 });
  expect(list.second.firstElementChild).toBe(gap());
  fire(list.rows[3], "pointercancel");
  document.body.empty();

  const board = sections(true);
  fire(board.rows[3], "pointerdown");
  fire(board.rows[3], "pointermove", { clientY: 50 });
  // The end of the column, after its last row still shown (the dragged one is folded away): the gap stays put.
  expect(gap()!.parentElement).toBe(board.second);
  expect(gap()!.previousElementSibling).toBe(board.rows[2]);
  fire(board.rows[3], "pointercancel");
});

it("cleans up after a drop that redraws nothing", async () => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[0].row, "pointerdown");
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(gap()).toBeNull());
  expect(preview()).toBeNull();
  expect(rows[0].row.classList.contains("tm-drag-source")).toBe(false);
  expect([rows[0].row.style.height, rows[0].row.style.opacity]).toEqual(["", ""]);
});

it("puts the row back without dropping when released away from any target", async () => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[0].row, "pointerdown");
  point(null);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await settle();
  expect(drop).not.toHaveBeenCalled();
  expect(gap()).toBeNull();
  expect(preview()).toBeNull();
  expect(rows[0].row.classList.contains("tm-drag-source")).toBe(false);
});

it("cancels the drag on Escape: the row goes back, nothing drops, and the key goes no further", async () => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  const later = vi.fn();
  document.addEventListener("keydown", later);
  fire(rows[0].row, "pointerdown");
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(gap()!.previousElementSibling).toBe(rows[1].row);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(later).not.toHaveBeenCalled();
  expect(rows[0].row.releasePointerCapture).toHaveBeenCalledWith(1);
  // The release that follows does nothing, and neither does moving on.
  fire(rows[0].row, "pointermove", { clientY: 60 });
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await settle();
  expect(drop).not.toHaveBeenCalled();
  expect(gap()).toBeNull();
  expect(preview()).toBeNull();
  expect(rows[0].row.classList.contains("tm-drag-source")).toBe(false);
  // Once the drag is over, Escape is left alone.
  const after = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.body.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  document.removeEventListener("keydown", later);
});

it.each(["pointercancel", "lostpointercapture"])("abandons the drag on %s without dropping", async type => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[0].row, "pointerdown");
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  fire(rows[0].row, type);
  await settle();
  expect(preview()).toBeNull();
  expect(gap()).toBeNull();
  expect(rows[0].row.classList.contains("tm-drag-source")).toBe(false);
  expect(rows[0].row.draggable).toBe(true);
  expect(drop).not.toHaveBeenCalled();
});

it("corrects the floating copy inside a pane that offsets fixed elements", () => {
  const { rows, point } = list("- [ ] A");
  point(null);
  const rect = HTMLElement.prototype.getBoundingClientRect as unknown as { mockImplementation(fn: (this: HTMLElement) => DOMRect): void };
  rect.mockImplementation(function (this: HTMLElement) {
    // The pane shifts fixed children by (300, 80); rows themselves sit at (350, 100).
    const fixed = this.classList.contains("tm-drag-preview");
    const shift = translation(this);
    const left = fixed ? (parseFloat(this.style.left) || 0) + 300 + shift.x : 350, top = fixed ? (parseFloat(this.style.top) || 0) + 80 + shift.y : 100;
    return { left, top, width: 300, height: 40 } as DOMRect;
  });
  fire(rows[0].row, "pointerdown", { clientX: 375, clientY: 110 });
  fire(rows[0].row, "pointermove", { clientX: 425, clientY: 150 });
  expect(preview()!.getBoundingClientRect()).toMatchObject({ left: 400, top: 140 });
  fire(rows[0].row, "pointermove", { clientX: 475, clientY: 180 });
  expect(preview()!.getBoundingClientRect()).toMatchObject({ left: 450, top: 170 });
});

it("keeps property-pill clicks on the pill until movement becomes a drag", async () => {
  const { tasks, rows, start, point } = list("- [ ] Task p1");
  const { row, pill } = rows[0];
  point(null);
  // A press on a pill that barely moves stays a click on the pill.
  fire(pill, "pointerdown");
  fire(pill, "pointermove", { clientX: 2 });
  expect(row.setPointerCapture).not.toHaveBeenCalled();
  fire(pill, "pointerup", { clientX: 2 });
  expect(row.releasePointerCapture).not.toHaveBeenCalled();
  expect(fire(pill, "click").defaultPrevented).toBe(false);
  expect(start).not.toHaveBeenCalled();

  // Moving further turns it into a drag, and the click that follows is swallowed.
  fire(pill, "pointerdown");
  fire(pill, "pointermove", { clientX: 10 });
  expect(row.setPointerCapture).toHaveBeenCalledWith(1);
  expect(start).toHaveBeenCalledExactlyOnceWith(tasks[0]);
  fire(row, "pointerup", { clientX: 10 });
  expect(row.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(fire(row, "click").defaultPrevented).toBe(true);
  await settle();
});

it("abandons an uncaptured press when the pointer leaves the row", () => {
  const { rows, start } = list("- [ ] Task");
  fire(rows[0].row, "pointerdown");
  fire(rows[0].row, "pointerleave");
  fire(rows[0].row, "pointermove", { clientX: 50 });
  expect(start).not.toHaveBeenCalled();
  expect(rows[0].row.draggable).toBe(true);
});

it("outdents a subtask dragged left over its own slot, a level per 24px", async () => {
  const { tasks, rows, drop, point } = list("- [ ] A\n  - [ ] A child\n- [ ] B");
  fire(rows[1].row, "pointerdown", { clientX: 100, clientY: 50 });
  point(null);
  fire(rows[1].row, "pointermove", { clientX: 100, clientY: 60 });
  // A small sideways wobble over the slot changes nothing.
  point(gap());
  fire(rows[1].row, "pointermove", { clientX: 92, clientY: 60 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  fire(rows[1].row, "pointermove", { clientX: 70, clientY: 60 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  expect(gap()!.previousElementSibling).toBe(rows[0].row);
  fire(rows[1].row, "pointerup", { clientX: 70, clientY: 60 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[1], undefined, tasks[0], "after"));
});

it("nests by moving right of where the row was grabbed, under the task above the slot, wherever its title is", async () => {
  const { tasks, rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[1].row, "pointerdown", { clientX: 100, clientY: 20 });
  point(gap());
  fire(rows[1].row, "pointermove", { clientX: 100, clientY: 30 });
  // A little right is still a sibling; 24px right of the grab nests B under A, over its own slot.
  fire(rows[1].row, "pointermove", { clientX: 115, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  fire(rows[1].row, "pointermove", { clientX: 124, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  // It stays nested until back within 16px, so a wobble at the edge does not flicker.
  fire(rows[1].row, "pointermove", { clientX: 118, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  fire(rows[1].row, "pointermove", { clientX: 110, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  // Over A's title without moving right: below A, not under it.
  point(rows[0].title);
  fire(rows[1].row, "pointermove", { clientX: 100, clientY: 30 });
  expect(gap()!.previousElementSibling).toBe(rows[0].row);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
  // Moving right over A's row, off its title: under A.
  point(rows[0].row);
  fire(rows[1].row, "pointermove", { clientX: 130, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  fire(rows[1].row, "pointerup", { clientX: 130, clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[1], undefined, tasks[0], "child"));
});

it("puts the row back when nesting is undone over its own slot", async () => {
  const { rows, drop, point } = list("- [ ] A\n- [ ] B");
  fire(rows[1].row, "pointerdown", { clientX: 100, clientY: 20 });
  point(gap());
  fire(rows[1].row, "pointermove", { clientX: 130, clientY: 30 });
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
  fire(rows[1].row, "pointermove", { clientX: 100, clientY: 30 });
  fire(rows[1].row, "pointerup", { clientX: 100, clientY: 30 });
  await settle();
  expect(drop).not.toHaveBeenCalled();
});

it("keeps above or below a row until the lifted row is a few pixels past its middle", () => {
  const { rows, point } = list("- [ ] A\n- [ ] B\n- [ ] C");
  fire(rows[2].row, "pointerdown", { clientY: 20 });
  point(rows[1].row);
  fire(rows[2].row, "pointermove", { clientY: 25 });
  expect(gap()!.previousElementSibling).toBe(rows[1].row);
  // B's middle is at 20: 17 is past it, but not by 4px.
  fire(rows[2].row, "pointermove", { clientY: 17 });
  expect(gap()!.previousElementSibling).toBe(rows[1].row);
  fire(rows[2].row, "pointermove", { clientY: 15 });
  expect(gap()!.nextElementSibling).toBe(rows[1].row);
  fire(rows[2].row, "pointermove", { clientY: 23 });
  expect(gap()!.nextElementSibling).toBe(rows[1].row);
  fire(rows[2].row, "pointermove", { clientY: 25 });
  expect(gap()!.previousElementSibling).toBe(rows[1].row);
});

it("leaves a gap placed by hovering a row alone when the pointer then rests on the gap", () => {
  const { rows, point } = list("- [ ] A\n- [ ] B\n  - [ ] B child\n- [ ] C");
  fire(rows[3].row, "pointerdown", { clientX: 30, clientY: 20 });
  point(rows[2].row);
  fire(rows[3].row, "pointermove", { clientX: 30, clientY: 10 });
  expect(gap()!.nextElementSibling).toBe(rows[2].row);
  point(gap());
  fire(rows[3].row, "pointermove", { clientX: -40, clientY: 12 });
  expect(gap()!.nextElementSibling).toBe(rows[2].row);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("1");
});

it("drops at the end of a section after its last task, so the note's order changes too", async () => {
  const { tasks, rows, drop, controller, element, point } = list("- [ ] A\n- [ ] B\n  - [ ] B child");
  const section = { destination: "Work.md#Plan" };
  controller.group(element, section);
  fire(rows[0].row, "pointerdown");
  point(element);
  fire(rows[0].row, "pointermove", { clientY: 30 });
  expect(element.lastElementChild).toBe(gap());
  fire(rows[0].row, "pointerup", { clientY: 30 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], section, tasks[1], "after"));
});

it("drags on touch after a long press; a quick move stays a swipe or scroll, and the lift blocks scrolling and the menu", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const { tasks, rows, drop, start, point } = list("- [ ] A\n- [ ] B");
    const touch = { pointerType: "touch" };
    // Moving before the press is long enough never lifts the row.
    fire(rows[0].row, "pointerdown", { ...touch, clientX: 20, clientY: 10 });
    fire(rows[0].row, "pointermove", { ...touch, clientX: 60, clientY: 10 });
    vi.advanceTimersByTime(400);
    expect(rows[0].row.classList.contains("is-drag-armed")).toBe(false);
    expect(fire(rows[0].row, "touchmove").defaultPrevented).toBe(false);
    fire(rows[0].row, "pointerup", touch);

    fire(rows[0].row, "pointerdown", { ...touch, clientX: 20, clientY: 10 });
    vi.advanceTimersByTime(349);
    expect(rows[0].row.classList.contains("is-drag-armed")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(rows[0].row.classList.contains("is-drag-armed")).toBe(true);
    expect(fire(rows[0].row, "touchmove").defaultPrevented).toBe(true);
    expect(fire(rows[0].row, "contextmenu").defaultPrevented).toBe(true);
    point(rows[1].row);
    fire(rows[0].row, "pointermove", { ...touch, clientX: 20, clientY: 30 });
    expect(start).toHaveBeenCalledExactlyOnceWith(tasks[0]);
    fire(rows[0].row, "pointerup", { ...touch, clientX: 20, clientY: 30 });
    vi.useRealTimers();
    await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], undefined, tasks[1], "after"));
    expect(rows[0].row.classList.contains("is-drag-armed")).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("drops a touch long press let go without moving, and keeps its click from selecting", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const { rows, start } = list("- [ ] A");
    fire(rows[0].row, "pointerdown", { pointerType: "touch" });
    vi.advanceTimersByTime(400);
    fire(rows[0].row, "pointerup", { pointerType: "touch" });
    expect(start).not.toHaveBeenCalled();
    expect(rows[0].row.classList.contains("is-drag-armed")).toBe(false);
    expect(fire(rows[0].row, "click").defaultPrevented).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("keeps a touch drag going when the pressed title hands its pointer capture to the row", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const { tasks, rows, drop, point } = list("- [ ] A\n- [ ] B");
    const touch = { pointerType: "touch" };
    fire(rows[0].title, "pointerdown", { ...touch, clientX: 100, clientY: 10 });
    vi.advanceTimersByTime(400);
    point(rows[1].row);
    fire(rows[0].row, "pointermove", { ...touch, clientX: 20, clientY: 30 });
    // The title's implicit capture ends as the row takes it; the event bubbles to the row.
    fire(rows[0].title, "lostpointercapture", touch);
    expect(preview()).not.toBeNull();
    fire(rows[0].row, "pointerup", { ...touch, clientX: 20, clientY: 30 });
    vi.useRealTimers();
    await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], undefined, tasks[1], "after"));
  } finally { vi.useRealTimers(); }
});

/**
 * A list laid out by its order (rows 40px, the gap its height, folded rows nothing), whose slides stay at
 * their start: each moved row is drawn where it was, as in the first frame of a slide.
 */
function laidOut(markdown: string) {
  const made = list(markdown);
  const slides = new Map<HTMLElement, { delta: number; playState: string }>();
  const restTop = (element: HTMLElement): number => {
    let top = 0;
    for (const sibling of Array.from(element.parentElement!.children) as HTMLElement[]) {
      if (sibling === element) return top;
      if (sibling.classList.contains("tm-drag-preview") || sibling.classList.contains("tm-drag-source")) continue;
      top += sibling.classList.contains("tm-drop-gap") ? parseFloat(sibling.style.getPropertyValue("--tm-gap-height")) || 40 : 40;
    }
    return top;
  };
  const holder = (element: HTMLElement): HTMLElement | null => element.closest<HTMLElement>(".tm-task-item:not(.tm-drag-preview), .tm-drop-gap");
  const drawnTop = (element: HTMLElement): number => {
    const row = holder(element)!;
    const slide = slides.get(row);
    return restTop(row) + (slide?.playState === "running" ? slide.delta : 0);
  };
  (HTMLElement.prototype.getBoundingClientRect as unknown as { mockImplementation(fn: (this: HTMLElement) => DOMRect): void }).mockImplementation(function (this: HTMLElement) {
    const inList = holder(this) !== null && this.closest(".tm-task-list") !== null;
    const shift = translation(this);
    const left = (parseFloat(this.style.left) || 0) + shift.x, top = inList ? drawnTop(this) : (parseFloat(this.style.top) || 0) + shift.y;
    return { left, top, right: left + 300, bottom: top + 40, width: 300, height: 40, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[]) {
    const delta = parseFloat(/translateY\((-?[\d.]+)px\)/.exec(String(keyframes[0].transform))?.[1] ?? "0");
    const slide = { delta, playState: "running" };
    slides.set(this, slide);
    return { get playState() { return slide.playState; }, effect: { getComputedTiming: () => ({ progress: 0 }) }, cancel() { slide.playState = "idle"; }, finished: Promise.resolve() } as unknown as Animation;
  };
  // What is drawn under a point: rows (and the gap) where they are drawn, then the list.
  document.elementsFromPoint = (_x: number, y: number) => {
    const drawn = (Array.from(made.element.children) as HTMLElement[]).filter(child =>
      !child.classList.contains("tm-drag-preview") && !child.classList.contains("tm-drag-source") && y >= drawnTop(child) && y < drawnTop(child) + 40);
    return [...drawn.reverse(), made.element];
  };
  return { ...made, slides };
}

it("aims at where rows will rest, not where they are drawn mid-slide", () => {
  try {
    const { rows, slides } = laidOut("- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D");
    fire(rows[3].row, "pointerdown", { clientX: 10, clientY: 140 });
    // Over A's top half: the gap opens before A, and A, B and C start sliding down from where they were.
    fire(rows[3].row, "pointermove", { clientX: 10, clientY: 10 });
    expect(gap()!.nextElementSibling).toBe(rows[0].row);
    expect(slides.get(rows[0].row)).toMatchObject({ delta: -40, playState: "running" });
    // A is still drawn at 0–40, but rests at 40–80: the pointer at 25 is over the gap, which stays.
    fire(rows[3].row, "pointermove", { clientX: 10, clientY: 25 });
    expect(gap()!.nextElementSibling).toBe(rows[0].row);
    // At 70 the pointer is over A's resting bottom half (though B is drawn there): after A.
    fire(rows[3].row, "pointermove", { clientX: 10, clientY: 70 });
    expect(gap()!.previousElementSibling).toBe(rows[0].row);
  } finally { delete (HTMLElement.prototype as { animate?: unknown }).animate; delete (document as { elementsFromPoint?: unknown }).elementsFromPoint; }
});

it("keeps the gap, and rows sliding, when the target names the same slot another way", () => {
  try {
    const { rows, slides, tasks, drop } = laidOut("- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D");
    fire(rows[3].row, "pointerdown", { clientX: 10, clientY: 140 });
    // Below A's middle: after A, which opens the gap between A and B; B and C slide down.
    fire(rows[3].row, "pointermove", { clientX: 10, clientY: 30 });
    const placed = gap()!;
    expect(placed.previousElementSibling).toBe(rows[0].row);
    const sliding = slides.get(rows[1].row);
    expect(sliding?.playState).toBe("running");
    // Over B's resting top half: before B, the same slot. Nothing moves and B's slide carries on.
    fire(rows[3].row, "pointermove", { clientX: 10, clientY: 85 });
    expect(gap()).toBe(placed);
    expect(placed.previousElementSibling).toBe(rows[0].row);
    expect(slides.get(rows[1].row)).toBe(sliding);
    expect(sliding?.playState).toBe("running");
    // The drop takes the latest description of the slot.
    fire(rows[3].row, "pointerup", { clientX: 10, clientY: 85 });
    return vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[3], undefined, tasks[1], "before"));
  } finally { delete (HTMLElement.prototype as { animate?: unknown }).animate; delete (document as { elementsFromPoint?: unknown }).elementsFromPoint; }
});

it("handles pointer moves once per frame, and the last move before a drop", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { frames.push(callback); return frames.length; });
  const { tasks, rows, drop, point } = list("- [ ] A\n- [ ] B\n- [ ] C");
  fire(rows[0].row, "pointerdown", { clientX: 10, clientY: 20 });
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientX: 10, clientY: 20 });
  fire(rows[0].row, "pointermove", { clientX: 10, clientY: 25 });
  point(rows[2].row);
  fire(rows[0].row, "pointermove", { clientX: 10, clientY: 30 });
  // Three moves, one frame, nothing moved yet.
  expect(frames).toHaveLength(1);
  expect(preview()!.style.transform).toBe("");
  frames.shift()!(0);
  expect(gap()!.previousElementSibling).toBe(rows[2].row);
  expect(preview()!.style.transform).toBe("translate3d(0px, 10px, 0px)");
  // A move whose frame has not run still counts when the row is let go.
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientX: 10, clientY: 15 });
  fire(rows[0].row, "pointerup", { clientX: 10, clientY: 15 });
  await vi.waitFor(() => expect(drop).toHaveBeenCalledExactlyOnceWith(tasks[0], undefined, tasks[1], "before"));
});

it("never reads a spot where sliding rows leave nothing drawn as the end of the list", () => {
  try {
    const { rows, controller, element } = laidOut("- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D\n- [ ] E");
    // The list's own drop: its end, for the empty space below the last row.
    controller.group(element, { destination: "Work.md" });
    fire(rows[0].row, "pointerdown", { clientX: 10, clientY: 20 });
    fire(rows[0].row, "pointermove", { clientX: 10, clientY: 70 });
    const placed = gap()!;
    expect(placed.previousElementSibling).toBe(rows[1].row);
    // Mid-slide, nothing is drawn under the point but the list (as when rows pass each other).
    document.elementsFromPoint = () => [element];
    fire(rows[0].row, "pointermove", { clientX: 10, clientY: 72 });
    expect(gap()).toBe(placed);
    expect(placed.previousElementSibling).toBe(rows[1].row);
    // Over C's resting top half, still only the list drawn there: before C, the same slot. Never the end.
    fire(rows[0].row, "pointermove", { clientX: 10, clientY: 95 });
    expect(placed.previousElementSibling).toBe(rows[1].row);
    expect(element.lastElementChild).not.toBe(placed);
    // Below every row it is the end.
    fire(rows[0].row, "pointermove", { clientX: 10, clientY: 400 });
    expect(element.lastElementChild === gap() || element.lastElementChild?.classList.contains("tm-drag-preview")).toBe(true);
  } finally { delete (HTMLElement.prototype as { animate?: unknown }).animate; delete (document as { elementsFromPoint?: unknown }).elementsFromPoint; }
});

it("slides a heading out of the way when the gap moves past it, as rows do", () => {
  const { rows, heading, first } = sections();
  // The heading rests 40px lower while the gap sits in the list above it.
  const rect = HTMLElement.prototype.getBoundingClientRect as unknown as { getMockImplementation(): (this: HTMLElement) => DOMRect; mockImplementation(fn: (this: HTMLElement) => DOMRect): void };
  const base = rect.getMockImplementation();
  rect.mockImplementation(function (this: HTMLElement) {
    const box = base.call(this);
    if (this !== heading || !first.contains(gap())) return box;
    return { ...box, top: box.top + 40, bottom: box.bottom + 40, y: box.top + 40 } as DOMRect;
  });
  const animate = vi.fn(() => ({ playState: "running", effect: { getComputedTiming: () => ({ progress: 0 }) }, cancel: vi.fn(), finished: Promise.resolve() }) as unknown as Animation);
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  try {
    fire(rows[3], "pointerdown");
    fire(rows[3], "pointermove", { clientY: 50 });
    expect(first.contains(gap())).toBe(true);
    expect(animate.mock.contexts).toContain(heading);
    const call = animate.mock.calls[animate.mock.contexts.indexOf(heading)] as unknown as [Keyframe[]];
    expect(call[0][0].transform).toBe("translateY(-40px)");
  } finally { delete (HTMLElement.prototype as { animate?: unknown }).animate; }
});
