import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() }));
import { renderGantt } from "../src/gantt-view";
import { addDays } from "../src/calendar";
import { daysBetween } from "../src/gantt";
import { ganttSegments } from "../src/gantt";

it("groups month dates by Monday, quarter/year by month, and five years by year", () => {
  expect(ganttSegments("2026-09-07", 21, "month").map(s => [s.label, s.days])).toEqual([["Sep 7", 7], ["Sep 14", 7], ["Sep 21", 7]]);
  for (const zoom of ["quarter", "year"] as const) {
    expect(ganttSegments("2028-01-01", 91, zoom).map(s => [s.label, s.days])).toEqual([["Jan", 31], ["Feb", 29], ["Mar", 31]]);
  }
  expect(ganttSegments("2027-01-01", 731, "five-year").map(s => [s.label, s.days])).toEqual([["2027", 365], ["2028", 366]]);
  const partial = ganttSegments("2026-09-10", 10, "month");
  expect(partial.map(s => [s.label, s.offset, s.days])).toEqual([["Sep 7", 0, 4], ["Sep 14", 4, 6]]);
});

class Element extends EventTarget {
  children: Element[] = [];
  cls = ""; text = ""; attrs: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: (key: string, value: string) => void } = { setProperty: (key, value) => { this.style[key] = value; } };
  scrollLeft = 0; scrollTop = 0; clientWidth = 900; hidden = false; isConnected = true;
  get firstElementChild() { return this.children[0]; }
  get childElementCount() { return this.children.length; }
  createEl(_tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
    const child = new Element(); child.text = options.text ?? ""; child.cls = options.cls ?? ""; child.attrs = options.attr ?? {}; this.children.push(child); return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  empty() { this.children = []; }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  removeAttribute(key: string) { delete this.attrs[key]; }
  setPointerCapture(_id: number) {}
  releasePointerCapture(_id: number) {}
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
  const dayCount = Number.parseFloat(String(scroll.style["--tm-gantt-width"])) / 32;
  expect(viewportChanged).toHaveBeenLastCalledWith("2026-09-18");
  for (const direction of [1, -1]) for (let i = 0; i < 30; i++) {
    const first = dates()[0].attrs.title;
    const pixels = direction === 1 ? (dayCount - 23) * 32 : 16;
    scroll.scrollLeft = pixels;
    scroll.dispatchEvent(new Event("scroll"));
    const visible = addDays(first, Math.floor(pixels / 32));
    expect(viewportChanged).toHaveBeenLastCalledWith(visible);
    expect(addDays(dates()[0].attrs.title, Math.floor(scroll.scrollLeft / 32))).toBe(visible);
    expect(scroll.scrollLeft % 32).toBe(pixels % 32);
    expect(Math.abs(dates().length - count)).toBeLessThanOrEqual(1);
  }
});

it("repositions project bars after scrolling and retains date editing", async () => {
  const container = new Element();
  const project = { path: "Project.md", name: "Project", openTasks: 1, completedTasks: 0, archived: false, scheduledDate: "2026-09-18", endDate: "2026-09-25", deadline: "2026-10-01" };
  const update = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn();
  const viewportChanged = vi.fn();
  const edit = vi.fn();
  renderGantt(container as unknown as HTMLElement, { projects: [project], anchor: "2026-09-18", zoom: "month", dateFormat: "YYYY-MM-DD", navigate, open: vi.fn(), edit, update, viewportChanged });
  expect(container.all().some(el => el.cls === "tm-project-progress-circle")).toBe(true);
  const metadata = container.all().find(el => el.cls === "tm-project-header-metadata")!;
  expect(metadata.hidden).toBe(false);
  const deadline = metadata.all().find(el => el.attrs["aria-label"]?.startsWith("Edit project deadline:"))!;
  deadline.dispatchEvent(new Event("click"));
  expect(edit).toHaveBeenCalledWith(project, "deadline");
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
  expect(bar.text).toBe("2026-09-18 – 2026-09-25");
  expect(container.all().some(el => el.cls === "tm-gantt-deadline")).toBe(false);
  handle.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 1, clientX: 100, clientY: 100 }));
  handle.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 1, clientX: 132, clientY: 100 }));
  expect(container.all().some(el => el.cls === "tm-gantt-preview")).toBe(false);
  handle.dispatchEvent(new Event("pointercancel"));
  handle.dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowRight" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith(project, { endDate: "2026-09-26" }));
  expect(metadata.all().some(el => el.cls === "tm-project-date-range")).toBe(false);
  expect(project.endDate).toBe("2026-09-26");
  expect(project.deadline).toBe("2026-10-01");
});

it("groups active and archived projects and shows only deadlines in their labels", () => {
  const root = new Element();
  const base = { openTasks: 1, completedTasks: 0, scheduledDate: "2026-09-18", endDate: "2026-09-25", deadline: "2026-10-01", parent: "Parent.md" };
  renderGantt(root as never, { projects: [
    { ...base, name: "Old", path: "Old.md", archived: true },
    { ...base, name: "New", path: "New.md", archived: false }
  ], anchor: "2026-09-18", zoom: "month", dateFormat: "YYYY-MM-DD", navigate: vi.fn(), open: vi.fn(), update: vi.fn() });
  expect(root.all().filter(el => el.attrs.role === "heading").map(el => el.text)).toEqual(["Active", "Archived"]);
  expect(root.all().filter(el => el.cls === "tm-task-title").map(el => el.text)).toEqual(["New", "Old"]);
  for (const metadata of root.all().filter(el => el.cls === "tm-project-header-metadata")) {
    expect(metadata.children).toHaveLength(1);
    expect(metadata.children[0].cls).toContain("tm-task-due");
  }
});
