// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  class Modal {
    containerEl = Object.assign(document.createElement("div"), { className: "modal-container" });
    modalEl = this.containerEl.createDiv({ cls: "modal" });
    contentEl = this.modalEl.createDiv({ cls: "modal-content" });
    constructor(public app: unknown) {}
    open(): void { document.body.appendChild(this.containerEl); (this as unknown as { onOpen(): void }).onOpen(); }
    close(): void { (this as unknown as { onClose(): void }).onClose(); this.containerEl.remove(); }
  }
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Modal, Notice: class {}, setIcon: vi.fn(), Platform: { isMobile: false } };
});
// A plain stand-in for the CodeMirror field: setting its value reports a change, as typing does.
vi.mock("../src/task-line-editor", async original => ({
  ...await original<typeof import("../src/task-line-editor")>(),
  TaskLineEditor: class {
    private text: string;
    defaultValue: string;
    focus = vi.fn();
    setSelectionRange = vi.fn();
    destroy = vi.fn();
    constructor(_host: HTMLElement, value: string, _format: string, private readonly change: () => void) { this.text = this.defaultValue = value; }
    get value(): string { return this.text; }
    set value(value: string) { this.text = value; this.change(); }
  }
}));

import type { App } from "obsidian";
import { TaskEditorModal } from "../src/task-editor";
import { todayIso } from "../src/date";
import { scanTasks } from "../src/parser";
import { DEFAULT_SETTINGS, type Project } from "../src/types";

beforeAll(() => installObsidianDom());
// Date labels ("Thu", "Tomorrow") depend on today: a Monday, Sep 28 2026.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 28, 12)); });
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.useRealTimers(); });

const projects: Project[] = [{ path: "Work.md", name: "Work", openTasks: 0, completedTasks: 0, archived: false }];

function open(options: { task?: string; mode?: "inbox" | "today" | "tags"; preset?: object } = {}) {
  vi.stubGlobal("setTimeout", vi.fn());
  const createProject = vi.fn(async (name: string) => `${name}.md`);
  const modal = new TaskEditorModal({} as App, {
    mode: options.mode ?? "inbox", projects, settings: { ...DEFAULT_SETTINGS, inboxPath: "Inbox.md" }, dateFormat: "YYYY-MM-DD", onSave: async () => {},
    task: options.task ? scanTasks("Inbox.md", options.task)[0] : undefined, preset: options.preset, tagSuggestions: ["home", "open house"], createProject
  });
  modal.open();
  const raw = (modal as unknown as { rawInput: { value: string } }).rawInput;
  const buttons = () => Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".tm-editor-property"));
  const labels = () => buttons().map(button => button.textContent);
  const button = (name: string) => buttons().find(item => item.getAttribute("aria-label")!.startsWith(name))!;
  return { modal, raw, labels, button, createProject };
}

describe("property buttons in the task editor", () => {
  it("shows each property's name, or the value the text sets, as the text changes", () => {
    const { raw, labels, button } = open();
    expect(labels()).toEqual(["When", "Deadline", "Priority", "Inbox", "Tags", "Repeat", "To do"]);
    raw.value = "Call mom tomorrow at 3pm {2027-03-05} p1 every week #[[home]] ~[[Work]]";
    expect(labels()).toEqual(["Tomorrow, 3:00 PM", "Mar 5, 2027", "P1", "Work", "home", "Every week", "To do"]);
    expect(button("Priority").classList.contains("is-p1")).toBe(true);
    expect(button("When").classList.contains("is-set")).toBe(true);
  });

  it("shows an existing task's values from its text", () => {
    const { labels } = open({ task: "- [ ] Report [[2026-10-01]] 09:00 1h p2 #[[open house]]" });
    expect(labels().slice(2)).toEqual(["P2", "Inbox", "open house", "Repeat", "To do"]);
    // A time with a duration reads as a range.
    expect(labels()[0]).toBe("Thu, 9:00-10:00 AM");
  });

  it("sets the priority, repeat and project from their popovers, taking a typed token for the same property out", () => {
    const { raw, button, labels, modal } = open();
    raw.value = "Call mom p3";
    button("Priority").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='1']")!.click();
    expect(raw.value).toBe("Call mom");
    expect(labels()[2]).toBe("P1");
    button("Repeat").click();
    const repeat = document.querySelector<HTMLInputElement>(".tm-choice-popover input")!;
    repeat.value = "3 days"; repeat.dispatchEvent(new Event("input"));
    repeat.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(labels()[5]).toBe("Every 3 days");
    button("Project").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='Work.md']")!.click();
    expect(labels()[3]).toBe("Work");
    expect(button("Project").getAttribute("aria-label")).toBe("Project: Work");
    button("Project").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='Inbox.md']")!.click();
    expect(labels()[3]).toBe("Inbox");
    // The text stays the title alone.
    expect(raw.value).toBe("Call mom");
    expect((modal as unknown as { readRaw(): object }).readRaw()).toMatchObject({ title: "Call mom", priority: 1, repeat: "every 3 days", destination: "Inbox.md" });
  });

  it("creates a project named as typed in its search, and moves the task there", async () => {
    const { raw, button, createProject, labels } = open();
    raw.value = "Plan";
    expect(button("Project").getAttribute("aria-label")).toBe("Project: Inbox");
    button("Project").click();
    const search = document.querySelector<HTMLInputElement>(".tm-choice-popover input")!;
    search.value = "Garden"; search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(createProject).toHaveBeenCalledExactlyOnceWith("Garden");
    await vi.waitFor(() => expect(labels()[3]).toBe("Garden"));
    expect(raw.value).toBe("Plan");
  });

  it("sets the date from the date popover, taking words read as a date out, and toggles tags", () => {
    const { raw, button, labels } = open();
    raw.value = "Call mom about dinner tomorrow";
    expect(labels()[0]).toBe("Tomorrow");
    button("When").click();
    document.querySelector<HTMLElement>(`.tm-date-popover [data-date="${todayIso()}"]`)!.click();
    expect(raw.value).toBe("Call mom about dinner");
    expect(labels()[0]).toBe("Today");
    button("Tags").click();
    const option = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(".tm-tags-popover [role=option]")).find(item => item.getAttribute("data-value") === name)!;
    option("open house").click();
    option("home").click();
    expect(labels()[4]).toBe("open house, home");
    option("open house").click();
    expect(labels()[4]).toBe("home");
    expect(raw.value).toBe("Call mom about dinner");
  });

  it("starts a new task in a view's context with an empty title, the context on the buttons", () => {
    const { raw, button, labels } = open({ mode: "tags", preset: { tags: ["home"] } });
    expect(raw.value).toBe("");
    expect(labels()[4]).toBe("home");
    button("Priority").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='2']")!.click();
    expect(raw.value).toBe("");
    expect(labels()[2]).toBe("P2");
  });

  it("opens its popovers inside the modal, where Obsidian lets them keep focus", () => {
    const { modal, button } = open();
    button("When").click();
    const popover = document.querySelector<HTMLElement>(".tm-date-popover")!;
    expect(modal.containerEl.contains(popover)).toBe(true);
    expect(document.activeElement).toBe(popover.querySelector("input"));
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    button("Tags").click();
    expect(modal.containerEl.contains(document.querySelector(".tm-tags-popover"))).toBe(true);
  });

  it("closes an open popover before the modal on Escape", () => {
    const { modal, button } = open();
    button("Priority").click();
    modal.close();
    expect(document.querySelector(".tm-choice-popover")).toBeNull();
    expect(modal.containerEl.isConnected).toBe(true);
    modal.close();
    expect(modal.containerEl.isConnected).toBe(false);
  });
});

describe("editing a task: the title alone, like a card's", () => {
  const save = (modal: TaskEditorModal) => (modal as unknown as { readRaw(): Record<string, unknown> }).readRaw();

  it("shows the title in the field and the task's properties on the buttons", () => {
    const { raw, labels } = open({ task: "- [ ] Report [[2026-10-01]] 09:00 1h {2027-03-05} p2 every week #[[open house]]" });
    expect(raw.value).toBe("Report");
    expect(labels()).toEqual(["Thu, 9:00-10:00 AM", "Mar 5, 2027", "P2", "Inbox", "open house", "Every week", "To do"]);
  });

  it("lets a token typed into the title set its property, tags joining the task's", () => {
    const { modal, raw, labels } = open({ task: "- [ ] Report p2 #[[open house]]" });
    raw.value = "Report p1 #[[home]]";
    expect(labels().slice(2, 5)).toEqual(["P1", "Inbox", "open house, home"]);
    expect(save(modal)).toMatchObject({ title: "Report", priority: 1, tags: ["open house", "home"] });
  });

  it("sets a button's choice directly, taking out a token typed for the same property", () => {
    const { modal, raw, button, labels } = open({ task: "- [ ] Report p2" });
    raw.value = "Report p3";
    button("Priority").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='1']")!.click();
    expect(raw.value).toBe("Report");
    expect(labels()[2]).toBe("P1");
    button("Project").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='Work.md']")!.click();
    expect(raw.value).toBe("Report");
    expect(save(modal)).toMatchObject({ title: "Report", priority: 1, destination: "Work.md" });
    button("Priority").click();
    document.querySelector<HTMLElement>(".tm-choice-popover [data-value='']")!.click();
    expect(save(modal).priority).toBeUndefined();
  });

  it("keeps an untouched title's words, and asks for a title when it is emptied", () => {
    const { modal, raw } = open({ task: "- [ ] Plan for tomorrow p2" });
    expect(save(modal)).toMatchObject({ title: "Plan for tomorrow", priority: 2 });
    expect(save(modal).scheduledDate).toBeUndefined();
    raw.value = "  ";
    expect(() => save(modal)).toThrow("Enter a task title.");
  });
});

describe("the Status button", () => {
  it("comes last, shows the status, and sets it from its list, where S moves on", () => {
    const { modal, button, labels } = open({ task: "- [/] Draft" });
    expect(labels().at(-1)).toBe("In progress");
    expect(button("Status").classList.contains("is-doing")).toBe(true);
    expect(modal.contentEl.querySelector(".tm-editor-checkbox, select")).toBeNull();
    button("Status").click();
    const popover = document.querySelector<HTMLElement>(".tm-choice-popover")!;
    expect(popover.getAttribute("aria-label")).toBe("Status");
    expect(document.activeElement!.getAttribute("data-value")).toBe("doing");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }));
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }));
    expect(document.activeElement!.getAttribute("data-value")).toBe("done");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(labels().at(-1)).toBe("Done");
    expect((modal as unknown as { readRaw(): object }).readRaw()).toMatchObject({ status: "done", completed: true });
  });
});
