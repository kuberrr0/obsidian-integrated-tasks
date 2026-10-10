import { expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", () => ({ ItemView: class {}, Notice: class {}, setIcon: vi.fn() }));
import { ItemView } from "obsidian";
import { TaskNavigationView } from "../src/navigation-view";
import type TaskManagerPlugin from "../src/main";

it("syncs sidebar selection through the supported active-view API", async () => {
  let active: { getViewType(): string; getState(): Record<string, unknown> } | null = {
    getViewType: () => "task-manager-main", getState: () => ({ mode: "tags", tag: "work" })
  };
  let changed = () => {};
  const workspace = {
    getActiveViewOfType: vi.fn(() => active),
    on: vi.fn((_event: string, callback: () => void) => { changed = callback; return {}; })
  };
  Object.defineProperty(workspace, "activeLeaf", { get: () => { throw new Error("Deprecated API accessed"); } });
  const unsubscribe = vi.fn();
  const view = new TaskNavigationView({} as WorkspaceLeaf, { settings: {}, index: { subscribe: () => unsubscribe } } as unknown as TaskManagerPlugin);
  view.app = { workspace } as unknown as App;
  Object.assign(view, { registerEvent: vi.fn(), registerDomEvent: vi.fn(), containerEl: { win: {} } });
  vi.spyOn(view as unknown as { render(): void }, "render").mockImplementation(() => {});
  const setActive = vi.spyOn(view, "setActive");
  await view.onOpen();
  expect(workspace.getActiveViewOfType).toHaveBeenCalledWith(ItemView);
  expect(setActive).toHaveBeenLastCalledWith("tags", "work", undefined);
  active = { getViewType: () => "task-manager-main", getState: () => ({ mode: "projects", pagePath: "Work.md" }) };
  changed();
  expect(setActive).toHaveBeenLastCalledWith("projects", undefined, "Work.md");
  active = { getViewType: () => "task-manager-main", getState: () => ({ mode: "smartLists", smartListId: "work-list" }) };
  changed();
  expect(setActive).toHaveBeenLastCalledWith("smartLists", undefined, undefined, "work-list");
  active = null; changed();
  active = { getViewType: () => "markdown", getState: () => ({}) }; changed();
  expect(setActive).toHaveBeenCalledTimes(3);
  await view.onClose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  // The Smart Lists section unfolds to show the open list; opening a tag unfolds Tags.
  const expanded = (view as unknown as { expanded: Set<string> }).expanded;
  expanded.clear();
  view.setActive("smartLists", undefined, undefined, "work-list");
  expect([...expanded]).toEqual(["smartLists"]);
  view.setActive("tags", "work");
  expect(expanded.has("tags")).toBe(true);
});

it("draws nothing more once closed, even after a press that was waiting to redraw", async () => {
  vi.useFakeTimers();
  try {
    const handlers = new Map<string, () => void>();
    const requestAnimationFrame = vi.fn(() => 1);
    const view = new TaskNavigationView({} as WorkspaceLeaf, { settings: {}, index: { subscribe: () => () => {} } } as unknown as TaskManagerPlugin);
    view.app = { workspace: { getActiveViewOfType: () => null, on: () => ({}) } } as unknown as App;
    Object.assign(view, {
      registerEvent: vi.fn(), registerDomEvent: (_target: unknown, type: string, handler: () => void) => handlers.set(type, handler),
      containerEl: { win: { setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame: vi.fn() } }
    });
    const render = vi.spyOn(view as unknown as { render(): void }, "render").mockImplementation(() => {});
    await view.onOpen();
    handlers.get("pointerdown")!();
    // A redraw that came during the press waits for it to end.
    Object.assign(view, { renderAfterPress: true });
    handlers.get("pointerup")!();
    await view.onClose();
    render.mockRestore();
    vi.advanceTimersByTime(400);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    view.refresh();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
