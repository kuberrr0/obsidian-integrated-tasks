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
import { todayIso, tomorrowIso } from "../src/date";
import { scanTasks } from "../src/parser";
import { DEFAULT_SETTINGS, type TaskDraft } from "../src/types";
import { setTagFormat } from "../src/task-tags";

function editor() {
  return new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: { ...DEFAULT_SETTINGS, inboxPath: "Tasks/Inbox.md" }, dateFormat: "DD/MM/YYYY", onSave: async () => {} }) as unknown as {
    serializeDraft(draft: TaskDraft): string;
    readRaw(): TaskDraft;
    rawInput: { value: string; setSelectionRange: ReturnType<typeof vi.fn> };
    completedInput: { checked: boolean };
    statusInput: { value: string };
    destinationInput: { value: string };
  };
}
const draft: TaskDraft = { title: "Write report", completed: false, destination: "Tasks/Inbox.md", indent: 0 };
describe("tags in the task editor, in the Tag format", () => {
  afterEach(() => setTagFormat("wikilink"));
  it.each([["hash", "Call mom #errand"], ["wikilink", "Call mom #[[errand]]"]] as const)("reads only %s tags", (format, typed) => {
    setTagFormat(format);
    const modal = new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: { ...DEFAULT_SETTINGS, tagFormat: format }, dateFormat: "YYYY-MM-DD", onSave: async () => {} }) as unknown as {
      readRaw(): TaskDraft; rawInput: { value: string }; chosenStatus: string;
    };
    modal.rawInput = { value: typed };
    expect(modal.readRaw()).toMatchObject({ title: "Call mom", tags: ["errand"] });
    modal.rawInput = { value: format === "hash" ? "Call mom #[[errand]]" : "Call mom #errand" };
    expect(modal.readRaw().tags).toBeUndefined();
  });
});
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
    modal.statusInput = { value: "" };
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
function openModal(edit = false, focusProperty?: TaskEditorProperty, raw?: string) {
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  vi.stubGlobal("HTMLButtonElement", EditorButton);
  const onSave = vi.fn(async (_draft: TaskDraft) => {});
  const modal = new TaskEditorModal({} as App, {
    mode: "inbox", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "YYYY-MM-DD", onSave, focusProperty,
    task: edit && raw ? scanTasks("Inbox.md", raw)[0] : edit ? { id: "Inbox.md:0", path: "Inbox.md", line: 0, endLine: 0, raw: "- [ ] Existing", title: "Existing", indent: 0, status: "todo", completed: false, childIds: [] } : undefined
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
    // Safari's Enter that ends a composition no longer says it is composing: until the composition has ended, Enter
    // only confirms the composed text.
    fields.contentEl.dispatchEvent(new Event("compositionstart"));
    key();
    fields.contentEl.dispatchEvent(new Event("compositionend"));
    key();
    expect(onSave).not.toHaveBeenCalled();
    const timers = (window.setTimeout as unknown as ReturnType<typeof vi.fn>).mock.calls;
    (timers[timers.length - 1][0] as () => void)();
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

it("opens the property's popover for a property shortcut, the title keeping the cursor", () => {
  const { fields } = openModal(true, "priority", "- [ ] Existing p2");
  expect(fields.rawInput.value).toBe("Existing");
  const button = (fields as unknown as { propertyButtons: Map<string, { click(): void }> }).propertyButtons.get("priority")!;
  const click = vi.spyOn(button, "click").mockImplementation(() => {});
  const callback = vi.mocked(window.setTimeout).mock.calls.at(-1)![0] as () => void;
  callback();
  expect(fields.rawInput.setSelectionRange).toHaveBeenCalledWith(0, 0);
  expect(click).toHaveBeenCalledOnce();
});

it("shows only the title of a task with a defer, and keeps the defer", () => {
  const { fields } = openModal(true, "defer", "- [ ] Existing >2026-10-01 p2");
  expect(fields.rawInput.value).toBe("Existing");
  const callback = vi.mocked(window.setTimeout).mock.calls.at(-1)![0] as () => void;
  callback();
  expect(fields.rawInput.setSelectionRange).toHaveBeenCalledWith(0, 0);
});

it.each(["- [ ] Existing >2026-10-01", "- [ ] Existing >someday"])("keeps a defer when saving unchanged: %s", async raw => {
  const { key, onSave } = openModal(true, undefined, raw);
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const draft = onSave.mock.calls[0][0];
  expect(raw.endsWith("someday") ? draft.someday : draft.deferDate).toBe(raw.endsWith("someday") ? true : "2026-10-01");
});

it("saves an unchanged task without changing its metadata", async () => {
  const { key, onSave } = openModal(true);
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ title: "Existing", completed: false, destination: "Inbox.md" });
});

const setStatus = (fields: object, status: string) => (fields as { setStatus(status: string): void }).setStatus(status);

it.each([false, true])("saves the status chosen from the Status button (editing: %s)", async edit => {
  const { fields, key, onSave } = openModal(edit);
  expect(fields.rawInput.value).toBe(edit ? "Existing" : "");
  if (!edit) fields.rawInput.value = "New task p2";
  setStatus(fields, "done");
  key({ metaKey: true });
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ status: "done", completed: true, title: edit ? "Existing" : "New task" });
});

it("keeps an in-progress, waiting or cancelled status, and lets the Status button or a pasted checkbox change it", async () => {
  const save = async (raw: string, change?: (fields: ReturnType<typeof openModal>["fields"]) => void) => {
    const { fields, key, onSave } = openModal(true, undefined, raw);
    change?.(fields);
    key({ metaKey: true });
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    return onSave.mock.calls[0][0];
  };
  expect(await save("- [/] Draft p1")).toMatchObject({ status: "doing", completed: false, priority: 1 });
  expect(await save("- [?] Draft", fields => { fields.rawInput.value = "Draft p2"; })).toMatchObject({ status: "waiting", completed: false, priority: 2 });
  expect(await save("- [-] Draft")).toMatchObject({ status: "cancelled", completed: true });
  expect(await save("- [/] Draft", fields => setStatus(fields, "done"))).toMatchObject({ status: "done", completed: true });
  expect(await save("- [-] Draft", fields => setStatus(fields, "todo"))).toMatchObject({ status: "todo", completed: false });
  expect(await save("- [ ] Draft", fields => { fields.rawInput.value = "- [?] Pasted"; })).toMatchObject({ title: "Pasted", status: "waiting" });
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

describe("a new task in a view's context", () => {
  let lastOpened: { readRaw(): TaskDraft } | undefined;
  function opened(options: { mode: "inbox" | "today" | "tags" | "all"; preset?: Partial<TaskDraft>; projectPath?: string }) {
    vi.stubGlobal("window", { setTimeout: (run: () => void) => { run(); return 0; }, clearTimeout: vi.fn() });
    vi.stubGlobal("HTMLButtonElement", EditorButton);
    const modal = new TaskEditorModal({} as App, { projects: [], settings: DEFAULT_SETTINGS, dateFormat: "YYYY-MM-DD", onSave: async () => {}, ...options });
    const fields = modal as unknown as { modalEl: EditorElement; contentEl: EditorElement; rawInput: { value: string; setSelectionRange: ReturnType<typeof vi.fn> } };
    fields.modalEl = new EditorElement();
    fields.contentEl = new EditorElement();
    modal.onOpen();
    lastOpened = modal as unknown as { readRaw(): TaskDraft };
    return fields.rawInput;
  }

  it.each([
    ["a tag", { mode: "tags" as const, preset: { tags: ["open house"] } }, { tags: ["open house"] }],
    ["Today", { mode: "today" as const }, { scheduledDate: todayIso() }],
    ["a project", { mode: "all" as const, projectPath: "Work.md" }, { destination: "Work.md" }]
  ])("starts with an empty title and %s on the buttons, not in the text, with the cursor at the start", (_name, options, context) => {
    const input = opened(options);
    expect(input.value).toBe("");
    expect(input.setSelectionRange).toHaveBeenLastCalledWith(0, 0);
    input.value = "Call Sam";
    expect(lastOpened!.readRaw()).toMatchObject({ title: "Call Sam", ...context });
  });

  it("keeps batch input for a new task: more lines become its subtasks and notes, the first line taking the context", () => {
    const input = opened({ mode: "tags", preset: { tags: ["home"] } });
    input.value = "Plan the party p1\n  - [ ] Book the hall\n  - Guests: 20";
    expect(lastOpened!.readRaw()).toMatchObject({ title: "Plan the party", priority: 1, tags: ["home"], additionalLines: ["  - [ ] Book the hall", "  - Guests: 20"] });
  });

  it("stays empty without any context", () => {
    expect(opened({ mode: "inbox" }).value).toBe("");
  });
});
