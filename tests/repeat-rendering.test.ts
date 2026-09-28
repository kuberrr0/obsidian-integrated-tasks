// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderTaskDetails } from "../src/task-row-details";
import { noteTaskPresentation, renderNoteTaskDetails } from "../src/note-task-presentation";
import { renderNoteTokens } from "../src/note-token-reading";
import { handleRecurringTaskClick } from "../src/note-task-edit";
import { bulkInlinePatch, bulkPropertyPatch, commonBulkValues } from "../src/bulk-task-editor";
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
  return { metadata, edit, repeat: metadata.querySelector<HTMLElement>(".tm-task-repeat"), done: metadata.querySelector<HTMLElement>(".tm-task-done") };
}

describe("task row pills", () => {
  it("shows an editable repeat pill after the schedule", () => {
    const { metadata, repeat, edit } = row("- [ ] Water 2026-09-28 every week #[[home]]");
    expect(Array.from(metadata.children).map(child => child.className)).toEqual(["tm-task-schedule", "tm-task-repeat", "tm-task-tag"]);
    expect(repeat!.textContent).toBe("Every week");
    expect(repeat!.getAttribute("data-tm-focus-key")).toBe("repeat");
    repeat!.click();
    expect(edit).toHaveBeenCalledWith("repeat");
    expect(row("- [ ] Water every week", { grouping: "repeat" }).repeat).toBeNull();
    expect(row("- [ ] Water every week", { show: property => property !== "repeat" }).repeat).toBeNull();
  });

  it("shows a muted Done pill only on completed tasks", () => {
    const { done } = row("- [x] Pay rent ✓2026-09-27");
    expect(done!.textContent).toBe("Done Sep 27");
    expect(done!.getAttribute("title")).toBe("Completed Sep 27, 2026");
    expect(row("- [x] Pay rent ✅ 2025-12-30").done!.textContent).toBe("Done Dec 30, 2025");
    expect(row("- [ ] Pay rent ✓2026-09-27").done).toBeNull();
    expect(row("- [x] Pay rent ✓2026-09-27", { grouping: "completed" }).done).toBeNull();
  });
});

describe("note pills", () => {
  const render = (source: string) => {
    const root = document.createElement("span");
    renderNoteTaskDetails(root, noteTaskPresentation(source, "YYYY-MM-DD", now)!, () => undefined);
    return root;
  };

  it("renders the repeat after the schedule and the completion date last", () => {
    const root = render("- [x] Water 2026-09-28 every week #[[home]] ✓2026-09-27");
    expect(Array.from(root.children).map(child => child.className)).toEqual(["tm-note-task-scheduledDate", "tm-note-task-repeat", "tm-note-task-tags", "tm-note-task-completedDate"]);
    expect(root.children[1].textContent).toBe("Every week");
    expect(root.children[1].getAttribute("style")).toContain("--tm-note-token-icon");
    expect(root.children[3].textContent).toBe("Done Sep 27");
  });

  it("wraps both in Reading view", () => {
    const root = document.createElement("div");
    root.innerHTML = `<ul><li class="task-list-item" data-task="x"><input type="checkbox">Meet every Monday ✓2026-09-27</li></ul>`;
    renderNoteTokens(root, "YYYY-MM-DD");
    expect(root.querySelector("li")!.textContent).toBe("Meet Every MondayDone Sep 27");
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

  it("edits the repeat in the bulk editor", () => {
    expect(bulkInlinePatch("every 2 weeks", "", "YYYY-MM-DD", "Inbox.md")).toEqual({ repeat: "every 2 weeks" });
    expect(bulkInlinePatch("", "every week", "YYYY-MM-DD", "Inbox.md")).toEqual({ repeat: undefined });
    expect(() => bulkInlinePatch("every time", "", "YYYY-MM-DD", "Inbox.md")).toThrow(/task property syntax/);
    expect(bulkPropertyPatch({ repeat: "Monday" }, "YYYY-MM-DD")).toEqual({ repeat: "every monday" });
    expect(bulkPropertyPatch({ repeat: "" }, "YYYY-MM-DD")).toEqual({ repeat: undefined });
    expect(() => bulkPropertyPatch({ repeat: "sometimes" }, "YYYY-MM-DD")).toThrow(/every week/);
    expect(commonBulkValues([tasks[2]], "YYYY-MM-DD").repeat).toBe("every week");
  });
});
