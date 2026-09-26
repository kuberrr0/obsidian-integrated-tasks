import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn()
}));
vi.mock("../src/task-line-editor", () => ({
  TaskLineEditor: class {
    value: string;
    defaultValue: string;
    selectionStart = 0;
    selectionEnd = 0;
    setSelectionRange = vi.fn();
    focus = vi.fn();
    destroy = vi.fn();
    constructor(_parent: unknown, value: string) { this.value = this.defaultValue = value; }
  }
}));
import { TaskEditorModal } from "../src/task-editor";
import { parseEditedTaskInput } from "../src/task-input";
import { DEFAULT_SETTINGS, type Task, type TaskDraft } from "../src/types";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 26, 12)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

class Element {
  children: Element[] = [];
  attributes = new Map<string, string>();
  text = "";
  checked = false;
  disabled = false;
  ownerDocument = { defaultView: null };
  createEl(_tag: string, options: { attr?: Record<string, string> } = {}): Element {
    const child = new Element();
    for (const [key, value] of Object.entries(options.attr ?? {})) child.attributes.set(key, value);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}): Element { return this.createEl("div", options); }
  addEventListener(): void {}
  removeEventListener(): void {}
  addClass(): void {}
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  empty(): void { this.children = []; }
  setText(text: string): void { this.text = text; }
}

function openExisting(raw: string) {
  vi.stubGlobal("window", { setTimeout: vi.fn(), clearTimeout: vi.fn() });
  const task: Task = { id: "Inbox.md:0", path: DEFAULT_SETTINGS.inboxPath, line: 0, endLine: 0, raw, childIds: [], ...parseEditedTaskInput(raw.slice(6), raw.slice(6))!, completed: false };
  const modal = new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "MMM D, YYYY", task, onSave: async () => {} });
  const fields = modal as unknown as { modalEl: Element; contentEl: Element; rawInput: { value: string; defaultValue: string }; readRaw(): TaskDraft };
  fields.modalEl = new Element();
  fields.contentEl = new Element();
  modal.onOpen();
  return fields;
}

describe("editing an existing task in the modal", () => {
  it("keeps existing prose when only the priority changes", () => {
    for (const [raw, title] of [["- [ ] Buy sun cream p2", "Buy sun cream"], ["- [ ] Done last Friday p2", "Done last Friday"]]) {
      const modal = openExisting(raw);
      expect(modal.rawInput.value).toBe(raw.slice(6));
      modal.rawInput.value = modal.rawInput.value.replace("p2", "p1");
      const draft = modal.readRaw();
      expect(draft).toMatchObject({ title, priority: 1 });
      expect(draft.scheduledDate).toBeUndefined();
      expect(draft.deadline).toBeUndefined();
    }
  });

  it("reads a natural date the user newly typed", () => {
    const modal = openExisting("- [ ] Buy sun cream p2");
    modal.rawInput.value = "Buy sun cream tomorrow p2";
    expect(modal.readRaw()).toMatchObject({ title: "Buy sun cream", scheduledDate: "2026-09-27", priority: 2 });
    modal.rawInput.value = "Buy sun cream p2 tomorrow";
    expect(modal.readRaw()).toMatchObject({ title: "Buy sun cream", scheduledDate: "2026-09-27", priority: 2 });
  });

  it("marks the error message as an alert", () => {
    const modal = openExisting("- [ ] Task");
    const error = modal.contentEl.children.find(child => child.attributes.get("role") === "alert");
    expect(error?.attributes.get("aria-live")).toBe("assertive");
  });
});

describe("parseEditedTaskInput", () => {
  const reference = new Date(2026, 8, 26, 12);
  const parse = (text: string, original: string) => parseEditedTaskInput(text, original, reference, "MMM D, YYYY");

  it("parses strictly when no new text was typed", () => {
    expect(parse("Done last Friday p1", "Done last Friday p2")).toMatchObject({ title: "Done last Friday", priority: 1 });
    expect(parse("Buy cream", "Buy sun cream")?.scheduledDate).toBeUndefined();
  });

  it("applies natural dates only inside the typed segment", () => {
    expect(parse("Call to tomorrow", "Call to")).toMatchObject({ title: "Call to", scheduledDate: "2026-09-27" });
    // Completing "to" into "tomorrow" spans text that was already there.
    expect(parse("Call tomorrow", "Call to")).toMatchObject({ title: "Call tomorrow" });
    expect(parse("Call tomorrow", "Call to")?.scheduledDate).toBeUndefined();
    expect(parse("Report {friday} due", "Report due")).toMatchObject({ title: "Report due", deadline: "2026-10-02" });
    expect(parse("Plan [[Sep 29, 2026]]", "Plan [[Sep 30, 2026]]")).toMatchObject({ title: "Plan", scheduledDate: "2026-09-29" });
  });

  it("keeps strict dates and does not add a second scheduled date", () => {
    expect(parse("Pay tomorrow [[Sep 30, 2026]]", "Pay [[Sep 30, 2026]]")).toMatchObject({ title: "Pay tomorrow", scheduledDate: "2026-09-30" });
  });
});
