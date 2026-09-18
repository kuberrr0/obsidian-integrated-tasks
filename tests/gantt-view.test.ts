import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));
import { renderGantt } from "../src/gantt-view";
import { addDays } from "../src/calendar";
import { daysBetween } from "../src/gantt";

class Element extends EventTarget {
  children: Element[] = [];
  cls = ""; text = ""; attrs: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: (key: string, value: string) => void } = { setProperty: (key, value) => { this.style[key] = value; } };
  scrollLeft = 0; scrollTop = 0; clientWidth = 900; hidden = false; isConnected = true;
  get firstElementChild() { return this.children[0]; }
  createEl(_tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
    const child = new Element(); child.text = options.text ?? ""; child.cls = options.cls ?? ""; child.attrs = options.attr ?? {}; this.children.push(child); return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  empty() { this.children = []; }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  removeAttribute(key: string) { delete this.attrs[key]; }
  addClass(cls: string) { this.cls += ` ${cls}`; }
  removeClass(cls: string) { this.cls = this.cls.replace(cls, ""); }
  getBoundingClientRect() { return { width: 220, left: 0 }; }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}

it("scrolls indefinitely in either direction with bounded date columns and stable viewport dates", () => {
  const container = new Element();
  const viewportChanged = vi.fn();
  renderGantt(container as unknown as HTMLElement, { projects: [], anchor: "2026-09-18", zoom: "month", dateFormat: "YYYY-MM-DD", navigate: vi.fn(), open: vi.fn(), update: vi.fn(), viewportChanged });
  const scroll = container.all().find(el => el.cls === "tm-gantt-scroll")!;
  const dates = () => container.all().filter(el => el.cls.split(" ").includes("tm-gantt-date"));
  const count = dates().length;
  expect(viewportChanged).toHaveBeenLastCalledWith("2026-09-18");
  for (const direction of [1, -1]) for (let i = 0; i < 30; i++) {
    const first = dates()[0].attrs.title;
    const pixels = direction === 1 ? (count - 23) * 32 : 16;
    scroll.scrollLeft = pixels;
    scroll.dispatchEvent(new Event("scroll"));
    const visible = addDays(first, Math.floor(pixels / 32));
    expect(viewportChanged).toHaveBeenLastCalledWith(visible);
    expect(addDays(dates()[0].attrs.title, Math.floor(scroll.scrollLeft / 32))).toBe(visible);
    expect(scroll.scrollLeft % 32).toBe(pixels % 32);
    expect(dates()).toHaveLength(count);
  }
});

it("repositions project bars after scrolling and retains date editing", async () => {
  const container = new Element();
  const project = { path: "Project.md", name: "Project", openTasks: 1, completedTasks: 0, archived: false, scheduledDate: "2026-09-18", endDate: "2026-09-25" };
  const update = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn();
  const viewportChanged = vi.fn();
  renderGantt(container as unknown as HTMLElement, { projects: [project], anchor: "2026-09-18", zoom: "month", dateFormat: "YYYY-MM-DD", navigate, open: vi.fn(), update, viewportChanged });
  const scroll = container.all().find(el => el.cls === "tm-gantt-scroll")!;
  const bar = container.all().find(el => el.cls === "tm-gantt-bar")!;
  scroll.scrollLeft = 0;
  scroll.dispatchEvent(new Event("scroll"));
  const first = container.all().find(el => el.cls.split(" ").includes("tm-gantt-date"))!.attrs.title;
  expect(bar.style.left).toBe(`${daysBetween(first, project.scheduledDate) * 32 + 2}px`);
  const next = container.all().find(el => el.attrs["aria-label"] === "Next period")!;
  next.dispatchEvent(new Event("click"));
  expect(navigate).toHaveBeenCalledWith(addDays(viewportChanged.mock.lastCall![0], 35), "month");
  const handle = container.all().find(el => el.cls === "tm-gantt-handle is-finish")!;
  handle.dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowRight" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith(project, { endDate: "2026-09-26" }));
});
