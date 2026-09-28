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
  toggleClass() {}
  prepend(child: Element) { this.children = [child, ...this.children.filter(el => el !== child)]; }
  empty() { this.children = []; }
  all(): Element[] { return this.children.flatMap(el => [el, ...el.all()]); }
}

// The view options panel itself is covered in view-options.test.ts.

it.each([true, false])("lists archived projects without an opt-in checkbox (active projects: %s)", hasActive => {
  const archived = { path: "Archive.md", name: "Archive", archived: true, openTasks: 0, completedTasks: 1 };
  const active = { ...archived, path: "Active.md", name: "Active", archived: false };
  const openProjectCreator = vi.fn();
  const view = new TaskMainView({} as WorkspaceLeaf, { openProjectCreator, index: { projects: () => hasActive ? [active, archived] : [archived] } } as unknown as TaskManagerPlugin);
  const internal = view as unknown as { renderProjectList(root: HTMLElement): void; renderProjectGroup(root: HTMLElement, title: string, projects: unknown[]): void };
  const groups = vi.spyOn(internal, "renderProjectGroup").mockImplementation(() => {});
  const root = new Element();
  internal.renderProjectList(root as never);
  expect(groups).toHaveBeenCalledWith(root, "Archived", [archived]);
  expect(root.all().some(el => el.tag === "label")).toBe(false);
  const create = root.all().find(el => el.attrs["aria-label"] === "Create new project")!;
  expect(create.text).toBe("");
  create.dispatchEvent(new Event("click"));
  expect(openProjectCreator).toHaveBeenCalledOnce();
});

it("starts a sectioned project at its first heading without an empty leading task list", () => {
  const view = new TaskMainView({} as WorkspaceLeaf, { settings: {}, index: { headingsForPath: () => [{ name: "Ready", line: 0 }] } } as unknown as TaskManagerPlugin);
  const internal = view as unknown as { renderProjectSections(root: HTMLElement, path: string, tasks: unknown[]): void; renderTaskList(root: HTMLElement, tasks: unknown[], target: unknown): void };
  const renderList = vi.spyOn(internal, "renderTaskList").mockImplementation(() => {});
  const root = new Element();
  internal.renderProjectSections(root as never, "Project.md", [{ sectionLine: 0 }]);
  expect(root.children[0].tag).toBe("section");
  expect(root.children[0].children[0].text).toBe("Ready");
  expect(renderList).toHaveBeenCalledOnce();
  expect(renderList.mock.calls[0][0]).toBe(root.children[0]);
});
