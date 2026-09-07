import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}
}));
import { BulkTaskEditorModal, bulkPropertyPatch } from "../src/bulk-task-editor";
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
  all(): Element[] { return this.children.flatMap(child => [child, ...child.all()]); }
  click(): void { this.dispatchEvent(new Event("click")); }
}
function open() {
  const tasks = scanTasks("Work.md", "- [ ] A [[2026-09-07]] 09:00 1h p1\n- [ ] B [[2026-09-08]] 1h p2");
  const onSave = vi.fn(async (_patch: BulkTaskPatch) => {});
  const onDelete = vi.fn(async () => {});
  const modal = new BulkTaskEditorModal({} as App, { tasks, projects: [], inboxPath: "Inbox.md", dateFormat: "YYYY-MM-DD", onSave, onDelete });
  const elements = modal as unknown as { contentEl: Element; modalEl: Element; close: () => void };
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

describe("bulk modal interactions", () => {
  it("shows mixed and common values and saves only changed fields", async () => {
    const { input, button, onSave } = open();
    expect(input("Date and time").placeholder).toBe("Mixed — unchanged");
    expect(input("Priority").value).toBe("__mixed__");
    expect(input("Duration").value).toBe("1h");
    expect(input("Destination").children.map(option => option.value)).toContain("Inbox.md");
    expect(input("Destination").children.find(option => option.value === "Inbox.md")?.text).toBe("Inbox");
    expect(input("Destination").children.find(option => option.value === "Work.md")?.text).toBe("Work");
    input("Priority").value = "3";
    input("Priority").dispatchEvent(new Event("change"));
    button("Save task").click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ priority: 3 }));
  });
  it("can explicitly clear a mixed value and leaves reverted common fields unchanged", async () => {
    const { input, button, onSave } = open();
    input("Duration").value = "2h";
    input("Duration").dispatchEvent(new Event("input"));
    input("Duration").value = "1h";
    input("Duration").dispatchEvent(new Event("input"));
    button("Clear date and time").click();
    button("Save task").click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ scheduledDate: undefined, scheduledTime: undefined }));
  });
  it("cancels without applying edits and deletes the selection without validating fields", async () => {
    const cancel = open();
    cancel.input("Duration").value = "bad";
    cancel.button("Cancel").click();
    expect(cancel.close).toHaveBeenCalledOnce();
    expect(cancel.onSave).not.toHaveBeenCalled();
    const remove = open();
    remove.input("Duration").value = "bad";
    remove.input("Duration").dispatchEvent(new Event("input"));
    remove.button("Delete task").click();
    remove.button("Delete task").click();
    await vi.waitFor(() => expect(remove.onDelete).toHaveBeenCalledOnce());
    expect(remove.onSave).not.toHaveBeenCalled();
  });
  it("keeps the modal open on an invalid field and uses Mod+Enter to save", async () => {
    const { input, button, onSave, contentEl, close } = open();
    input("Duration").value = "bad";
    input("Duration").dispatchEvent(new Event("input"));
    button("Save task").click();
    expect(onSave).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(button("Save task").disabled).toBe(false);
    input("Duration").value = "2h";
    input("Duration").dispatchEvent(new Event("input"));
    const event = { key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    contentEl.onkeydown!(event as unknown as KeyboardEvent);
    expect(event.preventDefault).not.toHaveBeenCalled();
    contentEl.onkeydown!({ ...event, metaKey: true } as unknown as KeyboardEvent);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({ durationMinutes: 120 }));
  });
});
