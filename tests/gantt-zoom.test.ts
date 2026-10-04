// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));

import { renderGantt } from "../src/gantt-view";
import { addDays } from "../src/calendar";
import type { GanttZoom } from "../src/gantt";

beforeAll(() => {
  installObsidianDom();
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
});

const project = { path: "Site.md", name: "Site", openTasks: 1, completedTasks: 0, archived: false, scheduledDate: "2026-02-02", endDate: "2026-03-20" };

function setup(options: { scale?: number; zoom?: GanttZoom } = {}) {
  document.body.empty();
  const container = document.body.createDiv();
  const navigate = vi.fn(), zoomed = vi.fn();
  renderGantt(container, { projects: [project], anchor: "2026-01-01", zoom: options.zoom ?? "year", scale: options.scale, dateFormat: "YYYY-MM-DD", navigate, open: vi.fn(), update: vi.fn(), zoomed });
  const scroll = () => container.querySelector<HTMLElement>(".tm-gantt-scroll")!;
  const scale = () => Number.parseFloat(scroll().style.getPropertyValue("--tm-gantt-day"));
  /** The date `x` pixels into the dates in view (the label column is 0 wide here). */
  const dateAt = (x: number) => addDays(container.querySelector<HTMLElement>(".tm-gantt-date")!.title, Math.floor((scroll().scrollLeft + x) / scale()));
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label='${label}']`)!;
  return { container, navigate, zoomed, scroll, scale, dateAt, button };
}

it("zooms in and out with its buttons, keeping the dates in view, as far as it goes; the range shown follows the scale", () => {
  const { zoomed, scale, dateAt, button, container } = setup();
  expect(dateAt(0)).toBe("2026-01-01");
  button("Zoom in").click();
  expect(scale()).toBe(4.5);
  expect(dateAt(0)).toBe("2026-01-01");
  expect(zoomed).toHaveBeenLastCalledWith("2026-01-01", "year", 4.5);
  expect(container.querySelectorAll(".tm-gantt")).toHaveLength(1);
  // Past 6 pixels a day, it reads as a quarter: its button is the one pressed.
  button("Zoom in").click();
  expect(container.querySelector("[aria-label='Quarter']")!.getAttribute("aria-pressed")).toBe("true");
  for (let i = 0; i < 20; i++) button("Zoom out").click();
  expect(scale()).toBe(0.5);
  expect(button("Zoom out").disabled).toBe(true);
  expect(dateAt(0)).toBe("2026-01-01");
});

it("zooms about the pointer with the wheel over the dates, or anywhere with Ctrl/Cmd; elsewhere the wheel scrolls", async () => {
  const { scroll, scale, dateAt, container } = setup();
  const wheel = (target: Element, init: WheelEventInit) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
    // happy-dom leaves a wheel event's modifier keys out.
    Object.defineProperty(event, "ctrlKey", { value: Boolean(init.ctrlKey) });
    Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
    target.dispatchEvent(event);
    return event;
  };
  const before = dateAt(300);
  const pinch = wheel(scroll(), { ctrlKey: true, deltaY: -100, clientX: 300 });
  expect(pinch.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(scale()).toBeGreaterThan(3));
  expect(dateAt(300)).toBe(before);

  const row = container.querySelector(".tm-gantt-track")!;
  expect(wheel(row, { deltaY: 100, clientX: 300 }).defaultPrevented).toBe(false);
  const zoomedIn = scale();
  const overDates = wheel(container.querySelector(".tm-gantt-date")!, { deltaY: 100, clientX: 300 });
  expect(overDates.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(scale()).toBeLessThan(zoomedIn));
});

it("pans with the right mouse button, across and down, with no menu", () => {
  const { scroll } = setup();
  const pointer = (type: string, init: PointerEventInit) => scroll().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, ...init }));
  const left = scroll().scrollLeft;
  scroll().scrollTop = 40;
  pointer("pointerdown", { button: 2, clientX: 300, clientY: 100 });
  expect(scroll().classList.contains("is-panning")).toBe(true);
  pointer("pointermove", { clientX: 250, clientY: 80 });
  expect([scroll().scrollLeft, scroll().scrollTop]).toEqual([left + 50, 60]);
  pointer("pointerup", { button: 2, clientX: 250, clientY: 80 });
  expect(scroll().classList.contains("is-panning")).toBe(false);
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  scroll().dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
});

it("moves within a zoomed scale with the arrows, and a range's button goes back to its own", () => {
  const { navigate, button } = setup({ scale: 4.5 });
  button("Next period").click();
  expect(navigate).toHaveBeenLastCalledWith("2027-01-01", "year", 4.5);
  button("Quarter").click();
  expect(navigate).toHaveBeenLastCalledWith("2026-01-01", "quarter");
});
