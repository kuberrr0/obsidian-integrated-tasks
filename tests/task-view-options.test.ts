import { expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import type TaskManagerPlugin from "../src/main";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), ItemView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn() }));
import { TaskMainView } from "../src/task-view";

class Element extends EventTarget {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  tag = ""; text = ""; value = ""; hidden = false;
  validity = { valid: true };
  focus = vi.fn();
  createEl(tag: string, options: { attr?: Record<string, string>; text?: string; value?: string } = {}): Element {
    const el = new Element(); el.tag = tag; el.attrs = options.attr ?? {}; el.text = options.text ?? ""; el.value = options.value ?? "";
    this.children.push(el); return el;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  setText(text: string) { this.text = text; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  empty() { this.children = []; }
  all(): Element[] { return this.children.flatMap(el => [el, ...el.all()]); }
}

it("keeps sorting, grouping, and filters behind one toggle and applies each control", () => {
  const view = new TaskMainView({} as WorkspaceLeaf, { index: { allTasks: () => [] } } as unknown as TaskManagerPlugin);
  const internal = view as unknown as { renderFilters(root: HTMLElement): void; renderTaskResults(): void; sort: string; descending: boolean; grouping: string; propertyFilters: unknown[] };
  const render = vi.spyOn(internal, "renderTaskResults").mockImplementation(() => {});
  const root = new Element();
  internal.renderFilters(root as never);
  const toolbar = root.children[0];
  const toggle = toolbar.children.find(el => el.tag === "button")!;
  const panel = toolbar.children.find(el => el.tag === "div")!;
  expect(toolbar.children.filter(el => el.tag === "button")).toHaveLength(1);
  expect(toggle.text).toBe("");
  expect(toggle.attrs["aria-label"]).toBe("View options: filter, sort, and group");
  expect(panel.hidden).toBe(true);
  toggle.dispatchEvent(new Event("click"));
  expect(panel.hidden).toBe(false);
  const control = (label: string) => panel.all().find(el => el.attrs["aria-label"] === label)!;
  const change = (label: string, value: string, event = "change") => {
    const el = control(label); el.value = value; el.dispatchEvent(new Event(event));
  };
  change("Sort by", "priority");
  change("Sort direction", "descending");
  change("Group by", "tags");
  expect(internal).toMatchObject({ sort: "priority", descending: true, grouping: "tags" });
  expect(render).toHaveBeenCalledTimes(3);
  change("Title condition", "contains");
  change("Title value", "launch", "input");
  expect(internal.propertyFilters).toEqual([{ property: "title", operator: "contains", values: ["launch"] }]);
  expect(toggle.attrs["aria-label"]).toBe("View options: filter, sort, and group (1 active filters)");
  panel.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  expect(panel.hidden).toBe(true);
  expect(toggle.focus).toHaveBeenCalledOnce();
});
