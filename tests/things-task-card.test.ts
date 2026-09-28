// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { cardNotes, renderThingsTaskCard, type TaskCardOptions } from "../src/things-task-card";
import { descriptionLines } from "../src/task-description";
import { scanTasks } from "../src/parser";

beforeAll(() => {
  installObsidianDom();
  const fragment = Object.getPrototypeOf(document.createDocumentFragment()) as Record<string, unknown>;
  const patched = DocumentFragment.prototype as unknown as Record<string, unknown>;
  for (const key of ["createEl", "createDiv", "createSpan"]) fragment[key] ??= patched[key];
});
// Saturday, Sep 19 2026.
const now = new Date(2026, 8, 19, 12);

function card(markdown: string, overrides: Partial<TaskCardOptions> = {}) {
  const [task, ...rest] = scanTasks("Note.md", markdown, now);
  const parent = document.body.createDiv();
  const options: TaskCardOptions = {
    task, depth: 0, now, tags: task.tags ?? [], children: rest.filter(child => child.parentId === task.id),
    draft: { title: task.title, notes: cardNotes(task.description) },
    change: vi.fn(), toggle: vi.fn(), edit: vi.fn(), collapse: vi.fn(), ...overrides
  };
  const element = renderThingsTaskCard(parent, options);
  return { element, options, task };
}

describe("card notes", () => {
  it("shows top-level bullets as plain lines and saves them back as bullets", () => {
    expect(cardNotes("- First\n- Second\n  - Nested\n- [ ] A checkbox line")).toBe("First\nSecond\n  - Nested\n- [ ] A checkbox line");
    expect(descriptionLines(cardNotes("- First\n- Second"), 0)).toEqual(descriptionLines("- First\n- Second", 0));
  });
});

describe("Things task card", () => {
  it("shows each subtask's properties as its row would", () => {
    const edit = vi.fn();
    const { element } = card("- [ ] Task 1\n  - [ ] Subtask 2026-09-19 {2026-09-30} #[[Errand]]", {
      childDetails: () => ({ grouping: "none", dateFormat: "MMM D, YYYY", tags: ["Errand"], now, edit, openSource: vi.fn() })
    });
    const item = element.querySelector<HTMLElement>(".tm-things-card-check")!;
    expect(Array.from(item.children).map(child => child.className)).toEqual(
      ["tm-things-card-check-box", "tm-things-lead", "tm-things-card-check-title", "tm-things-tag", "tm-things-deadline"]);
    expect(item.querySelector(".tm-things-lead .tm-things-today")).not.toBeNull();
    item.querySelector<HTMLElement>(".tm-things-deadline")!.click();
    expect(edit).toHaveBeenCalledWith("deadline");
  });

  it("edits title and notes in place and lists subtasks as a checklist", () => {
    const { element, options } = card("- [ ] Task 1 2026-09-19 {2026-09-30} #[[Errand]] #[[Office]]\n  - Some notes\n  - [ ] Subtask\n  - [x] Another subtask");
    const title = element.querySelector<HTMLInputElement>(".tm-things-card-title")!;
    const notes = element.querySelector<HTMLTextAreaElement>(".tm-things-card-notes")!;
    expect(title.value).toBe("Task 1");
    expect(notes.value).toBe("Some notes");
    expect(Array.from(element.querySelectorAll(".tm-things-card-check-title")).map(item => item.textContent)).toEqual(["Subtask", "Another subtask"]);
    title.value = "Task one";
    title.dispatchEvent(new Event("input"));
    expect(options.change).toHaveBeenLastCalledWith({ title: "Task one", notes: "Some notes" });
    element.querySelectorAll<HTMLInputElement>(".tm-things-card-check-box")[0].click();
    expect(options.toggle).toHaveBeenCalledWith(options.children[0], true);
  });

  it("shows set properties as lines that open their editor, and offers the rest in the toolbar", () => {
    const { element, options } = card("- [ ] Task 1 2026-09-19 {2026-09-30} #[[Errand]]");
    expect(Array.from(element.querySelectorAll(".tm-things-card-tag")).map(tag => tag.textContent)).toEqual(["Errand"]);
    const lines = Array.from(element.querySelectorAll<HTMLElement>(".tm-things-card-property"));
    expect(lines.map(line => line.textContent)).toEqual(["Today", "Deadline: Wed, Sep 3011 days left"]);
    lines[1].click();
    expect(options.edit).toHaveBeenCalledWith("deadline");
    expect(Array.from(element.querySelectorAll(".tm-things-card-toolbar button")).map(button => button.getAttribute("aria-label"))).toEqual(["Repeat"]);
  });

  it("closes on Escape or Mod+Enter and moves from the title to the notes on Enter", () => {
    const { element, options } = card("- [ ] Task 1");
    const title = element.querySelector<HTMLInputElement>(".tm-things-card-title")!;
    const notes = element.querySelector<HTMLTextAreaElement>(".tm-things-card-notes")!;
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(element.ownerDocument.activeElement).toBe(notes);
    notes.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    notes.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(options.collapse).toHaveBeenCalledTimes(2);
  });
});
