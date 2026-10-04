// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));

import { renderCalendar } from "../src/calendar-view";
import { scanTasks } from "../src/parser";

beforeAll(() => installObsidianDom());

const at = (type: string, clientY: number, relatedTarget?: Node) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientY, relatedTarget, dataTransfer: null });

it("shows where a dragged task would land as the lists' drop slot: at its time and length in a day, or after a day's tasks", async () => {
  const task = Object.assign(scanTasks("A.md", "- [ ] Write the report")[0], { scheduledDate: "2026-09-09", scheduledTime: "09:00", durationMinutes: 60 });
  const move = vi.fn().mockResolvedValue(undefined);
  const container = document.body.createDiv();
  renderCalendar(container, { anchor: "2026-09-09", scope: "day", tasks: [task], dateFormat: "YYYY-MM-DD", navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move, resize: vi.fn() });
  const lane = container.querySelector<HTMLElement>(".tm-calendar-lane")!;
  lane.getBoundingClientRect = () => ({ top: 0, height: 1152 }) as DOMRect;
  const card = lane.querySelector<HTMLElement>(".tm-calendar-task")!;
  card.getBoundingClientRect = () => ({ top: 432, height: 48 }) as DOMRect;
  card.dispatchEvent(at("dragstart", 432));
  await new Promise(resolve => setTimeout(resolve, 0));
  // The card fades where it was, and a slot an hour long waits at 10:00.
  expect(card.classList.contains("is-dragging")).toBe(true);
  lane.dispatchEvent(at("dragover", 480));
  const gap = lane.querySelector<HTMLElement>(".tm-calendar-drop-gap.is-timed")!;
  expect([gap.style.top, gap.style.height]).toEqual(["480px", "48px"]);
  // Leaving the day takes the slot away; coming back and dropping writes the time.
  lane.dispatchEvent(at("dragleave", 480, document.body));
  expect(lane.querySelector(".tm-calendar-drop-gap")).toBeNull();
  lane.dispatchEvent(at("dragover", 480));
  lane.dispatchEvent(at("drop", 480));
  expect(lane.querySelector(".tm-calendar-drop-gap")).toBeNull();
  expect(move).toHaveBeenCalledWith(task, "2026-09-09", "10:00");
  card.dispatchEvent(at("dragend", 0));
  expect(card.classList.contains("is-dragging")).toBe(false);

  // A month's day: the slot follows the day's tasks.
  container.empty();
  renderCalendar(container, { anchor: "2026-09-09", scope: "month", tasks: [task], dateFormat: "YYYY-MM-DD", navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move, resize: vi.fn() });
  container.querySelector<HTMLElement>(".tm-calendar-task")!.dispatchEvent(at("dragstart", 0));
  const cell = Array.from(container.querySelectorAll<HTMLElement>(".tm-calendar-cell")).find(item => item.textContent?.startsWith("12"))!;
  cell.dispatchEvent(at("dragover", 0));
  expect(cell.lastElementChild!.className).toBe("tm-calendar-drop-gap");
});
