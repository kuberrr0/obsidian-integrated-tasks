// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { openChoicePopover, PRIORITY_CHOICES } from "../src/choice-popover";

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
