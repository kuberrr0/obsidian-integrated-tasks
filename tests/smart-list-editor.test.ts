import { expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {} }));
import { SmartListEditorModal, type SmartListDraft } from "../src/smart-list-editor";
import type { SmartList } from "../src/types";
class Element extends EventTarget {
  children: Element[] = []; attrs: Record<string, string> = {}; text = ""; value = ""; hidden = false; disabled = false;
  validity = { valid: true }; ownerDocument = { defaultView: null };
  onkeydown?: (event: KeyboardEvent) => void;
  createEl(_tag: string, options: { text?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element(); child.text = options.text ?? ""; child.attrs = options.attr ?? {}; this.children.push(child); return child;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  createSpan(options = {}): Element { return this.createEl("span", options); }
  empty(): void { this.children = []; }
  addClass(): void {}
  setAttribute(key: string, value: string): void { this.attrs[key] = value; }
  setText(text: string): void { this.text = text; }
  focus(): void {}
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
}
function open(list?: SmartList) {
  const save = vi.fn(async (_draft: SmartListDraft) => {});
  const modal = new SmartListEditorModal({} as App, [], save, list);
  const view = modal as unknown as { contentEl: Element; modalEl: Element; close: () => void };
  view.contentEl = new Element(); view.modalEl = new Element(); view.close = vi.fn();
  modal.onOpen();
  const field = (label: string) => view.contentEl.all().find(el => el.attrs["aria-label"] === label)!;
  const button = (label: string) => view.modalEl.all().find(el => el.text === label)!;
  return { save, view, field, button };
}
it("creates a definition from name, filters, sorting and grouping", async () => {
  const { save, view, field, button } = open();
  button("Save smart list").dispatchEvent(new Event("click"));
  expect(save).not.toHaveBeenCalled();
  field("List name").value = "  Work  ";
  field("Sort by").value = "priority"; field("Sort direction").value = "descending"; field("Group by").value = "source";
  field("Title condition").value = "contains"; field("Title condition").dispatchEvent(new Event("change"));
  field("Title value").value = "report"; field("Title value").dispatchEvent(new Event("input"));
  button("Save smart list").dispatchEvent(new Event("click"));
  await vi.waitFor(() => expect(view.close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledExactlyOnceWith({ name: "Work", sort: "priority", descending: true, grouping: "source", filters: [{ property: "title", operator: "contains", values: ["report"] }] });
});
it("prefills an existing list and cancels without changing its saved filters", () => {
  const list: SmartList = { id: "one", name: "Saved", sort: "deadline", descending: false, grouping: "tags", filters: [{ property: "tags", operator: "is", values: ["work"], conditions: [{ join: "or", operator: "is", values: ["home"] }] }] };
  const { save, field, button } = open(list);
  expect(field("List name").value).toBe("Saved");
  expect(field("Sort by").value).toBe("deadline");
  expect(field("Group by").value).toBe("tags");
  expect(field("Tags value 2").value).toBe("home");
  field("Tags value").value = "edited"; field("Tags value").dispatchEvent(new Event("input"));
  button("Cancel").dispatchEvent(new Event("click"));
  expect(save).not.toHaveBeenCalled();
  expect(list.filters[0].values).toEqual(["work"]);
});
