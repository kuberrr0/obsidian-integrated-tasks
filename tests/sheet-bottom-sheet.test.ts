// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  class Modal {
    containerEl = document.createElement("div");
    modalEl = this.containerEl.createDiv({ cls: "modal" });
    contentEl = this.modalEl.createDiv({ cls: "modal-content" });
    constructor(public app: unknown) {}
    open(): void { document.body.appendChild(this.containerEl); (this as unknown as { onOpen(): void }).onOpen(); }
    close(): void { (this as unknown as { onClose(): void }).onClose(); this.containerEl.remove(); }
  }
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Modal, Notice: class {}, setIcon: vi.fn(), Platform: { isMobile: false, isPhone: false } };
});
vi.mock("../src/task-line-editor", async original => ({
  ...await original<typeof import("../src/task-line-editor")>(),
  TaskLineEditor: class {
    value: string;
    defaultValue: string;
    focus = vi.fn();
    setSelectionRange = vi.fn();
    destroy = vi.fn();
    constructor(host: HTMLElement, value: string) { this.value = this.defaultValue = value; host.createEl("textarea", { cls: "tm-editor-raw" }); }
  }
}));

import { Platform, type App } from "obsidian";
import { TaskEditorModal } from "../src/task-editor";
import { presentAsBottomSheet } from "../src/mobile-layout";
import { DEFAULT_SETTINGS } from "../src/types";

beforeAll(() => installObsidianDom());
afterEach(() => {
  (Platform as { isPhone: boolean }).isPhone = false;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const narrow = (matches: boolean) => vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: matches && query === "(max-width: 600px)", media: query } as MediaQueryList));
const taskEditor = () => new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: DEFAULT_SETTINGS, dateFormat: "YYYY-MM-DD", onSave: async () => {} });

function pointer(target: EventTarget, type: string, clientY: number, pointerId = 1): void {
  target.dispatchEvent(new PointerEvent(type, { pointerId, clientY, button: 0, pointerType: "touch", bubbles: true }));
}

describe("bottom sheet presentation", () => {
  it.each([
    ["task", taskEditor]
  ] as const)("presents the %s editor as a bottom sheet on narrow windows and on mobile, not on desktop", (_name, create) => {
    narrow(false);
    const desktop = create();
    desktop.open();
    expect(desktop.modalEl.classList.contains("tm-bottom-sheet")).toBe(false);
    expect(desktop.containerEl.classList.contains("tm-bottom-sheet-container")).toBe(false);
    desktop.close();

    (Platform as { isPhone: boolean }).isPhone = true;
    const mobile = create();
    mobile.open();
    expect(mobile.modalEl.classList.contains("tm-bottom-sheet")).toBe(true);
    expect(mobile.containerEl.classList.contains("tm-bottom-sheet-container")).toBe(true);
    // Keyboard tracking still applies alongside the sheet.
    expect(mobile.containerEl.classList.contains("tm-editor-container")).toBe(true);
    // On phones it hangs from the top of the screen.
    expect(mobile.modalEl.classList.contains("is-top")).toBe(true);
    expect(mobile.containerEl.classList.contains("is-top")).toBe(true);
    mobile.close();
    expect(mobile.modalEl.classList.contains("tm-bottom-sheet")).toBe(false);

    (Platform as { isPhone: boolean }).isPhone = false;
    vi.restoreAllMocks();
    narrow(true);
    const small = create();
    small.open();
    expect(small.modalEl.classList.contains("tm-bottom-sheet")).toBe(true);
    expect(small.modalEl.classList.contains("is-top")).toBe(false);
    small.close();
  });
});

describe("swipe down to dismiss", () => {
  function sheet() {
    narrow(true);
    const modal = taskEditor();
    const close = vi.spyOn(modal, "close");
    modal.open();
    return { modal, close, el: modal.modalEl };
  }

  it("closes after dragging the handle down more than 80px, moving the sheet with the finger", () => {
    const { close, el } = sheet();
    pointer(el, "pointerdown", 10);
    pointer(el, "pointermove", 60);
    expect(el.style.transform).toBe("translateY(50px)");
    pointer(el, "pointerup", 60);
    expect(close).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("");
    pointer(el, "pointerdown", 10);
    pointer(el, "pointermove", 120);
    pointer(el, "pointerup", 120);
    expect(close).toHaveBeenCalledOnce();
  });

  it("ignores drags that start in a text field, below the handle, or are cancelled", () => {
    const { close, el, modal } = sheet();
    const input = modal.contentEl.querySelector("textarea")!;
    pointer(input, "pointerdown", 10);
    pointer(el, "pointerup", 200);
    pointer(el, "pointerdown", 50);
    pointer(el, "pointerup", 200);
    pointer(el, "pointerdown", 10);
    pointer(el, "pointercancel", 200);
    pointer(el, "pointerup", 200);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes a sheet at the top after dragging its bottom handle up more than 80px", () => {
    narrow(true);
    const modal = document.body.createDiv();
    vi.spyOn(modal, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 400 } as DOMRect);
    const close = vi.fn();
    presentAsBottomSheet(modal, close, true);
    pointer(modal, "pointerdown", 100);
    pointer(modal, "pointerup", 0);
    expect(close).not.toHaveBeenCalled();
    pointer(modal, "pointerdown", 390);
    pointer(modal, "pointermove", 340);
    expect(modal.style.transform).toBe("translateY(-50px)");
    pointer(modal, "pointerup", 290);
    expect(close).toHaveBeenCalledOnce();
  });

  it("stops listening once removed", () => {
    narrow(true);
    const modal = document.body.createDiv();
    const close = vi.fn();
    const stop = presentAsBottomSheet(modal, close);
    stop();
    pointer(modal, "pointerdown", 10);
    pointer(modal, "pointerup", 200);
    expect(close).not.toHaveBeenCalled();
    expect(modal.classList.contains("tm-bottom-sheet")).toBe(false);
  });
});
