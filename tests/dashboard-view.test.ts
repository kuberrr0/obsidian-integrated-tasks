import { expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
import { renderDashboard } from "../src/dashboard-view";

class Element extends EventTarget {
  children: Element[] = [];
  tag = ""; cls = ""; text = ""; attrs: Record<string, string> = {};
  createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element();
    child.tag = tag; child.cls = options.cls ?? ""; child.text = options.text ?? ""; child.attrs = options.attr ?? {};
    this.children.push(child); return child;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}

it("renders four cards in two rows with titles outside their borders and creation actions", () => {
  const root = new Element();
  const options = { today: vi.fn(), upcoming: vi.fn(), projects: vi.fn(), calendar: vi.fn(), createTask: vi.fn(), createProject: vi.fn() };
  renderDashboard(root as unknown as HTMLElement, options);
  const rows = root.all().filter(el => el.cls.includes("tm-dashboard-row"));
  expect(rows.map(row => row.cls)).toEqual(["tm-dashboard-row tm-dashboard-tasks", "tm-dashboard-row tm-dashboard-planning"]);
  expect(rows.map(row => row.children.map(section => section.attrs["aria-label"]))).toEqual([["Today", "Upcoming"], ["Projects", "Calendar"]]);
  for (const [index, render] of [options.today, options.upcoming, options.projects, options.calendar].entries()) {
    const section = rows[Math.floor(index / 2)].children[index % 2];
    expect(section.children[0].children[0].tag).toBe("h2");
    expect(section.children[1].cls).toBe("tm-dashboard-card");
    expect(render).toHaveBeenCalledExactlyOnceWith(section.children[1]);
  }
  root.all().find(el => el.attrs["aria-label"] === "Add task to Today")!.dispatchEvent(new Event("click"));
  root.all().find(el => el.attrs["aria-label"] === "Add task to Upcoming")!.dispatchEvent(new Event("click"));
  root.all().find(el => el.attrs["aria-label"] === "Create new project")!.dispatchEvent(new Event("click"));
  expect(options.createTask.mock.calls).toEqual([["today"], ["upcoming"]]);
  expect(options.createProject).toHaveBeenCalledOnce();
});
