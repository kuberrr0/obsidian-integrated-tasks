// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));

import { scanTasks } from "../src/parser";
import { filterSummary, ViewOptionsPanel, type ViewOptionsState } from "../src/view-options";
import { TASK_PROPERTIES } from "../src/task-properties";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.innerHTML = ""; });

function setup(initial: Partial<ViewOptionsState> = {}) {
  const state: ViewOptionsState = { sort: "date", descending: false, grouping: "default", filters: [], ...initial };
  let open = false;
  const tasks = scanTasks("Projects/Site.md", "# Build\n- [/] Page p1 #[[web]]\n- [ ] Copy #[[design]]", new Date());
  const header = document.body.createDiv({ cls: "tm-view-header" });
  const toggle = header.createEl("button", { cls: "tm-filter-toggle" });
  const update = vi.fn((change: Partial<ViewOptionsState>) => Object.assign(state, change));
  const clear = vi.fn(() => Object.assign(state, { sort: "date", descending: false, grouping: "default", filters: [] }));
  const panel = new ViewOptionsPanel(header, toggle, { state: () => state, update, clear, tasks: () => tasks, expanded: () => open, setExpanded: value => { open = value; } });
  const select = (key: string) => panel.panel.querySelector<HTMLButtonElement>(`[data-tm-focus-key="option-${key}"]`)!;
  const options = () => Array.from(panel.panel.querySelectorAll<HTMLElement>(".tm-options-dropdown [role=option]"));
  const option = (label: string) => options().find(item => item.textContent === label)!;
  const key = (target: EventTarget, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  return { state, panel, toggle, update, clear, select, options, option, key, header };
}

describe("view options panel", () => {
  it("opens from its button, focuses the first control, and closes on Escape or an outside click", () => {
    const { panel, toggle, select, key } = setup();
    expect(panel.panel.hidden).toBe(true);
    toggle.click();
    expect(panel.panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("is-active")).toBe(true);
    expect(document.activeElement).toBe(select("sort"));
    key(select("sort"), "Escape");
    expect(panel.panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    const outside = document.body.createDiv();
    outside.addEventListener("pointerdown", event => panel.handleOutside(event));
    select("group").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(panel.panel.hidden).toBe(false);
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(panel.panel.hidden).toBe(true);
  });

  it("shows how many filters are active on its button", () => {
    const { toggle } = setup({ filters: [{ property: "priority", operator: "is", values: ["1"] }, { property: "tags", operator: "has", values: [] }] });
    expect(toggle.querySelector(".tm-options-badge")!.textContent).toBe("2");
    expect(toggle.getAttribute("aria-label")).toBe("View options: filter, sort, and group (2 active filters)");
  });

  it("chooses a sort from a keyboard-driven list with a checkmark, and flips its direction", () => {
    const { select, options, key, update, panel } = setup();
    select("sort").click();
    const list = panel.panel.querySelector("[role=listbox]")!;
    expect(list.getAttribute("aria-label")).toBe("Sort");
    expect(options().find(item => item.getAttribute("aria-selected") === "true")!.textContent).toBe("Action date");
    expect(document.activeElement!.textContent).toBe("Action date");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "Enter");
    expect(update).toHaveBeenLastCalledWith({ sort: "priority" });
    expect(panel.panel.querySelector("[role=listbox]")).toBeNull();
    expect(document.activeElement).toBe(select("sort"));
    expect(select("sort").textContent).toBe("Priority");
    const direction = panel.panel.querySelector<HTMLButtonElement>(".tm-options-direction")!;
    direction.click();
    expect(update).toHaveBeenLastCalledWith({ descending: true });
    expect(direction.getAttribute("aria-pressed")).toBe("true");
  });

  it("groups, and clears everything", () => {
    const { select, option, update, panel, clear } = setup({ filters: [{ property: "priority", operator: "is", values: ["1"] }] });
    select("group").click();
    option("Tags").click();
    expect(update).toHaveBeenLastCalledWith({ grouping: "tags" });
    const clearAll = panel.panel.querySelector<HTMLButtonElement>(".tm-options-clear")!;
    expect(clearAll.disabled).toBe(false);
    clearAll.click();
    expect(clear).toHaveBeenCalledOnce();
    expect(clearAll.disabled).toBe(true);
  });

  it("filters statuses, priorities and tags by picking several values, keeping the list open", () => {
    const { select, option, state, panel } = setup();
    select("status").click();
    option("In progress").click();
    option("Waiting").click();
    expect(state.filters).toEqual([{ property: "status", operator: "is", values: ["In progress", "Waiting"] }]);
    expect(panel.panel.querySelector("[role=listbox]")!.getAttribute("aria-multiselectable")).toBe("true");
    expect(select("status").textContent).toBe("In progress, Waiting");
    option("Any").click();
    expect(state.filters).toEqual([]);
    select("tags").click();
    expect(Array.from(panel.panel.querySelectorAll("[role=option]")).map(item => item.textContent)).toEqual(["Any", "design", "web", "More conditions…"]);
    option("web").click();
    expect(state.filters).toEqual([{ property: "tags", operator: "is", values: ["web"] }]);
  });

  it("offers date and duration presets that stay relative to today", () => {
    const { select, option, state } = setup();
    select("deadline").click();
    option("Next 7 days").click();
    expect(state.filters).toEqual([{ property: "deadline", operator: "between", values: ["today", "today+7"] }]);
    expect(select("deadline").textContent).toBe("Next 7 days");
    select("duration").click();
    option("Under 30m").click();
    expect(state.filters[1]).toEqual({ property: "duration", operator: "before", values: ["30"] });
    select("defer").click();
    option("Someday").click();
    expect(state.filters[2]).toEqual({ property: "defer", operator: "is", values: ["Someday"] });
  });

  it("filters titles by text and opens the detailed editor for other conditions", () => {
    const { select, option, state, panel } = setup({ filters: [{ property: "priority", operator: "isNot", values: ["1"] }] });
    select("title").click();
    const input = panel.panel.querySelector<HTMLInputElement>(".tm-options-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "launch";
    input.dispatchEvent(new Event("input"));
    expect(state.filters[1]).toEqual({ property: "title", operator: "contains", values: ["launch"] });
    option("More conditions…").click();
    expect(panel.panel.querySelector(".tm-options-conditions-header")!.textContent).toBe("Title conditions");
    // A filter the quick list can't show opens straight into the detailed editor.
    expect(select("priority").textContent).toBe("Not P1");
    select("priority").click();
    expect(panel.panel.querySelector("[role=listbox]")).toBeNull();
    expect(Array.from(panel.panel.querySelectorAll(".tm-options-conditions-header")).map(item => item.textContent)).toContain("Priority conditions");
  });
});

it("summarises filters in a few words", () => {
  const property = (key: string) => TASK_PROPERTIES.find(item => item.key === key)!;
  expect(filterSummary(property("priority"), undefined)).toBe("Any");
  expect(filterSummary(property("priority"), { property: "priority", operator: "is", values: ["1", "2"] })).toBe("P1, P2");
  expect(filterSummary(property("source"), { property: "source", operator: "is", values: ["A.md", "B.md", "Projects/C.md"] })).toBe("3 notes");
  expect(filterSummary(property("deadline"), { property: "deadline", operator: "before", values: ["today"] })).toBe("Overdue");
  expect(filterSummary(property("deadline"), { property: "deadline", operator: "after", values: ["today+3"] })).toBe("After in 3 days");
  expect(filterSummary(property("tags"), { property: "tags", operator: "is", values: ["a"], conditions: [{ join: "or", operator: "is", values: ["b"] }] })).toBe("2 conditions");
});
