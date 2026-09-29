// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { openChoicePopover, PRIORITY_CHOICES, type ChoiceInput } from "../src/choice-popover";
import { parseRepeatInput } from "../src/parser";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.empty(); });

function priority(selected?: string) {
  const anchor = document.body.createSpan({ text: "High priority" });
  const choose = vi.fn();
  const handle = openChoicePopover({ anchor, label: "Priority", choices: PRIORITY_CHOICES, selected, choose });
  const options = () => Array.from(handle.element.querySelectorAll<HTMLElement>("[role=option]"));
  const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  return { handle, choose, options, key, anchor };
}

describe("priority popover", () => {
  it("lists P1–P3 and No priority below a separator, checking and focusing the current one", () => {
    const { handle, options } = priority("2");
    expect(options().map(option => option.textContent)).toEqual(["P1High", "P2Medium", "P3Low", "No priority"]);
    expect(handle.element.querySelector(".tm-options-separator")!.nextElementSibling).toBe(options()[3]);
    expect(options().map(option => option.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    expect(document.activeElement).toBe(options()[1]);
  });

  it("picks on click, or with the arrows and Enter, and closes", () => {
    const first = priority("2");
    first.options()[0].click();
    expect(first.choose).toHaveBeenCalledExactlyOnceWith("1");
    expect(first.handle.element.isConnected).toBe(false);
    const second = priority();
    second.key(second.options()[0], "ArrowDown");
    second.key(second.options()[1], "ArrowUp");
    second.key(second.options()[0], "ArrowUp");
    expect(document.activeElement).toBe(second.options()[3]);
    second.key(second.options()[3], "Enter");
    expect(second.choose).toHaveBeenCalledExactlyOnceWith("");
  });

  it("closes without choosing on Escape or a click outside, handing focus back", () => {
    const first = priority("1");
    first.key(first.options()[0], "Escape");
    expect(first.handle.element.isConnected).toBe(false);
    expect(first.choose).not.toHaveBeenCalled();
    const second = priority("1");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(second.handle.element.isConnected).toBe(false);
    expect(second.choose).not.toHaveBeenCalled();
  });
});

describe("a field above the choices", () => {
  function withInput(input: ChoiceInput) {
    const anchor = document.body.createSpan({ text: "Project" });
    const choose = vi.fn();
    const choices = [{ value: "Inbox.md", label: "Inbox" }, { value: "Home.md", label: "Home", separated: true }, { value: "Work.md", label: "Work", detail: "Office" }];
    const handle = openChoicePopover({ anchor, label: "Move to project", choices, selected: "Work.md", choose, input });
    const field = handle.element.querySelector<HTMLInputElement>("input")!;
    const type = (text: string) => { field.value = text; field.dispatchEvent(new Event("input")); };
    const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    const shown = () => Array.from(handle.element.querySelectorAll<HTMLElement>("[role=option]")).filter(item => !item.hidden).map(item => item.textContent);
    return { handle, choose, field, type, key, shown };
  }

  it("focuses the field and searches labels and details, picking the first match with Enter", () => {
    const { handle, choose, field, type, key, shown } = withInput({ placeholder: "Find a project", filter: true });
    expect(document.activeElement).toBe(field);
    type("o");
    expect(shown()).toEqual(["Inbox", "Home", "WorkOffice"]);
    type("offi");
    expect(shown()).toEqual(["WorkOffice"]);
    expect(handle.element.querySelector<HTMLElement>(".tm-options-separator")!.hidden).toBe(true);
    key(field, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("WorkOffice");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(field);
    key(field, "Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("Work.md");
  });

  it("offers to create what was typed when no choice is named that, picked with Enter when nothing matches", () => {
    const run = vi.fn();
    const { handle, choose, field, type, key, shown } = withInput({ placeholder: "Find or create a project", filter: true, create: { label: text => `Create project “${text}”`, run } });
    expect(shown()).toEqual(["Inbox", "Home", "WorkOffice"]);
    type("home");
    // An exact name needs no new project.
    expect(shown()).toEqual(["Home"]);
    type("Hom");
    expect(shown()).toEqual(["Home", "Create project “Hom”"]);
    key(field, "ArrowDown"); key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Create project “Hom”");
    type("Garden");
    expect(shown()).toEqual(["Create project “Garden”"]);
    key(field, "Enter");
    expect(run).toHaveBeenCalledExactlyOnceWith("Garden");
    expect(choose).not.toHaveBeenCalled();
    expect(handle.element.isConnected).toBe(false);
  });

  it("reads a typed value, shows how it reads, and picks it with Enter", () => {
    const { handle, choose, field, type, key } = withInput({
      placeholder: "Type a repeat", invalid: "Not a repeat",
      parse: text => { const rule = parseRepeatInput(text); return rule ? { value: rule, label: rule } : undefined; }
    });
    const hint = () => handle.element.querySelector(".tm-choice-hint")!;
    type("sometimes");
    expect(hint().textContent).toBe("Not a repeat");
    expect(hint().classList.contains("is-invalid")).toBe(true);
    key(field, "Enter");
    expect(choose).not.toHaveBeenCalled();
    type("3 days");
    expect(hint().textContent).toBe("every 3 days");
    key(field, "Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("every 3 days");
  });
});

describe("typed repeats", () => {
  it("reads rules with or without every, and common words", () => {
    expect(["every 3 days", "Monday", "2 weeks", "weekly", "fortnightly", "annually", "every other month", "", "sometimes", "every 0 days"].map(parseRepeatInput))
      .toEqual(["every 3 days", "every monday", "every 2 weeks", "every week", "every 2 weeks", "every year", "every other month", undefined, undefined, undefined]);
  });
});
