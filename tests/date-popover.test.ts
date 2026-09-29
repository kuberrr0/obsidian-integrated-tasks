// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { describeWhen, nextWeek, openDatePopover, parseDurationInput, parseWhenInput, type DatePopoverOptions } from "../src/date-popover";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.empty(); });
// Tuesday, Sep 29 2026.
const now = new Date(2026, 8, 29, 12);

function popover(overrides: Partial<DatePopoverOptions> = {}) {
  const anchor = document.body.createSpan({ text: "Today" });
  const save = vi.fn();
  const handle = openDatePopover({ anchor, kind: "scheduled", value: {}, dateFormat: "YYYY-MM-DD", now, save, ...overrides });
  const find = (text: string) => Array.from(handle.element.querySelectorAll<HTMLElement>("button")).find(button => button.textContent === text)!;
  const input = handle.element.querySelector<HTMLInputElement>("input")!;
  const hint = () => handle.element.querySelector(".tm-date-popover-hint")!.textContent;
  const type = (text: string) => { input.value = text; input.dispatchEvent(new Event("input")); };
  const key = (name: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  return { handle, save, find, input, hint, type, key };
}

describe("helpers", () => {
  it("means next Monday by next week", () => {
    expect(nextWeek("2026-09-29")).toBe("2026-10-05");
    expect(nextWeek("2026-10-04")).toBe("2026-10-05");
    expect(nextWeek("2026-10-05")).toBe("2026-10-12");
  });
  it("reads durations typed loosely", () => {
    expect(["30m", "45", "1h", "1h30m", "1.5h", "2 hours", "20 min", "", "soon"].map(parseDurationInput)).toEqual([30, 45, 60, 90, 90, 120, 20, undefined, undefined]);
  });
  it("describes a value in one line", () => {
    expect(describeWhen({ date: "2026-10-09", time: "15:00", duration: 30 })).toBe("Fri, Oct 9, 2026, 3:00 PM · 30m");
    expect(describeWhen({})).toBe("No date");
  });
});

describe("reading the one input", () => {
  const current = { date: "2026-10-01", time: "09:00", duration: 15 };
  const read = (text: string, kind: "scheduled" | "deadline" = "scheduled", value: typeof current | Record<string, never> = current) => parseWhenInput(text, kind, value, now, "YYYY-MM-DD");

  it("takes a date, time and duration in any order, keeping what is left out", () => {
    expect(read("next friday 3pm 30m")).toEqual({ date: "2026-10-09", time: "15:00", duration: 30 });
    expect(read("1h30m tomorrow")).toEqual({ date: "2026-09-30", time: "09:00", duration: 90 });
    expect(read("for 45 min")).toEqual({ ...current, duration: 45 });
    expect(read("tomorrow")).toEqual({ ...current, date: "2026-09-30" });
  });

  it("puts a time alone on the current date, or today", () => {
    expect(read("3pm")).toEqual({ ...current, time: "15:00" });
    expect(read("3pm", "scheduled", {})).toEqual({ date: "2026-09-29", time: "15:00" });
  });

  it("clears the time or duration on request", () => {
    expect(read("no time")).toEqual({ ...current, time: undefined });
    expect(read("no duration")).toEqual({ ...current, duration: undefined });
  });

  it("reads no duration for a deadline, and rejects what it does not understand", () => {
    expect(read("friday 5pm", "deadline")).toEqual({ ...current, date: "2026-10-02", time: "17:00" });
    expect(read("30m", "deadline")).toBeUndefined();
    expect(read("banana")).toBeUndefined();
    expect(read("tomorrow banana")).toBeUndefined();
  });
});

describe("date popover", () => {
  it("has one input, No date and a calendar, and shows the current value under the input", () => {
    const { handle, input, hint } = popover({ value: { date: "2026-09-28", time: "09:45", duration: 30 } });
    expect(handle.element.querySelectorAll("input")).toHaveLength(1);
    expect(Array.from(handle.element.querySelectorAll(".tm-date-popover-choice")).map(row => row.textContent)).toEqual(["No date"]);
    expect(hint()).toBe("Mon, Sep 28, 2026, 9:45 AM · 30m");
    expect(handle.element.querySelector(".is-selected")!.getAttribute("data-date")).toBe("2026-09-28");
    expect(handle.element.querySelector(".is-today")!.getAttribute("data-date")).toBe("2026-09-29");
    expect(handle.element.querySelector(".tm-date-popover-day")!.getAttribute("data-date")).toBe("2026-08-31");
    expect(document.activeElement).toBe(input);
  });

  it("saves and closes on a picked day or No date", () => {
    const first = popover();
    first.handle.element.querySelector<HTMLElement>('[data-date="2026-10-08"]')!.click();
    expect(first.save).toHaveBeenCalledExactlyOnceWith({ date: "2026-10-08" });
    expect(first.handle.element.isConnected).toBe(false);
    const second = popover({ value: { date: "2026-10-08", time: "09:00" } });
    second.find("No date").click();
    expect(second.save).toHaveBeenCalledExactlyOnceWith({ date: undefined, time: undefined });
  });

  it("previews what is typed, keeps text it does not understand, and saves on Enter", () => {
    const { save, hint, type, key, handle } = popover({ value: { date: "2026-10-01" } });
    type("banana");
    expect(hint()).toBe("Not a date, time or duration");
    key("Enter");
    expect(save).not.toHaveBeenCalled();
    expect(handle.element.isConnected).toBe(true);
    type("next friday 3pm 30m");
    expect(hint()).toBe("Fri, Oct 9, 2026, 3:00 PM · 30m");
    key("Enter");
    expect(save).toHaveBeenCalledExactlyOnceWith({ date: "2026-10-09", time: "15:00", duration: 30 });
  });

  it("closes without saving on Escape, and saves what was typed on a click outside", () => {
    const first = popover({ value: { date: "2026-10-01" } });
    first.type("5pm");
    first.key("Escape");
    expect(first.save).not.toHaveBeenCalled();
    expect(first.handle.element.isConnected).toBe(false);
    const second = popover({ value: { date: "2026-10-01" } });
    second.type("5pm");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(second.save).toHaveBeenCalledExactlyOnceWith({ date: "2026-10-01", time: "17:00" });
  });

  it("describes a deadline by date and time only", () => {
    const { hint, type, input } = popover({ kind: "deadline" });
    expect(input.getAttribute("placeholder")).toBe("Type a date or time");
    type("30m");
    expect(hint()).toBe("Not a date or time");
  });

  it("keeps one popover open at a time and saves nothing when nothing changed", () => {
    const first = popover({ value: { date: "2026-10-01" } });
    const second = popover();
    expect(first.handle.element.isConnected).toBe(false);
    expect(first.save).not.toHaveBeenCalled();
    second.handle.close();
    expect(second.save).not.toHaveBeenCalled();
  });
});
