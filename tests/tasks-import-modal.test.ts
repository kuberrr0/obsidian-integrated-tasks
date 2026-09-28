// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  Modal: class {
    contentEl = document.createElement("div");
    modalEl = document.createElement("div");
    titleEl = document.createElement("div");
    constructor(public app: unknown) { this.modalEl.append(this.titleEl, this.contentEl); document.body.append(this.modalEl); }
    open(): void { (this as unknown as { onOpen(): void }).onOpen(); }
    close(): void { (this as unknown as { onClose(): void }).onClose(); this.modalEl.remove(); }
  },
  Notice: class { constructor(public message: string) {} }
}));

import { TFile, type App } from "obsidian";
import { TaskStore } from "../src/task-store";
import { TasksImportModal } from "../src/tasks-import-modal";
import { DEFAULT_SETTINGS } from "../src/types";

beforeAll(() => installObsidianDom());

function setup(notes: Record<string, string>, tasksSettings?: string) {
  const contents = new Map(Object.entries(notes));
  const files = new Map([...contents.keys()].map(path => [path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") })]));
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: { read: async (path: string) => { if (path === ".obsidian/plugins/obsidian-tasks-plugin/data.json" && tasksSettings) return tasksSettings; throw new Error("missing"); } },
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => contents.get(file.path)!,
      read: async (file: TFile) => contents.get(file.path)!,
      process: async (file: TFile, change: (content: string) => string) => { const next = change(contents.get(file.path)!); contents.set(file.path, next); return next; }
    },
    metadataCache: { getFirstLinkpathDest: () => null }
  } as unknown as App;
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => false);
  const refreshPath = vi.fn();
  const plugin = { store, index: { refreshPath }, settings: { ...DEFAULT_SETTINGS }, dateFormat: () => "YYYY-MM-DD" };
  const open = (current?: string) => {
    const modal = new TasksImportModal(app, plugin as never, current ? files.get(current) : undefined);
    modal.open();
    return modal;
  };
  return { contents, store, refreshPath, open };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("Tasks plugin import dialog", () => {
  it("previews the conversion, then converts all notes as one undoable change", async () => {
    const { contents, store, refreshPath, open } = setup({
      "A.md": "- [ ] #task Pay rent 📅 2026-10-01 ⏫\n- [ ] Plain\n",
      "B.md": "- [/] Doing 📅 2026-10-01\n- [!] Flagged 📅 2026-10-01\n- [ ] Call ⏳ 2026-09-28\n",
      "C.md": "Nothing here\n"
    }, JSON.stringify({ globalFilter: "#task" }));
    const modal = open();
    await vi.waitFor(() => expect(modal.contentEl.querySelector(".tm-import-count")?.textContent).toBe("3 tasks in 2 notes will be converted."));
    expect(modal.contentEl.querySelector<HTMLInputElement>("input[type=text]")!.value).toBe("#task");
    expect(Array.from(modal.contentEl.querySelectorAll(".tm-import-examples li")).map(item => item.textContent)).toEqual([
      "- [ ] #task Pay rent 📅 2026-10-01 ⏫ → - [ ] Pay rent {2026-10-01} p1", "- [/] Doing 📅 2026-10-01 → - [/] Doing {2026-10-01}", "- [ ] Call ⏳ 2026-09-28 → - [ ] Call 2026-09-28"]);
    expect(modal.contentEl.querySelector(".tm-import-skip")!.textContent).toBe("1 task with an unsupported status, such as [!] or [>], left unchanged.");
    const convert = modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!;
    expect(convert.textContent).toBe("Convert 3 tasks");
    convert.click();
    await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledTimes(2));
    expect(contents.get("A.md")).toBe("- [ ] Pay rent {2026-10-01} p1\n- [ ] Plain\n");
    expect(contents.get("B.md")).toBe("- [/] Doing {2026-10-01}\n- [!] Flagged 📅 2026-10-01\n- [ ] Call 2026-09-28\n");
    expect(store.lastChange()?.label).toBe("Imported 3 tasks from the Tasks plugin");
    await store.undo();
    expect(contents.get("A.md")).toBe("- [ ] #task Pay rent 📅 2026-10-01 ⏫\n- [ ] Plain\n");
  });

  it("limits the import to the current note and updates the preview when options change", async () => {
    const { contents, open } = setup({ "A.md": "- [ ] One 📅 2026-10-01 #home\n", "B.md": "- [ ] Two 📅 2026-10-01\n" });
    const modal = open("A.md");
    await settle();
    modal.contentEl.querySelector<HTMLInputElement>("input[value=current]")!.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelector(".tm-import-count")?.textContent).toBe("1 task in 1 note will be converted."));
    const tags = modal.contentEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[0];
    tags.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelector(".tm-import-examples li")?.textContent).toBe("- [ ] One 📅 2026-10-01 #home → - [ ] One #home {2026-10-01}"));
    modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!.click();
    await vi.waitFor(() => expect(contents.get("A.md")).toBe("- [ ] One #home {2026-10-01}\n"));
    expect(contents.get("B.md")).toBe("- [ ] Two 📅 2026-10-01\n");
  });

  it("says when there is nothing to convert", async () => {
    const { open } = setup({ "A.md": "- [ ] Already native 2026-10-01\n" });
    const modal = open();
    await vi.waitFor(() => expect(modal.contentEl.querySelector(".tm-import-count")?.textContent).toBe("No Tasks plugin tasks to convert."));
    expect(modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!.disabled).toBe(true);
  });
});
