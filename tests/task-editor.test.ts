import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn()
}));
import { TaskEditorModal } from "../src/task-editor";
import { tomorrowIso } from "../src/date";
import { DEFAULT_SETTINGS, type TaskDraft } from "../src/types";

function editor() {
  return new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: { ...DEFAULT_SETTINGS, inboxPath: "Tasks/Inbox.md" }, dateFormat: "DD/MM/YYYY", onSave: async () => {} }) as unknown as {
    serializeDraft(draft: TaskDraft): string;
    readRaw(): TaskDraft;
    rawInput: { value: string };
    destinationInput: { value: string };
  };
}
const draft: TaskDraft = { title: "Write report", completed: false, destination: "Tasks/Inbox.md", indent: 0 };
describe("implicit Inbox destination", () => {
  it("omits the Inbox token while retaining explicit project and section tokens", () => {
    const modal = editor();
    expect(modal.serializeDraft(draft)).toBe("- [ ] Write report");
    expect(modal.serializeDraft({ ...draft, destination: "Project.md" })).toContain("~[[Project]]");
    expect(modal.serializeDraft({ ...draft, destination: "Tasks/Inbox.md#Later" })).toContain("~[[Tasks/Inbox#Later]]");
  });
  it("routes raw input without a token to configured Inbox even after selecting a project", () => {
    const modal = editor();
    modal.rawInput = { value: "- [ ] Write report" };
    modal.destinationInput = { value: "Project.md" };
    expect(modal.readRaw().destination).toBe("Tasks/Inbox.md");
    modal.rawInput.value = "- [ ] Write report ~[[Project]]";
    expect(modal.readRaw().destination).toBe("Project.md");
  });
});


describe("calendar editor presets", () => {
  it("prefills date, time and duration while retaining the project destination", () => {
    const modal = new TaskEditorModal({} as App, {
      mode: "today", projectPath: "Work.md", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "DD/MM/YYYY",
      preset: { scheduledDate: "2027-03-28", scheduledTime: "09:15", durationMinutes: 60 }, onSave: async () => {}
    }) as unknown as { draft: TaskDraft };
    expect(modal.draft).toMatchObject({ scheduledDate: "2027-03-28", scheduledTime: "09:15", durationMinutes: 60, destination: "Work.md" });
  });
});


// Exercise the modal's event handlers without an Obsidian host.
class EditorElement extends EventTarget {
  value = "";
  text = "";
  disabled = false;
  children: EditorElement[] = [];
  options: EditorElement[] = [];
  ownerDocument = { defaultView: null };
  onkeydown?: (event: KeyboardEvent) => void;
  createEl(tag: string, options: { value?: string; text?: string } = {}): EditorElement {
    const child = tag === "button" ? new EditorButton() : new EditorElement();
    child.value = options.value ?? "";
    child.text = options.text ?? "";
    this.children.push(child);
    if (tag === "option") this.options.push(child);
    return child;
  }
  createDiv(options = {}): EditorElement { return this.createEl("div", options); }
  createSpan(options = {}): EditorElement { return this.createEl("span", options); }
  appendChild(child: EditorElement): void { this.children.push(child); }
  addClass(): void {}
  setAttribute(): void {}
  empty(): void { this.children = []; }
  setText(text: string): void { this.text = text; }
  focus(): void {}
  click(): void { this.dispatchEvent(new Event("click")); }
}
class EditorButton extends EditorElement {}

afterEach(() => vi.unstubAllGlobals());
function openModal(edit = false) {
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  vi.stubGlobal("HTMLButtonElement", EditorButton);
  const onSave = vi.fn(async (_draft: TaskDraft) => {});
  const modal = new TaskEditorModal({} as App, {
    mode: "inbox", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "YYYY-MM-DD", onSave,
    task: edit ? { id: "Inbox.md:0", path: "Inbox.md", line: 0, endLine: 0, raw: "- [ ] Existing", title: "Existing", indent: 0, completed: false, childIds: [] } : undefined
  });
  const fields = modal as unknown as {
    modalEl: EditorElement; contentEl: EditorElement; close: () => void;
    rawInput: EditorElement; titleInput: EditorElement; priorityInput: EditorElement;
  };
  fields.modalEl = new EditorElement();
  fields.contentEl = new EditorElement();
  fields.close = vi.fn();
  modal.onOpen();
  const key = (extra: Record<string, unknown> = {}) => {
    const event = { key: "Enter", target: fields.rawInput, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    fields.contentEl.onkeydown!(event as unknown as KeyboardEvent);
    return event;
  };
  return { fields, onSave, key };
}

describe("multiline modal interactions", () => {
  it("shows only the main task's properties and preserves other lines after a structured edit", async () => {
    const { fields, onSave, key } = openModal();
    fields.rawInput.value = "- [x] Main p1\n  - [ ] Child tomorrow p2\n  - Description\n- [ ] Sibling";
    fields.rawInput.dispatchEvent(new Event("input"));
    expect(fields.titleInput.value).toBe("Main");
    expect(fields.priorityInput.value).toBe("1");
    fields.titleInput.value = "Renamed";
    fields.titleInput.dispatchEvent(new Event("input"));
    expect(fields.rawInput.value).toBe("- [x] Renamed p1\n  - [ ] Child tomorrow p2\n  - Description\n- [ ] Sibling");
    key({ metaKey: true });
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Renamed", completed: true, priority: 1, additionalLines: [expect.stringMatching(/^  - \[ \] Child \[\[.*\]\] p2$/), "  - Description", "- [ ] Sibling"] });
  });
  it.each([false, true])("requires Cmd/Ctrl+Enter in the modal (editing: %s)", async edit => {
    const { fields, onSave, key } = openModal(edit);
    fields.rawInput.value = "- [ ] Task";
    fields.rawInput.dispatchEvent(new Event("input"));
    expect(key().preventDefault).not.toHaveBeenCalled();
    expect(key({ shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    key({ metaKey: true, isComposing: true });
    key({ ctrlKey: true, repeat: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(key({ ctrlKey: true }).preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });
});


it("parses natural scheduled dates and deadlines in the edit modal raw text", async () => {
  const { fields, onSave, key } = openModal(true);
  fields.rawInput.value = "- [ ] Call tomorrow at 9pm {tomorrow at noon}";
  fields.rawInput.dispatchEvent(new Event("input"));
  expect(fields.titleInput.value).toBe("Call");
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Call", scheduledDate: tomorrowIso(), scheduledTime: "21:00", deadline: tomorrowIso(), deadlineTime: "12:00" });
});
