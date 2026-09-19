import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));
import { renderCalendar } from "../src/calendar-view";
import { scanTasks } from "../src/parser";
import { destinationLabel } from "../src/structure";

class Element extends EventTarget {
  children: Element[] = [];
  text = "";
  cls = "";
  style: Record<string, string> = {};
  bounds = { top: 0, height: 1152 };
  getBoundingClientRect() { return this.bounds; }
  addClass(cls: string) { this.cls += ` ${cls}`; }
  removeClass(cls: string) { this.cls = this.cls.replace(cls, ""); }
  hasClass(cls: string) { return this.cls.split(" ").includes(cls); }
  createSpan(options = {}) { return this.createEl("span", options); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  attrs: Record<string, string> = {};
  createEl(_tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element();
    child.text = options.text ?? "";
    child.cls = options.cls ?? "";
    child.attrs = options.attr ?? {};
    this.children.push(child);
    return child;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}

describe("calendar date navigation", () => {
  it.each(["month", "year"] as const)("opens a day from a date number in %s view without creating a task", scope => {
    const container = new Element();
    const navigate = vi.fn(); const create = vi.fn();
    renderCalendar(container as unknown as HTMLElement, {
      anchor: "2026-09-09", scope, tasks: [], dateFormat: "YYYY-MM-DD", navigate, create,
      edit: vi.fn(), move: vi.fn(), resize: vi.fn()
    });
    const date = container.all().find(element => element.attrs["aria-label"] === "Open day view for 2026-09-09")!;
    expect(date.text).toBe("9");
    date.dispatchEvent(new Event("click"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith("2026-09-09", "day");
    expect(create).not.toHaveBeenCalled();
  });
});

it("removes only the note extension from destination labels", () => {
  expect(destinationLabel("Projects/Work.MD#Notes.md")).toBe("Projects/Work#Notes.md");
  expect(destinationLabel("Folder.md/Work.md")).toBe("Folder.md/Work");
});

it.each(["day", "week"] as const)("snaps %s calendar drops to quarter hours while preserving the grab position", async scope => {
  const container = new Element();
  const task = scanTasks("Tasks.md", "- [ ] Timed task 2026-09-09 09:00 ~1h")[0];
  Object.assign(task, { scheduledDate: "2026-09-09", scheduledTime: "09:00", durationMinutes: 60 });
  const move = vi.fn().mockResolvedValue(undefined);
  renderCalendar(container as unknown as HTMLElement, {
    anchor: "2026-09-09", scope, tasks: [task], dateFormat: "YYYY-MM-DD", navigate: vi.fn(), create: vi.fn(),
    edit: vi.fn(), move, resize: vi.fn()
  });
  const lane = container.all().find(el => el.attrs["aria-label"] === "Daily schedule for 2026-09-09")!;
  const card = lane.children.find(el => el.hasClass("is-timed"))!;
  // A scaled timeline also has to retain 15-minute snapping.
  lane.bounds = { top: 100, height: 2304 };
  card.bounds = { top: 100 + 540 * 1.6, height: 96 };
  const eventAt = (type: string, y: number) => Object.assign(new Event(type), { clientY: y });
  for (const [delta, time] of [[0, "09:00"], [15, "09:15"], [45, "09:45"], [-15, "08:45"]] as const) {
    card.dispatchEvent(eventAt("dragstart", card.bounds.top + 48));
    lane.dispatchEvent(eventAt("drop", card.bounds.top + 48 + delta * 1.6));
    expect(move).toHaveBeenLastCalledWith(task, "2026-09-09", time);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
});

it("toggles the main-view planner and schedules an unscheduled task into the four-day calendar", async () => {
  const container = new Element();
  const task = scanTasks("Tasks.md", "- [ ] Plan workshop")[0];
  const move = vi.fn().mockResolvedValue(undefined), planningChanged = vi.fn(), navigate = vi.fn();
  renderCalendar(container as unknown as HTMLElement, {
    anchor: "2026-09-20", scope: "four-day", tasks: [task], dateFormat: "YYYY-MM-DD",
    planning: true, navigate, planningChanged, create: vi.fn(), edit: vi.fn(), move, resize: vi.fn()
  });
  const planner = container.all().find(el => el.cls === "tm-calendar-planner")! as Element & { hidden: boolean };
  expect(planner.hidden).toBe(true);
  const toggle = container.all().find(el => el.cls === "tm-calendar-plan-toggle")!;
  toggle.dispatchEvent(new Event("click"));
  expect(planner.hidden).toBe(false);
  expect(toggle.attrs["aria-expanded"]).toBe("true");
  expect(planningChanged).toHaveBeenCalledWith(true);
  const lanes = container.all().filter(el => el.cls === "tm-calendar-lane");
  expect(lanes).toHaveLength(4);
  expect(lanes[3].attrs["aria-label"]).toBe("Daily schedule for 2026-09-23");
  const card = planner.all().find(el => el.cls === "tm-calendar-task")!;
  card.dispatchEvent(Object.assign(new Event("dragstart"), { clientY: 0 }));
  lanes[1].dispatchEvent(Object.assign(new Event("drop"), { clientY: 432 }));
  expect(move).toHaveBeenCalledWith(task, "2026-09-21", "09:00");
  toggle.dispatchEvent(new Event("click"));
  expect(planner.hidden).toBe(true);
  container.all().find(el => el.attrs["aria-label"] === "Next period")!.dispatchEvent(new Event("click"));
  expect(navigate).toHaveBeenCalledWith("2026-09-24", "four-day");
});

it("does not add the planning sidebar to embedded calendars", () => {
  const container = new Element();
  renderCalendar(container as unknown as HTMLElement, {
    anchor: "2026-09-20", scope: "month", tasks: [], dateFormat: "YYYY-MM-DD",
    navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn()
  });
  expect(container.all().some(el => el.cls === "tm-calendar-plan-toggle")).toBe(false);
});

it("keeps today's hour boundaries aligned with other days despite the current-time marker", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 20, 2, 45));
  try {
    const container = new Element();
    renderCalendar(container as unknown as HTMLElement, {
      anchor: "2026-09-20", scope: "four-day", tasks: [], dateFormat: "YYYY-MM-DD",
      navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn()
    });
    const lanes = container.all().filter(el => el.cls === "tm-calendar-lane");
    for (const lane of lanes) {
      const slots = lane.children.filter(el => el.hasClass("tm-calendar-slot"));
      expect(slots).toHaveLength(96);
      expect(slots.flatMap((el, i) => el.hasClass("is-hour-start") ? [i] : [])).toEqual(Array.from({ length: 23 }, (_, i) => (i + 1) * 4));
    }
    const markers = container.all().filter(el => el.cls === "tm-calendar-now");
    expect(markers).toHaveLength(1);
    expect(markers[0].style.top).toBe("132px");
  } finally { vi.useRealTimers(); }
});

it("supports period and scope keys while leaving text fields alone", () => {
  const container = new Element(), navigate = vi.fn();
  renderCalendar(container as unknown as HTMLElement, { anchor: "2026-09-20", scope: "four-day", tasks: [], dateFormat: "YYYY-MM-DD", navigate, create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn() });
  const root = container.children[0];
  for (const [key, anchor, scope] of [["ArrowLeft", "2026-09-16", "four-day"], ["ArrowRight", "2026-09-24", "four-day"], ["d", "2026-09-20", "four-day"], ["w", "2026-09-20", "week"], ["m", "2026-09-20", "month"]]) {
    root.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key }));
    expect(navigate).toHaveBeenLastCalledWith(anchor, scope);
  }
  expect(navigate).toHaveBeenCalledTimes(5);
  Object.assign(root, { closest: () => ({}) });
  root.dispatchEvent(Object.assign(new Event("keydown"), { key: "m" }));
  expect(navigate).toHaveBeenCalledTimes(5);
});

it("completes a calendar task through its checkbox without opening the editor", async () => {
  const container = new Element(), toggle = vi.fn().mockResolvedValue(undefined), edit = vi.fn();
  const task = scanTasks("Tasks.md", "- [ ] Finish draft 2026-09-20")[0];
  renderCalendar(container as unknown as HTMLElement, { anchor: "2026-09-20", scope: "month", tasks: [task], dateFormat: "YYYY-MM-DD", navigate: vi.fn(), create: vi.fn(), edit, toggle, move: vi.fn(), resize: vi.fn() });
  const checkbox = container.all().find(el => el.cls === "tm-calendar-check")! as Element & { checked: boolean; disabled: boolean };
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  expect(toggle).toHaveBeenCalledWith(task, true);
  expect(edit).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(checkbox.disabled).toBe(false));
});

it("uses T to return to today without changing calendar scope", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 20, 3));
  try {
    const container = new Element(), navigate = vi.fn();
    renderCalendar(container as unknown as HTMLElement, { anchor: "2026-10-01", scope: "week", tasks: [], dateFormat: "YYYY-MM-DD", navigate, create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn() });
    container.children[0].dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "t" }));
    expect(navigate).toHaveBeenCalledWith("2026-09-20", "week");
  } finally { vi.useRealTimers(); }
});

it("shows a deadline flag only at the matching date and time", () => {
  const base = scanTasks("Tasks.md", "- [ ] Example")[0];
  const cases = [
    { scheduledDate: "2026-09-20", deadline: "2026-09-21", flag: false },
    { scheduledDate: "2026-09-20", scheduledTime: "09:00", deadline: "2026-09-20", deadlineTime: "10:00", flag: false },
    { scheduledDate: "2026-09-20", scheduledTime: "10:00", deadline: "2026-09-20", deadlineTime: "10:00", flag: true },
    { deadline: "2026-09-20", deadlineTime: "10:00", flag: true },
    { scheduledDate: "2026-09-20", deadline: "2026-09-20", flag: true }
  ];
  for (const { flag, ...dates } of cases) {
    const container = new Element();
    renderCalendar(container as unknown as HTMLElement, { anchor: "2026-09-20", scope: "month", tasks: [{ ...base, ...dates }], dateFormat: "YYYY-MM-DD", navigate: vi.fn(), create: vi.fn(), edit: vi.fn(), move: vi.fn(), resize: vi.fn() });
    expect(container.all().some(el => el.cls === "tm-calendar-task-flag")).toBe(flag);
  }
});
