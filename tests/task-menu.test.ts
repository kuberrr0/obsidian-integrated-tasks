// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { openTagsPopover, openTaskMenu, type TaskMenuOptions } from "../src/task-menu";
import { duplicateTaskBlocks } from "../src/task-block";
import { scanTasks } from "../src/parser";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.empty(); });

function menu(overrides: Partial<TaskMenuOptions> = {}) {
  const calls = {
    complete: vi.fn(), schedule: vi.fn(), pickDate: vi.fn(), setPriority: vi.fn(), duplicate: vi.fn(), delete: vi.fn(),
    project: vi.fn(), deadline: vi.fn()
  };
  const row = document.body.createDiv({ attr: { tabindex: "0" } });
  const handle = openTaskMenu({
    doc: document, at: { x: 10, y: 10 }, today: "2026-09-29", completed: false, returnFocus: row,
    complete: calls.complete, schedule: calls.schedule, pickDate: calls.pickDate, setPriority: calls.setPriority,
    duplicate: calls.duplicate, delete: calls.delete,
    submenus: [{ label: "Project", icon: "folder-input", key: "g", open: calls.project }, { label: "Deadline", icon: "flag", key: "D", open: calls.deadline }],
    ...overrides
  });
  const button = (label: string) => Array.from(handle.element.querySelectorAll<HTMLElement>("button"))
    .find(item => item.getAttribute("aria-label") === label || item.querySelector(".tm-task-menu-label")?.textContent === label)!;
  const key = (name: string, shiftKey = false) => (document.activeElement ?? handle.element).dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }));
  return { handle, calls, button, key, row };
}

describe("task menu", () => {
  it("lists Complete, the date and priority rows, the submenus with their keys, Duplicate and Delete", () => {
    const { handle } = menu();
    const labels = Array.from(handle.element.querySelectorAll("button")).map(item => item.getAttribute("aria-label") ?? item.querySelector(".tm-task-menu-label")?.textContent);
    expect(labels).toEqual(["Complete", "Today", "Tomorrow", "Next week", "Pick a date", "P1", "P2", "P3", "Project", "Deadline", "Duplicate", "Delete"]);
    expect(Array.from(handle.element.querySelectorAll(".tm-task-menu-shortcut")).map(item => item.textContent)).toEqual(["D", "P", "G", "⇧D"]);
    expect(document.activeElement?.textContent).toBe("Complete");
  });

  it("applies a date or priority and closes, returning focus to the row", () => {
    const { handle, calls, button, row } = menu();
    button("Next week").click();
    expect(calls.schedule).toHaveBeenCalledExactlyOnceWith("2026-10-05");
    expect(handle.element.isConnected).toBe(false);
    expect(document.activeElement).toBe(row);
    const again = menu({ priority: 2, scheduled: "2026-09-29" });
    expect(again.button("Today").classList.contains("is-active")).toBe(true);
    // Choosing the priority the tasks already have takes it off.
    again.button("Remove P2").click();
    expect(again.calls.setPriority).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("offers Reopen for completed tasks", () => {
    const { button, calls } = menu({ completed: true });
    button("Reopen").click();
    expect(calls.complete).toHaveBeenCalledOnce();
  });

  it("keeps the menu open while a submenu or the date picker opens beside it", () => {
    const { handle, calls, button } = menu();
    button("Project").click();
    expect(calls.project).toHaveBeenCalledExactlyOnceWith(button("Project"));
    button("Pick a date").click();
    expect(calls.pickDate).toHaveBeenCalledExactlyOnceWith(button("Pick a date"));
    expect(handle.element.isConnected).toBe(true);
  });

  it("opens rows by their letters, moves with the arrows, and closes on Escape", () => {
    const { handle, calls, button, key } = menu();
    key("g");
    expect(calls.project).toHaveBeenCalledOnce();
    key("D", true);
    expect(calls.deadline).toHaveBeenCalledOnce();
    key("d");
    expect(calls.pickDate).toHaveBeenCalledOnce();
    key("p");
    expect(document.activeElement).toBe(button("P1"));
    key("ArrowRight");
    expect(document.activeElement).toBe(button("P2"));
    key("ArrowDown");
    expect(document.activeElement).toBe(button("P3"));
    key("Escape");
    expect(handle.element.isConnected).toBe(false);
  });

  it("closes on a click outside, but not in a popover it opened", () => {
    const { handle } = menu();
    const submenu = document.body.createDiv({ cls: "tm-choice-popover" });
    submenu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(handle.element.isConnected).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(handle.element.isConnected).toBe(false);
  });

  it("opens one menu at a time", () => {
    const first = menu();
    const second = menu();
    expect(first.handle.element.isConnected).toBe(false);
    expect(second.handle.element.isConnected).toBe(true);
  });
});

describe("tags popover", () => {
  function tags() {
    const anchor = document.body.createEl("button");
    const toggle = vi.fn(), add = vi.fn();
    const handle = openTagsPopover({ anchor, toggle, add, tags: [{ name: "work", state: "all" }, { name: "open house", state: "some" }, { name: "home", state: "none" }] });
    const option = (name: string) => Array.from(handle.element.querySelectorAll<HTMLElement>("[role=option]")).find(item => item.getAttribute("data-value") === name);
    const input = handle.element.querySelector<HTMLInputElement>("input")!;
    return { handle, toggle, add, option, input };
  }

  it("checks tags every task has, and toggles on for a partial or missing tag", () => {
    const { toggle, option } = tags();
    expect(option("work")!.getAttribute("aria-selected")).toBe("true");
    expect(option("open house")!.getAttribute("aria-selected")).toBe("false");
    option("open house")!.click();
    expect(toggle).toHaveBeenLastCalledWith("open house", true);
    expect(option("open house")!.getAttribute("aria-selected")).toBe("true");
    option("work")!.click();
    expect(toggle).toHaveBeenLastCalledWith("work", false);
  });

  it("filters as you type and adds comma-separated tags on Enter, spaces kept", () => {
    const { add, option, input, handle } = tags();
    input.value = "ho";
    input.dispatchEvent(new Event("input"));
    expect(option("work")).toBeUndefined();
    expect(option("home")).toBeDefined();
    input.value = "#errands, client notes";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(add).toHaveBeenCalledExactlyOnceWith(["errands", "client notes"]);
    expect(input.value).toBe("");
    expect(option("client notes")!.getAttribute("aria-selected")).toBe("true");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(handle.element.isConnected).toBe(false);
  });
});

describe("duplicating tasks", () => {
  it("copies each task with its notes and subtasks right below it, dropping block ids", () => {
    const content = "# Plan\n- [ ] A ^a1\n  - Notes\n  - [ ] A child\n- [ ] B\n- [x] C";
    const tasks = scanTasks("Work.md", content);
    const [a, child, b] = tasks;
    expect(duplicateTaskBlocks(content, [a, b])).toBe("# Plan\n- [ ] A ^a1\n  - Notes\n  - [ ] A child\n- [ ] A\n  - Notes\n  - [ ] A child\n- [ ] B\n- [ ] B\n- [x] C");
    // A subtask selected with its parent is copied once, inside the parent's copy.
    expect(duplicateTaskBlocks(content, [child, a])).toBe(duplicateTaskBlocks(content, [a]));
  });
});
