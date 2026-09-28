// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { ListDragController } from "../src/list-drag-view";
import { scanTasks } from "../src/parser";
import type { Task } from "../src/types";

beforeAll(() => installObsidianDom());
// happy-dom lays nothing out: every element sits where its inline left/top put it, 300×40.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
    return { left, top, right: left + 300, bottom: top + 40, width: 300, height: 40, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
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
  expect(gap()!.nextElementSibling).toBe(rows[0].row);
  expect(gap()!.style.getPropertyValue("--tm-gap-height")).toBe("40px");
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
  fire(rows[0].row, "pointerdown");
  point(rows[1].row);
  fire(rows[0].row, "pointermove", { clientX: 0, clientY: 30 });
  // After B means after B's whole subtree.
  expect(gap()!.previousElementSibling).toBe(rows[2].row);
  expect(gap()!.style.getPropertyValue("--tm-depth")).toBe("0");
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
  // The heading sits above the section's list, which starts lower down.
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
  expect(board.second.lastElementChild).toBe(gap());
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
    const left = fixed ? (parseFloat(this.style.left) || 0) + 300 : 350, top = fixed ? (parseFloat(this.style.top) || 0) + 80 : 100;
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
