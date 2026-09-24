import type { TaskEditorProperty } from "../src/task-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn()
}));
vi.mock("../src/task-line-editor", async original => ({
  ...await original<typeof import("../src/task-line-editor")>(),
  TaskLineEditor: class {
    value: string;
    focus = vi.fn();
    setSelectionRange = vi.fn();
    destroy = vi.fn();
    constructor(_host: unknown, value: string) { this.value = value; }
  }
}));
import { BulkTaskEditorModal, bulkPropertyPatch, bulkInlinePatch, bulkInlineText, commonBulkValues } from "../src/bulk-task-editor";
import { scanTasks } from "../src/parser";
import type { BulkTaskPatch } from "../src/bulk-tasks";

class Element extends EventTarget {
  tagName = "DIV";
  text = "";
  value = "";
  placeholder = "";
  disabled = false;
  attrs = new Map<string, string>();
  children: Element[] = [];
  ownerDocument = { defaultView: null };
  onkeydown?: (event: KeyboardEvent) => void;
  createEl(tag: string, options: { text?: string; value?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element();
    child.tagName = tag.toUpperCase();
    child.text = options.text ?? "";
    child.value = options.value ?? "";
    child.attrs = new Map(Object.entries(options.attr ?? {}));
    this.children.push(child);
    return child;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  createSpan(options = {}): Element { return this.createEl("span", options); }
  addClass(): void {}
  setAttribute(key: string, value: string): void { this.attrs.set(key, value); }
  empty(): void { this.children = []; }
  setText(text: string): void { this.text = text; }
  focus(): void {}
  remove(): void {}
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  click(): void { this.dispatchEvent(new Event("click")); }
}
function open(focusProperty?: TaskEditorProperty) {
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  const tasks = scanTasks("Work.md", "- [ ] A [[2026-09-07]] 09:00 1h p1\n- [ ] B [[2026-09-08]] 1h p2");
  const onSave = vi.fn(async (_patch: BulkTaskPatch) => {});
  const onDelete = vi.fn(async () => {});
  const modal = new BulkTaskEditorModal({} as App, { tasks, focusProperty, projects: [], inboxPath: "Inbox.md", dateFormat: "YYYY-MM-DD", onSave, onDelete });
  const elements = modal as unknown as { contentEl: Element; modalEl: Element; close: () => void; editor: { value: string; focus: ReturnType<typeof vi.fn>; setSelectionRange: ReturnType<typeof vi.fn> }; handleKeydown: (event: KeyboardEvent) => void };
  elements.contentEl = new Element();
  elements.modalEl = new Element();
  elements.close = vi.fn();
  modal.onOpen();
  const input = (label: string) => elements.contentEl.all().find(element => element.attrs.get("aria-label") === label)!;
  const button = (name: string) => [...elements.contentEl.all(), ...elements.modalEl.all()].find(element => element.tagName === "BUTTON" && (element.text === name || element.attrs.get("aria-label") === name))!;
  return { ...elements, onSave, onDelete, input, button };
}

describe("bulk property parsing", () => {
  it("only includes changed fields and clears dates together with their times", () => {
    expect(bulkPropertyPatch({ priority: "3" }, "YYYY-MM-DD")).toEqual({ priority: 3 });
    const patch = bulkPropertyPatch({ scheduled: "", deadline: "", duration: "" }, "YYYY-MM-DD");
    expect(Object.keys(patch).sort()).toEqual(["deadline", "deadlineTime", "durationMinutes", "scheduledDate", "scheduledTime"]);
    expect(Object.values(patch).every(value => value === undefined)).toBe(true);
  });
  it("parses natural dates, date formats, times and durations", () => {
    expect(bulkPropertyPatch({ scheduled: "tomorrow at 9pm", deadline: "10/09/2026 at noon", duration: "1h 30m" }, "DD/MM/YYYY", new Date(2026, 8, 7, 10))).toEqual({
      scheduledDate: "2026-09-08", scheduledTime: "21:00", deadline: "2026-09-10", deadlineTime: "12:00", durationMinutes: 90
    });
  });
  it("validates changed values before saving", () => {
    expect(() => bulkPropertyPatch({ scheduled: "garbage" }, "YYYY-MM-DD")).toThrow(/scheduled/);
    expect(() => bulkPropertyPatch({ duration: "-2h" }, "YYYY-MM-DD")).toThrow(/duration/);
    expect(() => bulkPropertyPatch({ destination: "" }, "YYYY-MM-DD")).toThrow(/destination/);
  });
});

describe("bulk inline editor", () => {
  it("shows common properties and leaves mixed values untouched", async () => {
    const { editor, button, onSave } = open();
    expect(editor.value).toContain("1h");
    expect(editor.value).toContain("~[[Work]]");
    expect(editor.value).not.toContain("p1");
    editor.value += " p3";
    button("Save task").click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ priority: 3 }));
  });
  it("preserves mixed values and reverted common fields", async () => {
    const { editor, button, onSave } = open();
    const initial = editor.value;
    editor.value = "2h ~[[Work]]";
    editor.value = initial;
    button("Save task").click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({}));
  });
  it("uses icon actions without a Cancel button and deletes without parsing edits", async () => {
    const { editor, button, onDelete, onSave } = open();
    expect(button("Cancel")).toBeUndefined();
    expect(button("Save task").text).toBe("");
    expect(button("Delete task").text).toBe("");
    editor.value = "bad input";
    button("Delete task").click();
    button("Delete task").click();
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps invalid edits open and saves valid properties with Enter", async () => {
    const { editor, button, onSave, handleKeydown, close } = open();
    editor.value = "bad input";
    button("Save task").click();
    expect(onSave).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    editor.value = "2h ~[[Work]]";
    const event = { key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handleKeydown({ ...event, shiftKey: true } as unknown as KeyboardEvent);
    handleKeydown({ ...event, isComposing: true } as unknown as KeyboardEvent);
    expect(onSave).not.toHaveBeenCalled();
    handleKeydown(event as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 120 }));
  });
  it("shows only the editor and delete/confirm actions", () => {
    const { contentEl, modalEl, input } = open();
    expect(input("Description")).toBeUndefined();
    expect(contentEl.all().filter(element => element.text)).toEqual([]);
    expect([...contentEl.all(), ...modalEl.all()].filter(element => element.tagName === "BUTTON").map(element => element.attrs.get("aria-label"))).toEqual(["Delete task", "Save task"]);
  });
  it.each(["scheduledDate", "deadline", "durationMinutes", "priority", "tags"] as const)("focuses %s without changing any properties", async property => {
    const { editor, button, onSave } = open(property);
    const callback = vi.mocked(window.setTimeout).mock.calls[0][0] as () => void;
    callback();
    expect(editor.focus).toHaveBeenCalledOnce();
    button("Save task").click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({}));
  });
});

afterEach(() => vi.unstubAllGlobals());

it("retains heterogeneous tasks when the shared editor is unchanged", () => {
  const tasks = scanTasks("Work.md", "- [ ] A [[2026-09-07]] 09:00 1h p1\n- [ ] B [[2026-09-08]] 1h p2");
  const initial = bulkInlineText(commonBulkValues(tasks, "YYYY-MM-DD"), "YYYY-MM-DD");
  expect(bulkInlinePatch(initial, initial, "YYYY-MM-DD", "Inbox.md")).toEqual({});
  expect(bulkInlinePatch(initial + " [[2026-09-09]]", initial, "YYYY-MM-DD", "Inbox.md")).toEqual({ scheduledDate: "2026-09-09", scheduledTime: undefined });
});

it("clears common properties and routes a removed destination to Inbox", () => {
  const patch = bulkInlinePatch("", "p1 1h #[[work]] ~[[Work]]", "YYYY-MM-DD", "Inbox.md");
  expect(patch).toEqual({ priority: undefined, durationMinutes: undefined, tags: [], destination: "Inbox.md" });
});
