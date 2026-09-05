import { expect, it, vi } from "vitest";
import { trackModalViewport } from "../src/mobile-layout";

it("tracks keyboard viewport changes, reveals focused fields, and cleans up on close", () => {
  const viewport = Object.assign(new EventTarget(), { height: 700, offsetTop: 0 });
  let pending: (() => void) | undefined;
  const win = Object.assign(new EventTarget(), {
    visualViewport: viewport, innerHeight: 700,
    requestAnimationFrame: (callback: () => void) => { pending = callback; return 1; },
    cancelAnimationFrame: vi.fn(), matchMedia: () => ({ matches: true })
  });
  const values = new Map<string, string>();
  const container = {
    classList: { add: vi.fn(), remove: vi.fn() },
    style: { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) }
  };
  const field = { getBoundingClientRect: () => ({ top: 300, bottom: 344 }) };
  const content = Object.assign(new EventTarget(), {
    contains: () => true, scrollTop: 0, getBoundingClientRect: () => ({ top: 20, bottom: 280 })
  });
  const modal = { parentElement: container, ownerDocument: { defaultView: win, activeElement: field, body: { classList: { contains: () => true } } } };
  const stop = trackModalViewport(modal as unknown as HTMLElement, content as unknown as HTMLElement);
  expect(values.get("--tm-viewport-height")).toBe("700px");
  viewport.height = 420;
  viewport.offsetTop = 15;
  viewport.dispatchEvent(new Event("resize"));
  pending?.();
  expect(values.get("--tm-viewport-height")).toBe("420px");
  expect(values.get("--tm-viewport-top")).toBe("15px");
  expect(content.scrollTop).toBe(76);
  stop();
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  win.dispatchEvent(new Event("resize"));
  content.dispatchEvent(new Event("focusin"));
  expect(values.size).toBe(0);
  expect(container.classList.remove).toHaveBeenCalledWith("tm-editor-container");
  expect(win.cancelAnimationFrame).toHaveBeenCalledWith(1);
});
