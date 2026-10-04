// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { setTagFormat } from "../src/task-tags";
import { installObsidianDom } from "./helpers/obsidian-dom";
import { animateCardClose, animateCardOpen, cardNotes, renderThingsTaskCard, typedTags, type TaskCardOptions } from "../src/things-task-card";
import { descriptionLines } from "../src/task-description";
import { scanTasks } from "../src/parser";

beforeAll(() => {
  installObsidianDom();
  const fragment = Object.getPrototypeOf(document.createDocumentFragment()) as Record<string, unknown>;
  const patched = DocumentFragment.prototype as unknown as Record<string, unknown>;
  for (const key of ["createEl", "createDiv", "createSpan"]) fragment[key] ??= patched[key];
});
// Saturday, Sep 19 2026.
const now = new Date(2026, 8, 19, 12);

function card(markdown: string, overrides: Partial<TaskCardOptions> = {}) {
  const [task, ...rest] = scanTasks("Note.md", markdown, now);
  const parent = document.body.createDiv();
  const options: TaskCardOptions = {
    task, depth: 0, now, tags: task.tags ?? [], children: rest.filter(child => child.parentId === task.id),
    draft: { title: task.title, notes: cardNotes(task.description) },
    change: vi.fn(), toggle: vi.fn(), edit: vi.fn(), collapse: vi.fn(), renameChild: vi.fn(), addChild: vi.fn(), ...overrides
  };
  const element = renderThingsTaskCard(parent, options);
  return { element, options, task };
}

describe("card opening animation", () => {
  it("grows the card out of its row over 200ms and fades its details in", () => {
    const { element } = card("- [ ] Task 1\n  - Notes");
    const animate = vi.fn();
    for (const node of [element, ...Array.from(element.children)]) (node as HTMLElement).animate = animate;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
    animateCardOpen(element, 24);
    const [keyframes, timing] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(timing.duration).toBe(200);
    expect([keyframes[0].height, keyframes[1].height]).toEqual(["24px", "180px"]);
    expect(keyframes[0].backgroundColor).toBe("transparent");
    // The card itself, then every part below the title line.
    expect(animate).toHaveBeenCalledTimes(1 + Array.from(element.children).filter(child => !child.classList.contains("tm-things-card-head")).length);
  });

  it("closes in reverse over 200ms, holding the closed look until the rows replace it", async () => {
    const { element } = card("- [ ] Task 1\n  - Notes");
    const animate = vi.fn(() => ({ finished: Promise.resolve() }));
    for (const node of [element, ...Array.from(element.children)]) (node as HTMLElement).animate = animate as unknown as HTMLElement["animate"];
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
    await animateCardClose(element, 72);
    const cardCall = (animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][]).find(([frames]) => "height" in frames[0])!;
    expect([cardCall[0][0].height, cardCall[0][1].height]).toEqual(["180px", "72px"]);
    expect(cardCall[0][1].backgroundColor).toBe("transparent");
    expect(cardCall[1]).toMatchObject({ duration: 200, fill: "forwards" });
  });

  it("opens instantly when the system asks for reduced motion", () => {
    const { element } = card("- [ ] Task 1");
    const animate = vi.fn();
    element.animate = animate;
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    animateCardOpen(element, 24);
    expect(animate).not.toHaveBeenCalled();
    matchMedia.mockRestore();
  });
});

describe("card notes", () => {
  it("shows top-level bullets as plain lines and saves them back as bullets", () => {
    expect(cardNotes("- First\n- Second\n  - Nested\n- [ ] A checkbox line")).toBe("First\nSecond\n  - Nested\n- [ ] A checkbox line");
    expect(descriptionLines(cardNotes("- First\n- Second"), 0)).toEqual(descriptionLines("- First\n- Second", 0));
  });
});

describe("the card's project button", () => {
  it("names the task's note at the toolbar's left and opens the project list from itself", () => {
    const choose = vi.fn();
    const { element } = card("- [ ] Task 1 2026-09-19 #[[Errand]] {2026-09-30} p1 every week", { project: { label: "Autumn Open House", choose } });
    const toolbar = element.querySelector<HTMLElement>(".tm-things-card-toolbar")!;
    const button = toolbar.firstElementChild as HTMLElement;
    expect(button.className).toBe("tm-things-card-project");
    expect(button.textContent).toBe("Autumn Open House");
    button.click();
    expect(choose).toHaveBeenCalledExactlyOnceWith(button);
  });
});

describe("adding tags in the card", () => {
  it("reads typed tags without their marks", () => {
    expect(typedTags(" #errand, [[Office]] ,, errand ")).toEqual(["errand", "Office"]);
  });

  it("turns the + pill after the tags into an input that adds on Enter, with no autocomplete list", () => {
    const addTags = vi.fn();
    const { element } = card("- [ ] Task 1 #[[Errand]]", { addTags, tagSuggestions: ["Errand", "Office"] });
    const pills = element.querySelector<HTMLElement>(".tm-things-card-tags")!;
    expect(Array.from(pills.children).map(child => child.className)).toEqual(["tm-things-card-tag", "tm-things-card-tag tm-things-add-tag"]);
    pills.querySelector<HTMLElement>(".tm-things-add-tag")!.click();
    const input = pills.querySelector<HTMLInputElement>(".tm-things-add-tag input")!;
    expect(element.ownerDocument.activeElement).toBe(input);
    expect(input.hasAttribute("list")).toBe(false);
    expect(pills.querySelector("datalist")).toBeNull();
    input.value = "Office, #Calls";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(addTags).toHaveBeenCalledExactlyOnceWith(["Office", "Calls"]);
    // The pill is back, ready for another.
    expect(pills.querySelector("input")).toBeNull();
    expect(pills.querySelector(".tm-things-add-tag")).not.toBeNull();
  });

  it("opens the tag list from the input's dropdown button, checking the task's tags", () => {
    const addTags = vi.fn(), removeTag = vi.fn();
    const { element } = card("- [ ] Task 1 #[[Errand]]", { addTags, removeTag, tagSuggestions: ["Errand", "Office"] });
    element.querySelector<HTMLElement>(".tm-things-add-tag")!.click();
    const input = element.querySelector<HTMLInputElement>(".tm-things-add-tag input")!;
    input.value = "Off";
    element.querySelector<HTMLElement>(".tm-things-add-tag-menu")!.click();
    // The typed text becomes the list's search, and is not added as a tag.
    expect(addTags).not.toHaveBeenCalled();
    expect(element.querySelector(".tm-things-add-tag input")).toBeNull();
    const popover = document.querySelector<HTMLElement>(".tm-tags-popover")!;
    expect(popover.querySelector<HTMLInputElement>("input")!.value).toBe("Off");
    const option = (name: string) => Array.from(popover.querySelectorAll<HTMLElement>("[role=option]")).find(item => item.getAttribute("data-value") === name);
    expect(option("Errand")).toBeUndefined();
    option("Office")!.click();
    expect(addTags).toHaveBeenCalledExactlyOnceWith(["Office"]);
    const search = popover.querySelector<HTMLInputElement>("input")!;
    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(option("Errand")!.getAttribute("aria-selected")).toBe("true");
    option("Errand")!.click();
    expect(removeTag).toHaveBeenCalledExactlyOnceWith("Errand");
    popover.remove();
  });

  it("opens a tag's view from its pill, and removes it from the cross shown on hover", () => {
    const openTag = vi.fn(), removeTag = vi.fn(), edit = vi.fn();
    const { element } = card("- [ ] Task 1 #[[Errand]] #[[Office]]", { openTag, removeTag, edit });
    const pills = Array.from(element.querySelectorAll<HTMLElement>(".tm-things-card-tags > .tm-things-card-tag:not(.tm-things-add-tag)"));
    expect(pills.map(pill => pill.textContent)).toEqual(["Errand", "Office"]);
    pills[1].click();
    expect(openTag).toHaveBeenCalledExactlyOnceWith("Office");
    const cross = pills[0].querySelector<HTMLElement>(".tm-things-tag-remove")!;
    expect(cross.getAttribute("aria-label")).toBe("Remove tag Errand");
    cross.click();
    expect(removeTag).toHaveBeenCalledExactlyOnceWith("Errand");
    // The cross does not also open the tag.
    expect(openTag).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
  });

  it("puts the pill back without adding on Escape", () => {
    const addTags = vi.fn();
    const { element } = card("- [ ] Task 1 #[[Errand]]", { addTags });
    element.querySelector<HTMLElement>(".tm-things-add-tag")!.click();
    const input = element.querySelector<HTMLInputElement>(".tm-things-add-tag input")!;
    input.value = "Nope";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(addTags).not.toHaveBeenCalled();
    expect(element.querySelector(".tm-things-add-tag input")).toBeNull();
  });

  it("opens the tag input from the Tags button when the task has none, instead of the editor", () => {
    const addTags = vi.fn(), edit = vi.fn();
    const { element } = card("- [ ] Task 1", { addTags, edit });
    element.querySelector<HTMLElement>('.tm-things-card-toolbar [aria-label="Tags"]')!.click();
    const input = element.querySelector<HTMLInputElement>(".tm-things-card-properties .tm-things-card-tags .tm-things-add-tag input")!;
    expect(element.ownerDocument.activeElement).toBe(input);
    expect(edit).not.toHaveBeenCalled();
    input.value = "Errand";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(addTags).toHaveBeenCalledExactlyOnceWith(["Errand"]);
  });
});

describe("Things task card", () => {
  it("shows each subtask's properties as its row would", () => {
    const edit = vi.fn();
    const { element } = card("- [ ] Task 1\n  - [ ] Subtask 2026-09-19 {2026-09-30} #[[Errand]]", {
      childDetails: () => ({ grouping: "none", dateFormat: "MMM D, YYYY", tags: ["Errand"], now, edit, openSource: vi.fn() })
    });
    const item = element.querySelector<HTMLElement>(".tm-things-card-check")!;
    expect(Array.from(item.children).map(child => child.className)).toEqual(
      ["tm-things-card-check-box", "tm-things-lead", "tm-things-card-check-title", "tm-things-tag is-long", "tm-things-trailing"]);
    expect(item.querySelector(".tm-things-lead .tm-things-today")).not.toBeNull();
    item.querySelector<HTMLElement>(".tm-things-deadline")!.click();
    expect(edit).toHaveBeenCalledWith("deadline");
  });

  it("edits title and notes in place and lists subtasks as a checklist", () => {
    const { element, options } = card("- [ ] Task 1 2026-09-19 {2026-09-30} #[[Errand]] #[[Office]]\n  - Some notes\n  - [ ] Subtask\n  - [x] Another subtask");
    const title = element.querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    const notes = element.querySelector<HTMLTextAreaElement>(".tm-things-card-notes")!;
    expect(title.value).toBe("Task 1");
    expect(notes.value).toBe("Some notes");
    expect(Array.from(element.querySelectorAll<HTMLInputElement>(".tm-things-card-check-title")).map(item => item.value)).toEqual(["Subtask", "Another subtask"]);
    title.value = "Task one";
    title.dispatchEvent(new Event("input"));
    expect(options.change).toHaveBeenLastCalledWith({ title: "Task one", notes: "Some notes" });
    element.querySelectorAll<HTMLInputElement>(".tm-things-card-check-box")[0].click();
    expect(options.toggle).toHaveBeenCalledWith(options.children[0], true);
  });

  it("shows set properties as lines that open their editor, and offers the rest in the toolbar", () => {
    const { element, options } = card("- [ ] Task 1 2026-09-19 {2026-09-30} #[[Errand]]");
    expect(Array.from(element.querySelectorAll(".tm-things-card-tag")).map(tag => tag.textContent)).toEqual(["Errand"]);
    const lines = Array.from(element.querySelectorAll<HTMLElement>(".tm-things-card-property"));
    expect(lines.map(line => line.textContent)).toEqual(["Today", "Deadline: Wed, Sep 3011 days left"]);
    lines[1].click();
    expect(options.edit).toHaveBeenCalledWith("deadline");
    expect(Array.from(element.querySelectorAll(".tm-things-card-toolbar button")).map(button => button.getAttribute("aria-label"))).toEqual(["Checklist", "Priority", "Repeat"]);
    element.querySelector<HTMLElement>('[aria-label="Priority"]')!.click();
    expect(options.edit).toHaveBeenLastCalledWith("priority");
  });

  it("puts the scheduled time on the same line as its date, as the deadline's time is", () => {
    const lines = (markdown: string) => Array.from(card(markdown).element.querySelectorAll(".tm-things-card-property")).map(line => line.textContent);
    expect(lines("- [ ] Task 1 2026-09-17 09:45 90m {2026-09-30 17:30}")).toEqual(["Thu, Sep 17, 9:45-11:15 AM", "Deadline: Wed, Sep 30, 5:30 PM11 days left"]);
    expect(lines("- [ ] Task 1 2026-10-08 10:00")).toEqual(["Thu, Oct 8, 10:00 AM"]);
    // A duration without a date keeps its own line.
    expect(lines("- [ ] Task 1 30m")).toEqual(["30m"]);
  });

  it("shows a set priority as a line that opens the priority editor, in place of the toolbar button", () => {
    const { element, options } = card("- [ ] Task 1 p2");
    const line = element.querySelector<HTMLElement>(".tm-things-card-property.is-p2")!;
    expect(line.textContent).toBe("Medium priorityP2");
    line.click();
    expect(options.edit).toHaveBeenCalledWith("priority");
    expect(element.querySelector('[aria-label="Priority"]')).toBeNull();
  });

  it("renames a subtask in place, and Enter starts a new subtask right below it", () => {
    const { element, options } = card("- [ ] Task 1\n  - [ ] One\n  - [ ] Two");
    const [one] = options.children;
    const name = element.querySelector<HTMLInputElement>(`[data-tm-focus-key="card-subtask:${one.id}"]`)!;
    name.focus();
    name.value = "One renamed";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(options.renameChild).toHaveBeenCalledExactlyOnceWith(one, "One renamed");
    // A blank subtask opens between One and Two, focused.
    const rows = Array.from(element.querySelectorAll(".tm-things-card-check"));
    expect(rows.map(row => row.classList.contains("is-new"))).toEqual([false, true, false]);
    const input = rows[1].querySelector<HTMLInputElement>(".tm-things-card-check-title")!;
    expect(element.ownerDocument.activeElement).toBe(input);
    input.value = "One and a half";
    input.dispatchEvent(new Event("input"));
    expect(options.change).toHaveBeenLastCalledWith(expect.objectContaining({ subtask: { after: one.id, text: "One and a half" } }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(options.addChild).toHaveBeenCalledExactlyOnceWith("One and a half", one, true);
    expect(element.querySelector(".is-new")).toBeNull();
  });

  it("starts the first subtask from the Checklist button, and an empty one just goes away", () => {
    const { element, options } = card("- [ ] Task 1");
    element.querySelector<HTMLElement>('[aria-label="Checklist"]')!.click();
    const input = element.querySelector<HTMLInputElement>(".is-new .tm-things-card-check-title")!;
    expect(element.ownerDocument.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(options.addChild).not.toHaveBeenCalled();
    expect(element.querySelector(".is-new")).toBeNull();
  });

  it("keeps a subtask being typed across a redraw: Mod+Enter saves it with the card, Escape keeps nothing", () => {
    const draft = { title: "Task 1", notes: "", subtask: { text: "Half typed" } };
    const first = card("- [ ] Task 1", { draft, focus: "new", cancel: vi.fn() });
    const input = first.element.querySelector<HTMLInputElement>(".is-new .tm-things-card-check-title")!;
    expect(input.value).toBe("Half typed");
    expect(first.element.ownerDocument.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    input.dispatchEvent(new Event("blur"));
    expect(first.options.cancel).toHaveBeenCalledOnce();
    expect(first.options.addChild).not.toHaveBeenCalled();
    expect(first.options.collapse).not.toHaveBeenCalled();
    const second = card("- [ ] Task 1", { draft, focus: "new", cancel: vi.fn() });
    second.element.querySelector(".is-new .tm-things-card-check-title")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(second.options.addChild).toHaveBeenCalledExactlyOnceWith("Half typed", undefined, false);
    expect(second.options.collapse).toHaveBeenCalledOnce();
  });

  it("confirms on Enter in the title or the notes (Shift+Enter starts a line of notes), and cancels on Escape", () => {
    const { element, options } = card("- [ ] Task 1", { cancel: vi.fn() });
    const title = element.querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    const notes = element.querySelector<HTMLTextAreaElement>(".tm-things-card-notes")!;
    const key = (target: HTMLElement, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    key(title, { key: "Enter" });
    expect(options.collapse).toHaveBeenCalledOnce();
    expect(key(notes, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(false);
    expect(options.collapse).toHaveBeenCalledOnce();
    key(notes, { key: "Enter" });
    expect(options.collapse).toHaveBeenCalledTimes(2);
    key(notes, { key: "Escape" });
    expect(options.cancel).toHaveBeenCalledOnce();
    expect(options.collapse).toHaveBeenCalledTimes(2);
  });
});

describe("the card title's highlight", () => {
  it("marks what typing into the title will set, behind the text", () => {
    const { element } = card("- [ ] Call mom", { dateFormat: "YYYY-MM-DD" });
    const title = element.querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    const layer = element.querySelector<HTMLElement>(".tm-things-card-title-backdrop")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelector(".tm-nlp-token")).toBeNull();
    title.value = "Call mom friday p1 #[[home]]";
    title.dispatchEvent(new Event("input"));
    expect(Array.from(layer.querySelectorAll(".tm-nlp-token")).map(mark => mark.textContent)).toEqual(["friday", "p1", "#[[home]]"]);
    expect(layer.textContent).toBe("Call mom friday p1 #[[home]] ");
  });
});

describe("the card's properties while typing its title", () => {
  it("show what tokens typed into the title set, before saving", () => {
    const { element } = card("- [ ] Call mom", { dateFormat: "YYYY-MM-DD", project: { label: "Inbox", choose: vi.fn() } });
    const toolbar = () => Array.from(element.querySelectorAll(".tm-things-card-toolbar .clickable-icon")).map(button => button.getAttribute("aria-label"));
    const lines = () => Array.from(element.querySelectorAll(".tm-things-card-property .tm-things-card-label")).map(label => label.textContent);
    expect(toolbar()).toEqual(["When", "Tags", "Checklist", "Priority", "Repeat", "Deadline"]);
    const title = element.querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    title.value = "Call mom p1 {2027-03-05} #[[home]] ~[[Work]]";
    title.dispatchEvent(new Event("input"));
    expect(lines()).toEqual(["High priority", "Deadline: Fri, Mar 5, 2027"]);
    expect(Array.from(element.querySelectorAll(".tm-things-card-tags .tm-things-card-tag:not(.tm-things-add-tag)")).map(tag => tag.textContent)).toEqual(["home"]);
    expect(toolbar()).toEqual(["When", "Checklist", "Repeat"]);
    expect(element.querySelector(".tm-things-card-project-label")!.textContent).toBe("Work");
    expect(element.querySelector(".tm-things-card-head .tm-task-checkbox")!.classList.contains("is-p1")).toBe(true);
    // Taking the tokens out again puts the card back.
    title.value = "Call mom";
    title.dispatchEvent(new Event("input"));
    expect(lines()).toEqual([]);
    expect(toolbar()).toEqual(["When", "Tags", "Checklist", "Priority", "Repeat", "Deadline"]);
    expect(element.querySelector(".tm-things-card-project-label")!.textContent).toBe("Inbox");
  });
});

describe("#tag tags in the card title", () => {
  afterEach(() => setTagFormat("wikilink"));
  it("marks them as tags and shows them among the card's tags while typing", () => {
    setTagFormat("hash");
    const { element } = card("- [ ] Call mom", { dateFormat: "YYYY-MM-DD" });
    const title = element.querySelector<HTMLTextAreaElement>(".tm-things-card-title")!;
    title.value = "Call mom #family";
    title.dispatchEvent(new Event("input"));
    expect(Array.from(element.querySelectorAll(".tm-things-card-title-backdrop .tm-nlp-token.is-tag")).map(mark => mark.textContent)).toEqual(["#family"]);
    expect(Array.from(element.querySelectorAll(".tm-things-card-tags .tm-things-card-tag:not(.tm-things-add-tag)")).map(tag => tag.textContent)).toEqual(["family"]);
  });
});

describe("a recurring task's card", () => {
  it("shows the repeat icon as the checkbox, which still toggles the task", () => {
    const { element, options, task } = card("- [ ] Water every week p1", { repeating: true });
    const target = element.querySelector<HTMLElement>(".tm-things-card-head > .tm-repeat-target")!;
    expect(target.classList.contains("is-p1")).toBe(true);
    expect(target.querySelector(".tm-repeat-icon")).not.toBeNull();
    target.querySelector<HTMLInputElement>("input.tm-task-checkbox")!.click();
    expect(options.toggle).toHaveBeenCalledWith(task, true);
    expect(card("- [ ] Call").element.querySelector(".tm-repeat-target")).toBeNull();
  });
});
