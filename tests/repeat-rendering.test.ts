// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderTaskDetails } from "../src/task-row-details";
import { handleRecurringTaskClick } from "../src/note-task-edit";
import { matchesFilter } from "../src/task-properties";
import { groupTasks, sortTasks } from "../src/query";
import { scanTasks } from "../src/parser";
import type { TaskGrouping, TaskProperty } from "../src/types";

beforeAll(() => {
  installObsidianDom();
  const fragment = Object.getPrototypeOf(document.createDocumentFragment()) as Record<string, unknown>;
  const patched = DocumentFragment.prototype as unknown as Record<string, unknown>;
  for (const key of ["createEl", "createDiv", "createSpan"]) fragment[key] ??= patched[key];
});
const now = new Date(2026, 8, 27, 12);

function row(line: string, options: { grouping?: TaskGrouping; show?: (property: TaskProperty) => boolean } = {}) {
  const primary = document.createElement("div"), metadata = document.createElement("div");
  const task = scanTasks("Note.md", line, now)[0];
  const edit = vi.fn();
  renderTaskDetails(primary, metadata, task, { now, grouping: options.grouping ?? "none", show: options.show, dateFormat: "MMM D, YYYY", tags: task.tags ?? [], edit, openSource: vi.fn() });
  return { primary, metadata, edit, repeat: primary.querySelector<HTMLElement>(".tm-task-repeat"), done: metadata.querySelector<HTMLElement>(".tm-task-done") };
}

describe("task row pills", () => {
  it("shows an editable repeat icon beside the title, before the deadline, with its rule in the tooltip", () => {
    const { primary, metadata, repeat, edit } = row("- [ ] Water 2026-09-28 every week {2026-10-02} #[[home]]");
    expect(Array.from(primary.children).map(child => child.className)).toEqual(["tm-task-repeat", "tm-task-due"]);
    expect(Array.from(metadata.children).map(child => child.className)).toEqual(["tm-task-schedule", "tm-task-tag"]);
    expect(repeat!.textContent).toBe("");
    expect(repeat!.getAttribute("title")).toBe("Repeats every week");
    expect(repeat!.getAttribute("data-tm-focus-key")).toBe("repeat");
    repeat!.click();
    expect(edit).toHaveBeenCalledWith("repeat");
    expect(row("- [ ] Water every week", { grouping: "repeat" }).repeat).toBeNull();
    expect(row("- [ ] Water every week", { show: property => property !== "repeat" }).repeat).toBeNull();
  });

});

describe("Reading view checkbox claims", () => {
  it("offers checked tasks to the reopen hook and open ones to the complete hook", () => {
    const click = () => ({ button: 0, target: { closest: () => ({}) }, defaultPrevented: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    const task = scanTasks("Note.md", "- [x] Pay ✓2026-09-27")[0];
    const complete = vi.fn(() => true), reopen = vi.fn(() => true);
    const event = click();
    handleRecurringTaskClick(event as unknown as MouseEvent, () => task, complete, reopen);
    expect(reopen).toHaveBeenCalledWith(task);
    expect(complete).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    const open = { ...task, completed: false };
    handleRecurringTaskClick(click() as unknown as MouseEvent, () => open, complete, reopen);
    expect(complete).toHaveBeenCalledWith(open);
  });
});

describe("repeat and completion date properties", () => {
  const tasks = scanTasks("Note.md", "- [x] A ✓2026-09-20\n- [x] B ✓2026-09-26\n- [ ] C every week\n- [x] D\n");

  it("filters completed after a date and sorts and groups by it", () => {
    expect(tasks.filter(task => matchesFilter(task, { property: "completed", operator: "after", values: ["2026-09-21"] })).map(task => task.title)).toEqual(["B"]);
    expect(sortTasks(tasks, "completed", true).map(task => task.title)).toEqual(["B", "A", "C", "D"]);
    expect([...groupTasks(tasks, "completed").keys()]).toEqual(["2026-09-20", "2026-09-26", "No completion date"]);
  });

  it("filters and groups by repeat", () => {
    expect(tasks.filter(task => matchesFilter(task, { property: "repeat", operator: "has", values: [] })).map(task => task.title)).toEqual(["C"]);
    expect([...groupTasks(tasks, "repeat").keys()]).toEqual(["No repeat", "Every week"]);
  });

});
