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
