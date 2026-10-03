// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const notices: Array<{ message: string | DocumentFragment; hide: ReturnType<typeof vi.fn> }> = [];
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  Plugin: class {},
  ItemView: class {},
  MarkdownView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  Setting: class {},
  Menu: class {},
  Notice: class {
    hide = vi.fn();
    constructor(public message: string | DocumentFragment) { notices.push(this); }
  },
  setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));

import type { App } from "obsidian";
import TaskManagerPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/types";
import type { TaskChange } from "../src/task-store";
import { installObsidianDom } from "./helpers/obsidian-dom";

const text = (message: string | DocumentFragment) => typeof message === "string" ? message : message.textContent;

function plugin(changes: TaskChange[] = [{ label: "Completed “Pay rent”", files: [{ path: "A.md", before: "- [ ] Pay rent", after: "- [x] Pay rent" }] }]) {
  const instance = new TaskManagerPlugin({} as App, {} as never);
  instance.settings = { ...DEFAULT_SETTINGS };
  const undo = vi.fn(async (change?: TaskChange) => change ? change.files.map(file => file.path) : []);
  const refreshPath = vi.fn();
  const redo = vi.fn(async (change?: TaskChange) => change ? change.files.map(file => file.path) : []);
  const undone: TaskChange[] = [];
  Object.assign(instance, { store: { undo, redo, lastChange: () => changes[changes.length - 1], lastUndone: () => undone[undone.length - 1] }, index: { refreshPath } });
  const offerUndo = (change: TaskChange) => (instance as unknown as { offerUndo(change: TaskChange): void }).offerUndo(change);
  return { instance, undo, redo, refreshPath, offerUndo, changes, undone };
}

beforeAll(() => installObsidianDom());
beforeEach(() => { notices.length = 0; });

describe("undo notices", () => {
  it("shows the action with an Undo button that reverts it and refreshes the notes", async () => {
    const { instance, offerUndo, undo, refreshPath, changes } = plugin();
    instance.settings.showUndoNotices = true;
    offerUndo(changes[0]);
    expect(text(notices[0].message)).toBe("Completed “Pay rent”. Undo");
    (notices[0].message as DocumentFragment).querySelector("button")!.click();
    await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledWith("A.md"));
    expect(notices[0].hide).toHaveBeenCalled();
    expect(undo).toHaveBeenCalledWith(changes[0]);
    expect(text(notices[1].message)).toBe("Undone: Completed “Pay rent”. Redo");
  });

  it("offers Redo after an undo, which reapplies that change", async () => {
    const { instance, redo, refreshPath, changes } = plugin();
    await instance.undoTaskChange();
    refreshPath.mockClear();
    (notices[0].message as DocumentFragment).querySelector("button")!.click();
    await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledWith("A.md"));
    expect(notices[0].hide).toHaveBeenCalled();
    expect(redo).toHaveBeenCalledWith(changes[0]);
    expect(text(notices[1].message)).toBe("Redone: Completed “Pay rent”");
  });

  it("redoes the last undone change from the command, or says there is none", async () => {
    const { instance, redo, undone, changes } = plugin();
    await instance.redoTaskChange();
    expect(text(notices[0].message)).toBe("Nothing to redo.");
    undone.push(changes[0]);
    await instance.redoTaskChange();
    expect(redo).toHaveBeenCalledWith(changes[0]);
    redo.mockRejectedValueOnce(new Error("Can't redo: A has changed since."));
    await instance.redoTaskChange();
    expect(text(notices[2].message)).toBe("Can't redo: A has changed since.");
  });

  it("is off by default, while the command still undoes the last change", async () => {
    const { instance, offerUndo, undo, changes } = plugin();
    expect(instance.settings.showUndoNotices).toBe(false);
    offerUndo(changes[0]);
    expect(notices).toHaveLength(0);
    await instance.undoTaskChange();
    expect(undo).toHaveBeenCalledWith(changes[0]);
  });

  it("explains why an undo was refused", async () => {
    const { instance, undo } = plugin();
    undo.mockRejectedValueOnce(new Error("Can't undo: A has changed since."));
    await instance.undoTaskChange();
    expect(text(notices[0].message)).toBe("Can't undo: A has changed since.");
    const empty = plugin([]);
    await empty.instance.undoTaskChange();
    expect(text(notices[1].message)).toBe("Nothing to undo.");
  });
});
