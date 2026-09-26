import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  MarkdownRenderChild: class { registered: (() => void)[] = []; constructor(readonly containerEl: unknown) {} register(callback: () => void) { this.registered.push(callback); } }
}));
vi.mock("../src/parser", async importOriginal => {
  const original = await importOriginal<typeof import("../src/parser")>();
  return { ...original, scanTasks: vi.fn(original.scanTasks) };
});
import { scanTasks } from "../src/parser";
import { registerNoteTaskEdit } from "../src/note-task-edit";
import type { MarkdownPostProcessorContext } from "obsidian";

beforeEach(() => { vi.mocked(scanTasks).mockClear(); });

function section(text: string, taskLines: number[]) {
  const document = Object.assign(new EventTarget(), { addEventListener: vi.fn(EventTarget.prototype.addEventListener) });
  const items = taskLines.map(line => {
    const item = { getAttribute: (name: string) => name === "data-line" ? String(line) : null };
    const checkbox = { closest: (selector: string) => selector.startsWith("li") ? item : checkbox };
    return checkbox;
  });
  const root = Object.assign(new EventTarget(), {
    ownerDocument: document,
    win: { setTimeout, clearTimeout },
    matches: () => false,
    querySelector: (selector: string) => selector === "li.task-list-item" && items.length ? {} : null
  });
  const context = { sourcePath: "Note.md", addChild: vi.fn(), getSectionInfo: () => ({ text, lineStart: 0, lineEnd: text.split("\n").length - 1 }) };
  const open = vi.fn();
  registerNoteTaskEdit(root as unknown as HTMLElement, context as unknown as MarkdownPostProcessorContext, () => "YYYY-MM-DD", open);
  const click = (index: number) => {
    const event = new Event("click", { cancelable: true });
    Object.defineProperties(event, { target: { value: items[index] }, metaKey: { value: true }, ctrlKey: { value: false }, button: { value: 0 } });
    root.dispatchEvent(event);
  };
  return { root, document, context, open, click };
}

describe("Reading view task resolution", () => {
  it("binds nothing for sections without checklist items", () => {
    const { document, context } = section("# Heading\nJust prose", []);
    expect(context.addChild).not.toHaveBeenCalled();
    expect(document.addEventListener).not.toHaveBeenCalled();
  });

  it("scans a section once across checkbox clicks", () => {
    const text = "# Tasks\n- [ ] First p1\n- [ ] Second 2026-09-30\n- [x] Third";
    const { click, open, context, document } = section(text, [1, 2, 3]);
    expect(context.addChild).toHaveBeenCalledOnce();
    expect(document.addEventListener).toHaveBeenCalledTimes(3);
    click(0);
    click(1);
    click(2);
    expect(open.mock.calls.map(call => call[0].title)).toEqual(["First", "Second", "Third"]);
    expect(scanTasks).toHaveBeenCalledOnce();
  });

  it("rescans when the section text changes", () => {
    const first = section("- [ ] One", [0]);
    first.click(0);
    first.click(0);
    const second = section("- [ ] One edited", [0]);
    second.click(0);
    expect(second.open.mock.calls[0][0].title).toBe("One edited");
    expect(scanTasks).toHaveBeenCalledTimes(2);
  });
});
