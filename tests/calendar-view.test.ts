import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));
import { renderCalendar } from "../src/calendar-view";
import { destinationLabel } from "../src/structure";

class Element extends EventTarget {
  children: Element[] = [];
  text = "";
  attrs: Record<string, string> = {};
  createEl(_tag: string, options: { text?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element();
    child.text = options.text ?? "";
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
