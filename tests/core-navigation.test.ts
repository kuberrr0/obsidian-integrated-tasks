import { expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", () => ({ ItemView: class {}, Notice: class {}, setIcon: vi.fn() }));
import { TaskNavigationView } from "../src/navigation-view";
import type TaskManagerPlugin from "../src/main";

const doc = { activeElement: null as FakeElement | null };

class FakeElement extends EventTarget {
  children: FakeElement[] = [];
  parent?: FakeElement;
  attrs: Record<string, string> = {};
  text = "";
  cls = "";
  scrollTop = 0;
  disabled = false;
  ownerDocument = doc;
  classList = { toggle: () => {} };
  createEl(_tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): FakeElement {
    const child = new FakeElement();
    Object.assign(child, { text: options.text ?? "", cls: options.cls ?? "", attrs: { ...options.attr }, parent: this });
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  // Emptying a scroll container clamps its scroll position, as in a browser.
  empty() { this.children = []; this.scrollTop = 0; }
  addClass() {}
  prepend(child: FakeElement) {
    if (child.parent) child.parent.children = child.parent.children.filter(element => element !== child);
    child.parent = this;
    this.children.unshift(child);
  }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  contains(element: FakeElement) {
    for (let node: FakeElement | undefined = element; node; node = node.parent) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector: string) { return this.all().filter(element => selector.slice(1, -1) in element.attrs); }
  focus() { doc.activeElement = this; }
  all(): FakeElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  byKey(key: string) { return this.all().find(element => element.attrs["data-tm-nav-key"] === key)!; }
}

const bubble = (target: FakeElement, event: Event): void => {
  Object.defineProperty(event, "target", { value: target, configurable: true });
  for (let node: FakeElement | undefined = target; node && !event.cancelBubble; node = node.parent) node.dispatchEvent(event);
};

function setup() {
  let listener: () => void = () => {};
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  const win = {
    requestAnimationFrame: vi.fn((callback: () => void) => { frames.set(nextFrame, callback); return nextFrame++; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); })
  };
  const runFrames = () => { const pending = [...frames.values()]; frames.clear(); for (const run of pending) run(); };
  const tagSummaries = vi.fn(() => [{ name: "work", openTasks: 1, completedTasks: 0 }]);
  const plugin = {
    settings: { taskMode: false, smartLists: [] },
    index: { subscribe: (callback: () => void) => { listener = callback; return () => { listener = () => {}; }; }, projects: () => [], tagSummaries, query: () => [] }
  } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({} as WorkspaceLeaf, plugin);
  const content = new FakeElement();
  Object.assign(view, {
    containerEl: { children: [new FakeElement(), content], win },
    app: { workspace: { getActiveViewOfType: () => null, on: () => ({}) } } as unknown as App,
    registerEvent: vi.fn(), registerDomEvent: vi.fn()
  });
  const render = vi.spyOn(view as unknown as { render(): void }, "render");
  return { view, content, win, runFrames, render, tagSummaries, emit: () => listener() };
}

it("coalesces index updates into one render per frame and cancels a pending frame on close", async () => {
  const { view, win, runFrames, render, emit } = setup();
  await view.onOpen();
  render.mockClear();
  emit(); emit(); emit();
  expect(win.requestAnimationFrame).toHaveBeenCalledOnce();
  expect(render).not.toHaveBeenCalled();
  runFrames();
  expect(render).toHaveBeenCalledOnce();
  emit();
  // A direct render (for example, a selection change) supersedes the queued frame.
  view.refresh();
  expect(win.cancelAnimationFrame).toHaveBeenCalledOnce();
  runFrames();
  expect(render).toHaveBeenCalledTimes(2);
  emit();
  await view.onClose();
  expect(win.cancelAnimationFrame).toHaveBeenCalledTimes(2);
  runFrames();
  expect(render).toHaveBeenCalledTimes(2);
});

it("keeps keyboard focus across re-renders and roves focus within the toolbar", async () => {
  const { view, content, runFrames, tagSummaries, emit } = setup();
  await view.onOpen();
  view.setActive("tags", "work");
  expect(tagSummaries).toHaveBeenCalled();
  expect(content.byKey("tag:work").text).toBe("work");
  const toolbar = () => content.all().filter(element => element.attrs["data-tm-nav-key"]?.startsWith("action:"));
  expect(toolbar().map(button => button.attrs.tabindex)).toEqual(["0", "-1", "-1"]);
  const press = (key: string) => bubble(doc.activeElement!, Object.assign(new Event("keydown", { cancelable: true }), { key }));
  toolbar()[0].focus();
  press("ArrowRight");
  expect(doc.activeElement).toBe(toolbar()[1]);
  press("End");
  expect(doc.activeElement).toBe(toolbar()[2]);
  press("ArrowRight");
  expect(doc.activeElement).toBe(toolbar()[0]);
  press("ArrowLeft");
  expect(doc.activeElement).toBe(toolbar()[2]);
  expect(toolbar().map(button => button.attrs.tabindex)).toEqual(["-1", "-1", "0"]);
  // The toolbar's tab stop and the focused element survive an index-driven re-render.
  emit(); runFrames();
  expect(toolbar().map(button => button.attrs.tabindex)).toEqual(["-1", "-1", "0"]);
  expect(doc.activeElement).toBe(toolbar()[2]);
  const tag = content.byKey("tag:work");
  tag.focus();
  content.scrollTop = 120;
  emit(); runFrames();
  expect(content.byKey("tag:work")).not.toBe(tag);
  expect(doc.activeElement).toBe(content.byKey("tag:work"));
  expect(content.scrollTop).toBe(120);
});
