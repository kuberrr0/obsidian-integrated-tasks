import { expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {} }));
import { ProjectCreatorModal, projectNoteContent, type ProjectDraft } from "../src/project-creator";
import { parseProjectParent, parseProjectProperties } from "../src/project-properties";
const blank: ProjectDraft = { name: "Launch", date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "project", archived: false };
const properties = (text: string): Record<string, unknown> => Object.fromEntries(text.split("\n").slice(1, -2).map(line => {
  const split = line.indexOf(": ");
  return [line.slice(0, split), JSON.parse(line.slice(split + 2))];
}));
it.each([true, false])("saves all project properties with linked dates: %s", links => {
  const result = properties(projectNoteContent({ ...blank, date: "tomorrow", endDate: "20.09.2026", deadline: "2026-09-21", priority: "2", parent: "Projects/Studio.md", tags: "#project, work, work", archived: true }, "DD.MM.YYYY", links, new Date(2026, 8, 16)));
  expect(result.tags).toEqual(["project", "work", "archived"]);
  expect(result.date).toBe(links ? "[[17.09.2026]]" : "17.09.2026");
  expect(parseProjectProperties(result, "DD.MM.YYYY")).toEqual({ scheduledDate: "2026-09-17", endDate: "2026-09-20", deadline: "2026-09-21", priority: 2 });
  expect(parseProjectParent(result)).toBe("Projects/Studio");
});
it("retains editable empty properties and the required project tag", () => {
  expect(properties(projectNoteContent({ ...blank, tags: "" }, "YYYY-MM-DD", false))).toEqual({ tags: ["project"], date: null, "end date": null, deadline: null, priority: null, parent: null });
});
it.each([{ date: "not a date" }, { endDate: "garbage" }, { deadline: "garbage" }, { priority: "4" }, { parent: "Launch.md" }, { name: "../Launch" }])("rejects invalid draft %j before writing", patch => {
  expect(() => projectNoteContent({ ...blank, ...patch }, "YYYY-MM-DD", false)).toThrow();
});

class Element extends EventTarget {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  text = ""; value = ""; checked = false; disabled = false;
  ownerDocument = { defaultView: null };
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
it("shows all fields, retains invalid input, and submits the complete draft", async () => {
  const createProject = vi.fn().mockResolvedValue(undefined);
  const modal = new ProjectCreatorModal({} as App, { projects: [], dateFormat: "YYYY-MM-DD", linkDates: false, createProject });
  const view = modal as unknown as { contentEl: Element; modalEl: Element; close: () => void };
  view.contentEl = new Element(); view.modalEl = new Element(); view.close = vi.fn();
  modal.onOpen();
  const fields = view.contentEl.all().filter(el => el.attrs["aria-label"]);
  expect(fields.map(el => el.attrs["aria-label"])).toEqual(["Project name", "Start date", "End date", "Deadline", "Priority", "Parent project", "Tags", "Archived"]);
  fields[0].value = "Launch"; fields[1].value = "garbage";
  const button = view.modalEl.all().find(el => el.text === "Create project")!;
  button.dispatchEvent(new Event("click"));
  expect(createProject).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  expect(fields[1].value).toBe("garbage");
  fields[1].value = "2026-09-17"; fields[4].value = "1";
  button.dispatchEvent(new Event("click"));
  await vi.waitFor(() => expect(view.close).toHaveBeenCalledOnce());
  expect(createProject).toHaveBeenCalledExactlyOnceWith({ ...blank, date: "2026-09-17", priority: "1" });
});
