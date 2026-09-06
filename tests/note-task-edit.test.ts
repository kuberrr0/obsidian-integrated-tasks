import { Platform } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindNoteTaskEdit, handleTaskEditClick } from "../src/note-task-edit";
import { scanTasks } from "../src/parser";

function click(metaKey: boolean, isCheckbox = true) {
  return {
    metaKey, ctrlKey: false, button: 0,
    target: { closest: () => isCheckbox ? {} : null },
    preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()
  };
}

const task = scanTasks("Note.md", "# Tasks\n- [ ] Parent\n  - [x] Child p1")[1];

describe("Mod-click task editing in notes", () => {
  afterEach(() => { Object.assign(Platform, { isMacOS: true }); });

  it.each([
    [true, true, false, true],
    [true, false, true, false],
    [false, false, true, true],
    [false, true, false, false]
  ])("uses the platform modifier (Mac: %s, Command: %s, Control: %s)", (isMacOS, metaKey, ctrlKey, shouldOpen) => {
    Object.assign(Platform, { isMacOS });
    const event = { ...click(metaKey), ctrlKey };
    const open = vi.fn();
    handleTaskEditClick(event as unknown as MouseEvent, () => task, open);
    expect(open).toHaveBeenCalledTimes(shouldOpen ? 1 : 0);
    expect(event.preventDefault).toHaveBeenCalledTimes(shouldOpen ? 1 : 0);
  });
  it("opens the resolved task and blocks the native completion toggle", () => {
    const event = click(true);
    const open = vi.fn();
    handleTaskEditClick(event as unknown as MouseEvent, () => task, open);
    expect(open).toHaveBeenCalledExactlyOnceWith(task);
    expect(task.completed).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it.each([[false, true, task], [true, false, task], [true, true, undefined]] as const)(
    "leaves ordinary clicks, non-checkboxes, and unrecognized tasks alone (%s, %s)",
    (metaKey, isCheckbox, resolved) => {
      const event = click(metaKey, isCheckbox);
      const open = vi.fn();
      handleTaskEditClick(event as unknown as MouseEvent, () => resolved, open);
      expect(open).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    }
  );
});


describe("long press task editing in notes", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const document = new EventTarget();
    const root = Object.assign(new EventTarget(), { ownerDocument: document });
    const checkbox = { isConnected: true, closest: () => checkbox };
    const open = vi.fn();
    const dispose = bindNoteTaskEdit(root as unknown as HTMLElement, () => task, open);
    const send = (type: string, x = 0, count = 1) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperties(event, {
        target: { value: checkbox },
        touches: { value: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: 0 })) },
        button: { value: 0 }
      });
      (type === "touchstart" || type === "click" || type === "contextmenu" ? root : document).dispatchEvent(event);
      return event;
    };
    return { open, dispose, send };
  }

  it("opens after holding and suppresses release and synthetic click", () => {
    const { open, dispose, send } = setup();
    send("touchstart");
    vi.advanceTimersByTime(499);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledExactlyOnceWith(task);
    expect(send("touchend").defaultPrevented).toBe(true);
    expect(send("click").defaultPrevented).toBe(true);
    dispose();
  });

  it("preserves a short tap", () => {
    const { open, dispose, send } = setup();
    send("touchstart");
    vi.advanceTimersByTime(100);
    expect(send("touchend").defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    expect(open).not.toHaveBeenCalled();
    expect(send("click").defaultPrevented).toBe(false);
    dispose();
  });

  it.each(["scroll", "cancel", "multitouch", "unload"])("cancels on %s", action => {
    const { open, dispose, send } = setup();
    send("touchstart");
    if (action === "scroll") send("touchmove", 20);
    if (action === "cancel") send("touchcancel");
    if (action === "multitouch") send("touchstart", 0, 2);
    if (action === "unload") dispose();
    vi.advanceTimersByTime(600);
    expect(open).not.toHaveBeenCalled();
    dispose();
  });
});
