import { expect, it, vi } from "vitest";
import { renderPropertyFilter } from "../src/filter-editor";
class Element extends EventTarget {
  children: Element[] = []; attrs: Record<string, string> = {}; value = ""; hidden = false; text?: string; tag = "";
  validity = { valid: true };
  createEl(tag: string, options: { attr?: Record<string, string>; text?: string } = {}): Element {
    const el = new Element(); el.attrs = options.attr ?? {}; el.text = options.text; el.tag = tag; this.children.push(el); return el;
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

it("offers the five statuses, keeping an older smart list's Open so it can be cleared", () => {
  const root = new Element();
  renderPropertyFilter(root as never, { key: "status", kind: "choice", label: "Status" }, { property: "status", operator: "is", values: ["Open"] }, [], vi.fn());
  const choices = root.all().filter(el => el.tag === "span").map(el => el.text);
  expect(choices).toEqual(["To do", "In progress", "Waiting", "Done", "Cancelled", "Open"]);
});
