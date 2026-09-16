import { expect, it, vi } from "vitest";
import { renderPropertyFilter } from "../src/filter-editor";
class Element extends EventTarget {
  children: Element[] = []; attrs: Record<string, string> = {}; value = ""; hidden = false;
  validity = { valid: true };
  createEl(_tag: string, options: { attr?: Record<string, string> } = {}): Element {
    const el = new Element(); el.attrs = options.attr ?? {}; this.children.push(el); return el;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  createSpan(options = {}): Element { return this.createEl("span", options); }
  empty(): void { this.children = []; }
  all(): Element[] { return this.children.flatMap(el => [el, ...el.all()]); }
}
it("offers inline connectors after a value and applies only completed conditions", () => {
  const root = new Element(); const change = vi.fn();
  renderPropertyFilter(root as never, { key: "title", kind: "text", label: "Title" }, undefined, [], change);
  const find = (label: string) => root.all().find(el => el.attrs["aria-label"] === label)!;
  const set = (label: string, value: string, event = "change") => { const el = find(label); el.value = value; el.dispatchEvent(new Event(event)); };
  expect(find("Add Title condition").hidden).toBe(true);
  set("Title condition", "contains");
  expect(find("Add Title condition").hidden).toBe(true);
  set("Title value", "write", "input");
  expect(find("Add Title condition").hidden).toBe(false);
  set("Add Title condition", "and");
  expect(root.children).toHaveLength(2);
  expect(change).toHaveBeenLastCalledWith({ property: "title", operator: "contains", values: ["write"] });
  set("Title condition 2", "contains");
  set("Title value 2", "report", "input");
  expect(change).toHaveBeenLastCalledWith({ property: "title", operator: "contains", values: ["write"], conditions: [{ join: "and", operator: "contains", values: ["report"] }] });
  set("Title connector 1", "or");
  expect(change.mock.lastCall![0].conditions[0].join).toBe("or");
  set("Title value", "", "input");
  expect(change).toHaveBeenLastCalledWith(undefined);
  expect(root.children[1].all().find(el => el.attrs["aria-label"] === "Add Title condition")!.hidden).toBe(true);
  set("Title value", "write", "input");
  find("Remove Title condition 2").dispatchEvent(new Event("click"));
  expect(change).toHaveBeenLastCalledWith({ property: "title", operator: "contains", values: ["write"] });
});
