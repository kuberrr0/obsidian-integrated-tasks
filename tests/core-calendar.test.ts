import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));
import { renderCalendar, UNSCHEDULED_PAGE, type CalendarOptions } from "../src/calendar-view";
import { scanTasks } from "../src/parser";
import type { Task } from "../src/types";

let focused: FakeElement | undefined;

class FakeElement extends EventTarget {
  children: FakeElement[] = [];
  parent?: FakeElement;
  tag: string;
  text = "";
  cls = "";
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  open = false;
  hidden = false;
  draggable = false;
  scrollTop = 0;
  constructor(tag = "div") { super(); this.tag = tag; }
  createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string>; type?: string } = {}): FakeElement {
    const child = new FakeElement(tag);
    child.text = options.text ?? "";
    child.cls = options.cls ?? "";
    child.attrs = { ...options.attr };
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  setText(text: string) { this.text = text; }
  addClass(cls: string) { if (!this.hasClass(cls)) this.cls += ` ${cls}`; }
  removeClass(cls: string) { this.cls = this.cls.split(" ").filter(name => name !== cls).join(" "); }
  hasClass(cls: string) { return this.cls.split(" ").includes(cls); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  removeAttribute(name: string) { delete this.attrs[name]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() { focused = this; }
  getBoundingClientRect() { return { top: 0, height: 1152 }; }
  querySelector(selector: string) { return this.all().find(element => element.hasClass(selector.replace(/^\./, ""))) ?? null; }
  all(): FakeElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  byClass(cls: string) { return this.all().filter(element => element.hasClass(cls)); }
}

/** Dispatch through the ancestors, since the fake elements are not a real DOM tree. */
const bubble = (target: FakeElement, event: Event): void => {
  Object.defineProperty(event, "target", { value: target, configurable: true });
  for (let node: FakeElement | undefined = target; node && !event.cancelBubble; node = node.parent) node.dispatchEvent(event);
};
const key = (target: FakeElement, name: string, type = "keydown") => bubble(target, Object.assign(new Event(type, { cancelable: true }), { key: name }));

function render(overrides: Partial<CalendarOptions>) {
  const container = new FakeElement();
  const options: CalendarOptions = {
    anchor: "2026-09-20", scope: "month", tasks: [], dateFormat: "YYYY-MM-DD",
    navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn().mockResolvedValue(undefined), ...overrides
  };
  renderCalendar(container as unknown as HTMLElement, options);
  return { container, options };
}

const undated = (count: number): Task[] => scanTasks("Big.md", Array.from({ length: count }, (_, i) => `- [ ] Undated ${i}`).join("\n"));

afterEach(() => { vi.useRealTimers(); focused = undefined; });

describe("unscheduled tray", () => {
  it.each([false, true])("renders undated tasks in pages of 200 (planner: %s)", planning => {
    const { container } = render({ tasks: undated(450), planning });
    const tray = container.byClass("tm-calendar-unscheduled")[0];
    expect(tray.attrs["data-tm-scroll-key"]).toBe("calendar-tray");
    const cards = () => tray.byClass("tm-calendar-task");
    expect(cards()).toHaveLength(UNSCHEDULED_PAGE);
    const more = tray.byClass("tm-show-more-tasks")[0];
    expect(more.text).toBe("Show 200 more (250 hidden)");
    more.dispatchEvent(new Event("click"));
    expect(cards()).toHaveLength(400);
    expect(more.text).toBe("Show 50 more (50 hidden)");
    more.dispatchEvent(new Event("click"));
    expect(cards()).toHaveLength(450);
    expect(tray.byClass("tm-show-more-tasks")).toHaveLength(0);
    expect(focused?.text).toBe("Undated 400");
    expect(cards().map(card => card.byClass("tm-calendar-task-title")[0].text).slice(-2)).toEqual(["Undated 448", "Undated 449"]);
  });

  it("shows every task without a button when they fit in one page", () => {
    const { container } = render({ tasks: undated(3) });
    expect(container.byClass("tm-calendar-task")).toHaveLength(3);
    expect(container.byClass("tm-show-more-tasks")).toHaveLength(0);
  });
});

it("builds a year view month's task list only when it is first opened", () => {
  const tasks = scanTasks("Tasks.md", "- [ ] March 2026-03-04\n- [ ] Also March 2026-03-20\n- [ ] June 2026-06-01");
  const { container } = render({ scope: "year", anchor: "2026-01-01", tasks });
  const lists = container.all().filter(element => element.tag === "details");
  expect(lists).toHaveLength(2);
  expect(lists[0].children.find(child => child.tag === "summary")?.text).toBe("2 tasks — expand to drag");
  expect(container.byClass("tm-calendar-task")).toHaveLength(0);
  lists[0].open = true;
  lists[0].dispatchEvent(new Event("toggle"));
  expect(lists[0].byClass("tm-calendar-task")).toHaveLength(2);
  lists[0].open = false;
  lists[0].dispatchEvent(new Event("toggle"));
  lists[0].open = true;
  lists[0].dispatchEvent(new Event("toggle"));
  expect(lists[0].byClass("tm-calendar-task")).toHaveLength(2);
  expect(lists[1].byClass("tm-calendar-task")).toHaveLength(0);
});

describe("time grid", () => {
  it("opens near the current time when today is shown, unless a scroll position is restored", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 21, 10, 30));
    for (const scope of ["day", "four-day", "week"] as const) {
      const grid = render({ scope, anchor: "2026-09-21" }).container.all().find(element => element.attrs["data-tm-scroll-key"] === "calendar-grid")!;
      expect(grid.scrollTop).toBe(9.5 * 48);
    }
    const restored = render({ scope: "week", anchor: "2026-09-21", initialScrollTop: 100 }).container;
    expect(restored.all().find(element => element.attrs["data-tm-scroll-key"] === "calendar-grid")!.scrollTop).toBe(100);
    const elsewhere = render({ scope: "four-day", anchor: "2026-10-05" }).container;
    expect(elsewhere.all().find(element => element.attrs["data-tm-scroll-key"] === "calendar-grid")!.scrollTop).toBe(0);
  });

  it("gives each day one tab stop and moves between slots and days with arrow keys", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 21, 10, 40));
    const { container, options } = render({ scope: "four-day", anchor: "2026-09-20" });
    const lanes = container.byClass("tm-calendar-lane").map(lane => lane.byClass("tm-calendar-slot"));
    const stops = () => lanes.map(slots => slots.findIndex(slot => slot.attrs.tabindex === "0"));
    // Today starts at the current slot; other days at 09:00.
    expect(stops()).toEqual([36, 42, 36, 36]);
    expect(lanes.every(slots => slots.filter(slot => slot.attrs.tabindex === "0").length === 1)).toBe(true);
    key(lanes[1][42], "ArrowDown");
    expect(focused).toBe(lanes[1][43]);
    key(lanes[1][43], "ArrowRight");
    expect(focused).toBe(lanes[2][43]);
    expect(stops()).toEqual([36, 43, 43, 36]);
    key(lanes[2][43], "ArrowUp");
    expect(focused).toBe(lanes[2][42]);
    key(lanes[0][0], "ArrowUp");
    expect(focused).toBe(lanes[0][0]);
    // Past the last day, the key reaches the calendar's period navigation.
    key(lanes[3][36], "ArrowRight");
    expect(focused?.hasClass("tm-calendar")).toBe(true);
    expect(options.navigate).toHaveBeenCalledWith("2026-09-24", "four-day");
    // Enter and Space still create a task through the button's click.
    lanes[2][42].dispatchEvent(Object.assign(new Event("click"), { detail: 0 }));
    expect(options.create).toHaveBeenCalledWith(expect.objectContaining({ scheduledDate: "2026-09-22", scheduledTime: "10:30" }));
  });
});

describe("task cards", () => {
  const timed = (): Task => {
    const task = scanTasks("Tasks.md", "- [ ] Timed task 2026-09-20 09:00 ~1h")[0];
    return Object.assign(task, { scheduledDate: "2026-09-20", scheduledTime: "09:00", durationMinutes: 60 });
  };

  it("uses a title button instead of making the card a button around other controls", () => {
    const task = timed();
    const { container, options } = render({ scope: "day", tasks: [task] });
    const card = container.byClass("tm-calendar-task")[0];
    expect(card.attrs.role).toBeUndefined();
    expect(card.attrs.tabindex).toBeUndefined();
    const title = card.byClass("tm-calendar-task-title")[0];
    expect(title.tag).toBe("button");
    title.dispatchEvent(new Event("click", { bubbles: true }));
    expect(options.edit).toHaveBeenCalledExactlyOnceWith(task);
    expect(card.byClass("tm-calendar-resize-handle").every(handle => handle.attrs.role === "slider")).toBe(true);
  });

  it("previews keyboard resizing live and saves once the arrow keys pause", async () => {
    vi.useFakeTimers();
    const task = timed();
    const { container, options } = render({ scope: "day", tasks: [task] });
    const card = container.byClass("tm-calendar-task")[0];
    const end = card.byClass("is-end")[0];
    for (let i = 0; i < 3; i++) { key(end, "ArrowDown"); key(end, "ArrowDown", "keyup"); }
    expect(options.resize).not.toHaveBeenCalled();
    expect(end.attrs["aria-valuetext"]).toBe("10:45");
    expect(card.style.height).toBe(`${105 / 15 * 12}px`);
    await vi.advanceTimersByTimeAsync(500);
    expect(options.resize).toHaveBeenCalledExactlyOnceWith(task, "2026-09-20", "09:00", 105);

    // Blur saves immediately; Escape discards a pending change.
    const start = card.byClass("is-start")[0];
    await vi.advanceTimersByTimeAsync(0);
    key(start, "ArrowUp");
    start.dispatchEvent(new Event("blur"));
    expect(options.resize).toHaveBeenLastCalledWith(task, "2026-09-20", "08:45", 75);
    await vi.advanceTimersByTimeAsync(0);
    key(start, "ArrowUp");
    key(start, "Escape");
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.resize).toHaveBeenCalledTimes(2);
    expect(card.style.top).toBe(`${9 * 48}px`);
  });
});
