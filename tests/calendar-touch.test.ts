// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderCalendar } from "../src/calendar-view";

beforeAll(() => installObsidianDom());
afterEach(() => { vi.useRealTimers(); document.body.empty(); });

function day() {
  const create = vi.fn();
  renderCalendar(document.body.createDiv(), {
    anchor: "2026-10-05", scope: "day", tasks: [], dateFormat: "YYYY-MM-DD",
    navigate: vi.fn(), create, edit: vi.fn(), move: vi.fn(), resize: vi.fn()
  });
  const lane = document.querySelector<HTMLElement>(".tm-calendar-lane")!;
  vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({ top: 0, height: 1152 } as DOMRect);
  Object.assign(lane, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  // 10:00 is slot 40, 12px each.
  const slot = lane.querySelectorAll<HTMLElement>(".tm-calendar-slot")[40];
  const fire = (target: Element, type: string, clientY: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ button: 0, pointerId: 1, pointerType: "touch", clientX: 10, clientY })) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
  };
  return { create, lane, slot, fire };
}

it("scrolls on a touch swipe, rather than adding a task", () => {
  vi.useFakeTimers();
  const { create, lane, slot, fire } = day();
  fire(slot, "pointerdown", 485);
  fire(lane, "pointermove", 530);
  vi.advanceTimersByTime(1000);
  fire(lane, "pointerup", 530);
  expect(create).not.toHaveBeenCalled();
  expect(lane.querySelector(".tm-calendar-selection")).toBeNull();
});

it("adds a task on a tap, and selects a range after a press held still", () => {
  vi.useFakeTimers();
  const { create, lane, slot, fire } = day();
  fire(slot, "pointerdown", 485);
  fire(lane, "pointerup", 485);
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledDate: "2026-10-05", scheduledTime: "10:00", durationMinutes: 15 }));

  fire(slot, "pointerdown", 485);
  vi.advanceTimersByTime(400);
  expect(lane.querySelector(".tm-calendar-selection")).not.toBeNull();
  fire(lane, "pointermove", 520);
  fire(lane, "pointerup", 520);
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledTime: "10:00", durationMinutes: 60 }));
});
