import { afterEach, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { ListDragController } from "../src/list-drag-view";
import { scanTasks } from "../src/parser";
class Element {
  listeners = new Map<string, Array<(event: any) => void>>();
  draggable = false;
  style: Record<string, string> = {};
  parentElement = { appendChild: vi.fn() };
  remove = vi.fn();
  cloneNode = vi.fn(() => new Element());
  ownerDocument = { elementFromPoint: (): Element | null => null };
  createEl(): Element { return new Element(); }
  prepend(): void {}
  addClass(): void {}
  removeClass(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}
  closest(): unknown { return undefined; }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  getBoundingClientRect() { return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: 300, height: 40 }; }
  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  fire(type: string, options: Record<string, unknown> = {}) {
    const event = { target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), ...options };
    this.listeners.get(type)?.forEach(listener => listener(event));
    return event;
  }
}
afterEach(() => vi.unstubAllGlobals());
it.each(["title", "body", "metadata"])("drags an unselected task from its %s and suppresses the post-drag edit click", surface => {
  vi.stubGlobal("HTMLElement", Element);
  const [task, anchor] = scanTasks("Work.md", "- [ ] A\n- [ ] B");
  const drop = vi.fn().mockResolvedValue(undefined); const start = vi.fn();
  const controller = new ListDragController(() => undefined, drop, true, start);
  const row = new Element(); const target = new Element();
  row.ownerDocument.elementFromPoint = () => target;
  controller.row(row as never, new Element() as never, task);
  controller.row(target as never, new Element() as never, anchor);
  const title = { closest: () => title };
  const targetSurface = surface === "title" ? title : surface === "body" ? row : { closest: () => undefined };
  row.fire("pointerdown", { target: targetSurface });
  expect(start).not.toHaveBeenCalled();
  row.fire("pointermove", { clientY: 30 });
  expect(start).toHaveBeenCalledExactlyOnceWith(task);
  row.fire("pointerup", { clientY: 30 });
  expect(drop).toHaveBeenCalledExactlyOnceWith(task, undefined, anchor, "after");
  expect(row.draggable).toBe(true);
  expect(row.fire("click").stopImmediatePropagation).toHaveBeenCalledOnce();
});
it("keeps title clicks available if the pointer never starts a drag", () => {
  const [task] = scanTasks("Work.md", "- [ ] A");
  const drop = vi.fn(); const start = vi.fn();
  const controller = new ListDragController(() => undefined, drop, true, start);
  const row = new Element();
  controller.row(row as never, new Element() as never, task);
  row.fire("pointerdown", { target: { closest: () => ({}) } });
  expect(row.fire("pointerup").preventDefault).not.toHaveBeenCalled();
  expect(row.fire("click").preventDefault).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(drop).not.toHaveBeenCalled();
  expect(row.cloneNode).not.toHaveBeenCalled();
});

it.each([true, false])("moves a card preview with the pointer (nesting: %s)", allowNesting => {
  const [task] = scanTasks("Work.md", "- [ ] A");
  const controller = new ListDragController(() => undefined, vi.fn(), allowNesting);
  const row = new Element();
  controller.row(row as never, new Element() as never, task);
  row.fire("pointerdown", { clientX: 15, clientY: 10 });
  row.fire("pointermove", { clientX: 18, clientY: 10 });
  expect(row.cloneNode).not.toHaveBeenCalled();
  row.fire("pointermove", { clientX: 45, clientY: 30 });
  const preview = row.cloneNode.mock.results[0].value;
  expect(row.parentElement.appendChild).toHaveBeenCalledWith(preview);
  expect(preview.style).toEqual({ width: "300px", height: "40px", left: "30px", top: "20px" });
  row.fire("pointermove", { clientX: 100, clientY: 80 });
  expect(row.cloneNode).toHaveBeenCalledOnce();
  expect(preview.style.left).toBe("85px");
  expect(preview.style.top).toBe("70px");
  row.fire("pointerup");
  expect(preview.remove).toHaveBeenCalledOnce();
});

it.each(["pointercancel", "lostpointercapture"])("removes the preview on %s without dropping", event => {
  const [task] = scanTasks("Work.md", "- [ ] A");
  const drop = vi.fn();
  const controller = new ListDragController(() => undefined, drop);
  const row = new Element();
  controller.row(row as never, new Element() as never, task);
  row.fire("pointerdown");
  row.fire("pointermove", { clientY: 30 });
  const preview = row.cloneNode.mock.results[0].value;
  row.fire(event);
  expect(preview.remove).toHaveBeenCalledOnce();
  expect(row.draggable).toBe(true);
  expect(drop).not.toHaveBeenCalled();
});

it("keeps the grabbed point under the cursor inside an offset pane", () => {
  const [task] = scanTasks("Work.md", "- [ ] A");
  const controller = new ListDragController(() => undefined, vi.fn());
  const row = new Element();
  row.getBoundingClientRect = () => ({ left: 350, top: 100, width: 300, height: 40 });
  const preview = new Element();
  preview.getBoundingClientRect = () => ({
    left: (parseFloat(preview.style.left) || 0) + 300,
    top: (parseFloat(preview.style.top) || 0) + 80,
    width: 300, height: 40
  });
  row.cloneNode.mockReturnValue(preview);
  controller.row(row as never, new Element() as never, task);
  row.fire("pointerdown", { clientX: 375, clientY: 110 });
  row.fire("pointermove", { clientX: 425, clientY: 150 });
  expect(preview.getBoundingClientRect()).toMatchObject({ left: 400, top: 140 });
  row.fire("pointermove", { clientX: 475, clientY: 180 });
  expect(preview.getBoundingClientRect()).toMatchObject({ left: 450, top: 170 });
  row.fire("pointerup");
});
