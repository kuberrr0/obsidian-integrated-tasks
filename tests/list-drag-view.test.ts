import { afterEach, expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { ListDragController } from "../src/list-drag-view";
import { scanTasks } from "../src/parser";
class Element {
  listeners = new Map<string, Array<(event: any) => void>>();
  draggable = false;
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
  getBoundingClientRect() { return { left: 0, top: 0, height: 40 }; }
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
});
