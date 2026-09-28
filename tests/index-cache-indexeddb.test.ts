import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { TFile, type App } from "obsidian";
import { CACHE_SCHEMA, IndexedDbCache, type CachedNote } from "../src/index-cache";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";
import { FakeEvents, flush } from "./core-events";

const app = (appId?: string) => ({ appId, vault: { getName: () => "My Vault" } }) as unknown as App;
const record = (path: string): CachedNote => ({
  path, mtime: 1, size: 2, schema: CACHE_SCHEMA, dateFormat: "YYYY-MM-DD", sectionHeadingLevel: 1,
  tasks: [{ line: 0, endLine: 0, raw: "- [ ] A", title: "A", indent: 0, status: "todo", completed: false }], headings: []
});

describe("IndexedDB index cache", () => {
  it("names the database per vault", () => {
    expect(new IndexedDbCache(app("abc123"), new IDBFactory()).name).toBe("integrated-task-manager-index:abc123");
    expect(new IndexedDbCache(app(), new IDBFactory()).name).toBe("integrated-task-manager-index:My Vault");
  });

  it("stores, loads, deletes and clears records", async () => {
    const factory = new IDBFactory();
    const cache = new IndexedDbCache(app("v"), factory);
    await cache.put([record("A.md"), record("B.md"), record("C.md")]);
    await cache.delete(["B.md"]);
    // A second session opens the same database.
    const loaded = await new IndexedDbCache(app("v"), factory).load();
    expect([...loaded.keys()].sort()).toEqual(["A.md", "C.md"]);
    expect(loaded.get("A.md")).toEqual(record("A.md"));
    expect((await new IndexedDbCache(app("other"), factory).load()).size).toBe(0);
    await cache.clear();
    expect((await cache.load()).size).toBe(0);
  });

  it("lets a second startup skip reading unchanged notes", async () => {
    const factory = new IDBFactory();
    const files = ["A.md", "B.md"].map(path => Object.assign(new TFile(), { path, extension: "md", stat: { ctime: 0, mtime: 1, size: 20 } }));
    const vault = Object.assign(new FakeEvents(), {
      getMarkdownFiles: () => files, getAbstractFileByPath: () => null,
      cachedRead: vi.fn(async (file: TFile) => `- [ ] Task in ${file.path} {2026-10-05}`)
    });
    const metadataCache = Object.assign(new FakeEvents(), { getFileCache: () => ({}), getFirstLinkpathDest: () => null });
    const boot = async () => {
      const index = new TaskIndex({ vault, metadataCache } as unknown as App, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD", new IndexedDbCache(app("v"), factory));
      await index.initialize();
      return index;
    };
    const cold = await boot();
    const tasks = cold.allTasks();
    cold.destroy();
    await flush();
    await flush();
    vault.cachedRead.mockClear();
    const warm = await boot();
    expect(vault.cachedRead).not.toHaveBeenCalled();
    expect(warm.allTasks()).toStrictEqual(tasks);
    warm.destroy();
  });

  it("degrades to no cache, warning once, when IndexedDB is unavailable or refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Node has no global indexedDB, like a restricted context.
      const missing = new IndexedDbCache(app("v"));
      expect((await missing.load()).size).toBe(0);
      await missing.put([record("A.md")]);
      await missing.clear();
      expect(warn).toHaveBeenCalledOnce();

      warn.mockClear();
      const refusing = { open: () => { throw new Error("SecurityError"); } } as unknown as IDBFactory;
      const denied = new IndexedDbCache(app("v"), refusing);
      await denied.put([record("A.md")]);
      expect((await denied.load()).size).toBe(0);
      expect(warn).toHaveBeenCalledOnce();

      warn.mockClear();
      const failing = { open: () => {
        const request = {} as IDBOpenDBRequest & { onerror: () => void };
        setTimeout(() => request.onerror(), 0);
        return request;
      } } as unknown as IDBFactory;
      expect((await new IndexedDbCache(app("v"), failing).load()).size).toBe(0);
      expect(warn).toHaveBeenCalledOnce();

      // A record that cannot be cloned fails its write without breaking later ones.
      warn.mockClear();
      const cache = new IndexedDbCache(app("v"), new IDBFactory());
      await cache.put([{ ...record("A.md"), headings: [() => 0] as unknown as CachedNote["headings"] }]);
      await cache.put([record("B.md")]);
      expect([...(await cache.load()).keys()]).toEqual(["B.md"]);
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });
});
