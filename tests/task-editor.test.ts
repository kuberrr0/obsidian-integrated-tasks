import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}, setIcon: vi.fn(), Component: class { load() {} unload() {} }, MarkdownRenderer: { render: vi.fn(async () => {}) }
}));
vi.mock("../src/task-line-editor", () => ({
  TaskLineEditor: class extends EventTarget {
    value: string;
    defaultValue: string;
    selectionStart = 0;
    selectionEnd = 0;
    setSelectionRange = vi.fn();
    focus = vi.fn();
    destroy = vi.fn();
    constructor(_parent: unknown, value: string, _format: string, change: () => void) {
      super(); this.value = this.defaultValue = value;
      this.addEventListener("input", change);
    }
  }
}));
import { TaskEditorModal, type TaskEditorProperty } from "../src/task-editor";
import { tomorrowIso } from "../src/date";
import { DEFAULT_SETTINGS, type TaskDraft } from "../src/types";

function editor() {
  return new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: { ...DEFAULT_SETTINGS, inboxPath: "Tasks/Inbox.md" }, dateFormat: "DD/MM/YYYY", onSave: async () => {} }) as unknown as {
    serializeDraft(draft: TaskDraft): string;
    readRaw(): TaskDraft;
    rawInput: { value: string; setSelectionRange: ReturnType<typeof vi.fn> };
    completedInput: { checked: boolean };
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
    modal.rawInput = { value: "- [ ] Write report", setSelectionRange: vi.fn() };
    modal.completedInput = { checked: false };
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
  hidden = false;
  style = { height: "" };
  scrollHeight = 40;
  childNodes: EditorElement[] = [];
  querySelectorAll(): EditorElement[] { return []; }
  matches(): boolean { return false; }
  replaceChildren(...children: EditorElement[]): void { this.children = children; }
  value = "";
  rows = 0;
  checked = false;
  selectionStart = 0;
  selectionEnd = 0;
  defaultValue = "";
  text = "";
  disabled = false;
  children: EditorElement[] = [];
  options: EditorElement[] = [];
  ownerDocument = { defaultView: null, activeElement: null, createElement: () => new EditorElement() };
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
  setSelectionRange = vi.fn();
  click(): void { this.dispatchEvent(new Event("click")); }
}
class EditorButton extends EditorElement {}

afterEach(() => vi.unstubAllGlobals());
function openModal(edit = false, focusProperty?: TaskEditorProperty) {
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  vi.stubGlobal("HTMLButtonElement", EditorButton);
  const onSave = vi.fn(async (_draft: TaskDraft) => {});
  const modal = new TaskEditorModal({} as App, {
    mode: "inbox", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "YYYY-MM-DD", onSave, focusProperty,
    task: edit ? { id: "Inbox.md:0", path: "Inbox.md", line: 0, endLine: 0, raw: "- [ ] Existing", title: "Existing", indent: 0, completed: false, childIds: [] } : undefined
  });
  const fields = modal as unknown as {
    modalEl: EditorElement; contentEl: EditorElement; close: () => void; handleKeydown: (event: KeyboardEvent) => void;
    completedInput: EditorElement; tagsInput: EditorElement; rawInput: EditorElement; titleInput: EditorElement; priorityInput: EditorElement; descriptionInput: EditorElement; destinationInput: EditorElement;
  };
  fields.modalEl = new EditorElement();
  fields.contentEl = new EditorElement();
  fields.close = vi.fn();
  modal.onOpen();
  const key = (extra: Record<string, unknown> = {}) => {
    const event = { key: "Enter", target: fields.rawInput, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    fields.handleKeydown(event as unknown as KeyboardEvent);
    return event;
  };
  return { fields, onSave, key };
}

describe("multiline modal interactions", () => {
  it("preserves pasted task trees in the single text box", async () => {
    const { fields, onSave, key } = openModal();
    fields.rawInput.value = "- [x] Main p1\n  - [ ] Child tomorrow p2\n  - Description\n- [ ] Sibling";
    key({ metaKey: true });
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Main", completed: true, priority: 1, additionalLines: [expect.stringMatching(/^  - \[ \] Child \d{4}-\d{2}-\d{2} p2$/), "  - Description", "- [ ] Sibling"] });
  });
  it.each([false, true])("saves with Enter while preserving Shift+Enter and composition (editing: %s)", async edit => {
    const { fields, onSave, key } = openModal(edit);
    fields.rawInput.value = "- [ ] Task";
    fields.rawInput.dispatchEvent(new Event("input"));
    expect(key({ shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    key({ metaKey: true, isComposing: true });
    key({ ctrlKey: true, repeat: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(key().preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });
});


it("parses natural scheduled dates and deadlines in the edit modal raw text", async () => {
  const { fields, onSave, key } = openModal(true);
  fields.rawInput.value = "- [ ] Call tomorrow at 9pm {tomorrow at noon}";
  fields.rawInput.dispatchEvent(new Event("input"));
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Call", scheduledDate: tomorrowIso(), scheduledTime: "21:00", deadline: tomorrowIso(), deadlineTime: "12:00" });
});


it.each([false, true])("uses one compact text field (editing: %s)", edit => {
  const { fields } = openModal(edit);
  expect(fields.rawInput).toBeDefined();
  expect(fields.titleInput).toBeUndefined();
  expect(fields.tagsInput).toBeUndefined();
  expect(fields.descriptionInput).toBeUndefined();
  expect(fields.destinationInput).toBeUndefined();
});

it("saves all metadata from the task line", async () => {
  const { fields, key, onSave } = openModal(true);
  fields.rawInput.value = "- [x] Renamed [[2027-03-28]] 09:15 1h {[[2027-03-29]]} p1 #[[work]] #[[client notes]] ~[[Projects/Work#Plan]]";
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Renamed", completed: true, scheduledDate: "2027-03-28", scheduledTime: "09:15", durationMinutes: 60, deadline: "2027-03-29", priority: 1, tags: ["work", "client notes"], destination: "Projects/Work.md#Plan" });
  expect(onSave.mock.calls[0][0].description).toBeUndefined();
  expect(onSave.mock.calls[0][0].additionalLines).toBeUndefined();
});

it("rejects extra task lines when editing", async () => {
  const { fields, key, onSave } = openModal(true);
  fields.rawInput.value = "- [ ] Main\n- [ ] Another";
  key({ metaKey: true });
  expect(onSave).not.toHaveBeenCalled();
});

it("rejects an empty checklist", () => {
  const { fields, key, onSave } = openModal(true);
  fields.rawInput.value = "- [ ] ";
  key({ metaKey: true });
  expect(onSave).not.toHaveBeenCalled();
});

it("selects inline metadata for property shortcuts", () => {
  const { fields } = openModal(true, "priority");
  fields.rawInput.value = "Existing p2";
  const focus = vi.spyOn(fields.rawInput, "focus");
  const callback = vi.mocked(window.setTimeout).mock.calls.at(-1)![0] as () => void;
  callback();
  expect(focus).toHaveBeenCalledOnce();
  expect(fields.rawInput.setSelectionRange).toHaveBeenCalledWith(9, 11);
});

it("saves an unchanged task without changing its metadata", async () => {
  const { key, onSave } = openModal(true);
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Existing", completed: false, destination: "Inbox.md" });
});

it.each([false, true])("renders completion separately and saves checkbox changes (editing: %s)", async edit => {
  const { fields, key, onSave } = openModal(edit);
  expect(fields.rawInput.value).toBe(edit ? "Existing" : "");
  expect(fields.completedInput.checked).toBe(false);
  if (!edit) fields.rawInput.value = "New task p2";
  fields.completedInput.checked = true;
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ completed: true, title: edit ? "Existing" : "New task" });
});

it("renders a pasted checklist prefix as the checkbox", async () => {
  const { fields, key, onSave } = openModal(true);
  fields.rawInput.value = "- [x] Pasted p1";
  fields.rawInput.dispatchEvent(new Event("input"));

  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Pasted", priority: 1, completed: true });
});

it.each([false, true])("omits modal headings and shortcut hints (editing: %s)", edit => {
  const { fields } = openModal(edit);
  const text = (element: EditorElement): string => [element.text, ...element.children.map(text)].join(" ");
  expect(text(fields.contentEl)).not.toMatch(/New task|Edit task|Cmd\/Ctrl/);
});
