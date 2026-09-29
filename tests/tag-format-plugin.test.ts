import { afterEach, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Plugin: class {}, ItemView: class {},
  MarkdownView: class {}, Modal: class { open() {} }, PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
const confirm = vi.hoisted(() => ({ last: undefined as undefined | { message: string; run: () => void } }));
vi.mock("../src/confirm-modal", () => ({ openConfirm: (_app: unknown, options: { message: string; run: () => void }) => { confirm.last = options; } }));
import TaskManagerPlugin from "../src/main";
import { tagFormat } from "../src/task-tags";
import type { TaskIndex } from "../src/task-index";
import type { TaskStore } from "../src/task-store";

afterEach(() => { confirm.last = undefined; });

it("defaults to #tag, dropping the old Link tags setting, and reads with the saved format", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.loadData = vi.fn().mockResolvedValue({ linkTags: true });
  await plugin.loadSettings();
  expect(plugin.settings.tagFormat).toBe("hash");
  expect("linkTags" in plugin.settings).toBe(false);
  expect(tagFormat()).toBe("hash");
  plugin.loadData = vi.fn().mockResolvedValue({ tagFormat: "wikilink" });
  await plugin.loadSettings();
  expect(tagFormat()).toBe("wikilink");
});

it("switches the format, saving it and reading the vault again", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const rescanAll = vi.fn().mockResolvedValue(undefined);
  plugin.index = { rescanAll } as unknown as TaskIndex;
  plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
  await plugin.setTagFormat("wikilink");
  expect(plugin.settings.tagFormat).toBe("wikilink");
  expect(tagFormat()).toBe("wikilink");
  expect(plugin.saveSettings).toHaveBeenCalledOnce();
  expect(rescanAll).toHaveBeenCalledOnce();
});

it("converts notes' task tags into the format after asking, as one undoable change", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const file = (path: string) => Object.assign(new TFile(), { path });
  const notes = new Map([["A.md", "- [ ] Plan #[[open house]]"], ["B.md", "- [ ] Done #work"], ["C.md", "Prose #[[x]]"]]);
  plugin.app = { vault: { getMarkdownFiles: () => [...notes.keys()].map(file), cachedRead: async (item: TFile) => notes.get(item.path)! } } as unknown as App;
  const rewriteNotes = vi.fn(async (files: TFile[], transform: (content: string) => string, _label: string) => files.map(item => { notes.set(item.path, transform(notes.get(item.path)!)); return item.path; }));
  plugin.store = { rewriteNotes } as unknown as TaskStore;
  const refreshPath = vi.fn().mockResolvedValue(undefined);
  plugin.index = { refreshPath } as unknown as TaskIndex;
  plugin.settings.tagFormat = "hash";
  await plugin.convertTaskTags();
  expect(confirm.last!.message).toContain("1 note");
  expect(rewriteNotes).not.toHaveBeenCalled();
  confirm.last!.run();
  await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledWith("A.md"));
  expect(rewriteNotes.mock.calls[0][0].map(item => item.path)).toEqual(["A.md"]);
  expect(rewriteNotes.mock.calls[0][2]).toBe("Converted task tags to #tag");
  expect(notes.get("A.md")).toBe("- [ ] Plan #open-house");
  // Nothing left to convert: no question.
  confirm.last = undefined;
  await plugin.convertTaskTags();
  expect(confirm.last).toBeUndefined();
});
