import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import * as parser from "../src/parser";
import { CACHE_SCHEMA, MemoryIndexCache, type CachedNote, type IndexCache } from "../src/index-cache";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";
import { FakeEvents, flush } from "./core-events";

const RICH = [
  "# Work",
  "- [ ] Parent [[2026-10-01]] 09:00 p1 #[[work]]",
  "  - details line",
  "  - more",
  "    continuation",
  "  - [ ] Child {2026-10-05}",
  "    - [x] Grandchild ✓2026-09-01",
  "- [ ] Deferred >2026-09-30",
  "- [ ] Someday >someday",
  "- [ ] Repeat [[2026-10-02]] every week",
  "## Sub",
  "# Home",
  "- [ ] Other ^abc123"
].join("\n");

type World = ReturnType<typeof world>;

function world(contents: Record<string, string>) {
  const text = new Map(Object.entries(contents));
  const files = [...text].map(([path, content]) => Object.assign(new TFile(), { path, extension: "md", stat: { ctime: 0, mtime: 1, size: content.length } }));
  const vault = Object.assign(new FakeEvents(), {
    getMarkdownFiles: () => files.slice(),
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
    cachedRead: vi.fn(async (file: TFile) => text.get(file.path) ?? "")
  });
  const metadataCache = Object.assign(new FakeEvents(), { getFileCache: () => ({}), getFirstLinkpathDest: () => null });
  return { text, files, vault, metadataCache, app: { vault, metadataCache } as unknown as App };
}

function edit(w: World, path: string, content: string): TFile {
  const file = w.files.find(file => file.path === path)!;
  w.text.set(path, content);
  file.stat = { ...file.stat, mtime: file.stat.mtime + 1, size: content.length };
  return file;
}

async function boot(w: World, cache?: IndexCache, settings: { dateFormat?: string; level?: number } = {}): Promise<TaskIndex> {
  const index = new TaskIndex(w.app, () => ({ ...DEFAULT_SETTINGS, sectionHeadingLevel: settings.level ?? 1 }), () => settings.dateFormat ?? "YYYY-MM-DD", cache);
  await index.initialize();
  return index;
}

/** Destroying flushes pending writes; let them finish. */
async function shutdown(index: TaskIndex): Promise<void> {
  index.destroy();
  await flush();
}

const readPaths = (w: World): string[] => w.vault.cachedRead.mock.calls.map(([file]) => file.path).sort();

afterEach(() => { vi.useRealTimers(); });

describe("persisted task index", () => {
  it("restores unchanged notes without reading them, exactly as a scan would", async () => {
    const w = world({ "A.md": RICH, "B.md": "- [ ] Task in B\n  - [ ] Nested", "Empty.md": "Just prose" });
    const cache = new MemoryIndexCache();
    const cold = await boot(w, cache);
    const tasks = cold.allTasks();
    const headings = ["A.md", "B.md", "Empty.md"].map(path => cold.headingsForPath(path));
    await shutdown(cold);
    expect([...cache.notes.keys()].sort()).toEqual(["A.md", "B.md", "Empty.md"]);
    const record = cache.notes.get("A.md")!;
    expect(record).toMatchObject({ schema: CACHE_SCHEMA, dateFormat: "YYYY-MM-DD", sectionHeadingLevel: 1, mtime: 1, size: RICH.length });
    expect(record.day).toBeUndefined();
    expect(record.tasks[0]).not.toHaveProperty("id");
    expect(record.tasks[0]).not.toHaveProperty("path");
    expect(Object.values(record.tasks[0]).some(value => value === undefined)).toBe(false);

    w.vault.cachedRead.mockClear();
    const warm = await boot(w, cache);
    expect(w.vault.cachedRead).not.toHaveBeenCalled();
    expect(warm.allTasks()).toStrictEqual(tasks);
    expect(["A.md", "B.md", "Empty.md"].map(path => warm.headingsForPath(path))).toStrictEqual(headings);
    // The fixture exercises the fields that must survive.
    const byTitle = new Map(tasks.map(task => [task.title, task]));
    expect(byTitle.get("Parent")).toMatchObject({ scheduledDate: "2026-10-01", scheduledTime: "09:00", priority: 1, tags: ["work"], description: "- details line\n- more\n  continuation", descriptionLines: [2, 3, 4], childIds: ["A.md:5"], endLine: 6, section: "Work", sectionLine: 0 });
    expect(byTitle.get("Grandchild")).toMatchObject({ completed: true, completedDate: "2026-09-01", parentId: "A.md:5" });
    expect(byTitle.get("Deferred")?.deferDate).toBe("2026-09-30");
    expect(byTitle.get("Someday")?.someday).toBe(true);
    expect(byTitle.get("Repeat")?.repeat).toBe("every week");
    expect(warm.taskById("A.md:5")?.deadline).toBe("2026-10-05");
    await shutdown(warm);
  });

  it("reads notes whose modification time or size changed", async () => {
    const w = world({ "A.md": "- [ ] A", "B.md": "- [ ] B", "C.md": "- [ ] C" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    w.files[1].stat = { ...w.files[1].stat, mtime: 5 };
    w.files[2].stat = { ...w.files[2].stat, size: 99 };
    w.vault.cachedRead.mockClear();
    const index = await boot(w, cache);
    expect(readPaths(w)).toEqual(["B.md", "C.md"]);
    await shutdown(index);
    expect(cache.notes.get("B.md")?.mtime).toBe(5);
    expect(cache.notes.get("C.md")?.size).toBe(99);
  });

  it.each([
    ["date format", { dateFormat: "DD.MM.YYYY" }],
    ["section heading level", { level: 2 }]
  ])("parses every note again when the %s changes", async (_name, settings) => {
    const w = world({ "A.md": RICH, "B.md": "- [ ] B" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    w.vault.cachedRead.mockClear();
    const index = await boot(w, cache, settings);
    expect(readPaths(w)).toEqual(["A.md", "B.md"]);
    await shutdown(index);
    w.vault.cachedRead.mockClear();
    await shutdown(await boot(w, cache, settings));
    expect(w.vault.cachedRead).not.toHaveBeenCalled();
  });

  it("parses records from an older schema again", async () => {
    const w = world({ "A.md": "- [ ] A", "B.md": "- [ ] B" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    cache.notes.get("A.md")!.schema = CACHE_SCHEMA - 1;
    w.vault.cachedRead.mockClear();
    await shutdown(await boot(w, cache));
    expect(readPaths(w)).toEqual(["A.md"]);
    expect(cache.notes.get("A.md")!.schema).toBe(CACHE_SCHEMA);
  });

  it("reuses relative dates only on the day they were parsed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 10));
    const w = world({
      "R.md": "- [ ] Call {tomorrow}", "D.md": "- [ ] Later >fri", "S.md": "- [ ] Strict {2026-10-05} [[2026-10-01]]",
      "W.md": "- [ ] Renew {in two weeks}", "Y.md": "- [ ] File {oct 30} #[[tax 2026]]", "T.md": "- [ ] Ship {2026-10-05 6pm} >someday"
    });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    expect(cache.notes.get("R.md")?.day).toBe("2026-09-27");
    expect(cache.notes.get("D.md")?.day).toBe("2026-09-27");
    expect(cache.notes.get("W.md")?.day).toBe("2026-09-27");
    expect(cache.notes.get("Y.md")?.day).toBe("2026-09-27");
    expect(cache.notes.get("S.md")?.day).toBeUndefined();
    expect(cache.notes.get("T.md")?.day).toBeUndefined();

    w.vault.cachedRead.mockClear();
    vi.setSystemTime(new Date(2026, 8, 27, 23));
    let index = await boot(w, cache);
    expect(w.vault.cachedRead).not.toHaveBeenCalled();
    expect(index.tasksForPath("R.md")[0].deadline).toBe("2026-09-28");
    await shutdown(index);

    vi.setSystemTime(new Date(2026, 8, 28, 9));
    index = await boot(w, cache);
    expect(readPaths(w)).toEqual(["D.md", "R.md", "W.md", "Y.md"]);
    expect(index.tasksForPath("R.md")[0].deadline).toBe("2026-09-29");
    expect(index.tasksForPath("S.md")[0]).toMatchObject({ deadline: "2026-10-05", scheduledDate: "2026-10-01" });
    await shutdown(index);
    expect(cache.notes.get("R.md")?.day).toBe("2026-09-28");
  });

  it("marks every dated note day-dependent under a year-less date format", async () => {
    const w = world({ "A.md": "- [ ] Plan 30 October", "B.md": "- [ ] Undated" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache, { dateFormat: "D MMMM" }));
    expect(cache.notes.get("A.md")?.day).toBeDefined();
    expect(cache.notes.get("B.md")?.day).toBeUndefined();
  });

  it("removes records of deleted and renamed notes", async () => {
    const w = world({ "A.md": "- [ ] A", "B.md": "- [ ] B", "C.md": "- [ ] C" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    // Deleted while the plugin was not running.
    w.files.splice(1, 1);
    let index = await boot(w, cache);
    await shutdown(index);
    expect([...cache.notes.keys()].sort()).toEqual(["A.md", "C.md"]);

    index = await boot(w, cache);
    w.vault.trigger("delete", w.files[0]);
    const renamed = w.files[1];
    renamed.path = "D.md";
    w.text.set("D.md", "- [ ] C");
    w.vault.trigger("rename", renamed, "C.md");
    await flush();
    await shutdown(index);
    expect([...cache.notes.keys()]).toEqual(["D.md"]);
    expect(cache.notes.get("D.md")?.tasks[0].title).toBe("C");
  });

  it("parses a restored note for real on its next change", async () => {
    const w = world({ "A.md": "- [ ] One", "B.md": "- [ ] B" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    const index = await boot(w, cache);
    const scan = vi.spyOn(parser, "scanTasks");
    try {
      // Nothing was read at startup, so even an unchanged save must be parsed.
      w.vault.trigger("modify", w.files[0]);
      await flush();
      expect(scan).toHaveBeenCalledOnce();
      w.vault.trigger("modify", edit(w, "A.md", "- [ ] Two"));
      await flush();
      expect(scan).toHaveBeenCalledTimes(2);
      expect(index.tasksForPath("A.md").map(task => task.title)).toEqual(["Two"]);
    } finally { scan.mockRestore(); }
    await shutdown(index);
    expect(cache.notes.get("A.md")?.tasks.map(task => task.title)).toEqual(["Two"]);
    expect(cache.notes.get("A.md")?.mtime).toBe(2);
  });

  it("batches writes until edits settle, but not beyond the maximum delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const w = world({ "A.md": "- [ ] A", "B.md": "- [ ] B" });
    const cache = new MemoryIndexCache();
    const put = vi.spyOn(cache, "put");
    const index = new TaskIndex(w.app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD", cache);
    const started = index.initialize();
    await vi.advanceTimersByTimeAsync(0);
    await started;
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0].map(note => note.path).sort()).toEqual(["A.md", "B.md"]);

    put.mockClear();
    w.vault.trigger("modify", edit(w, "A.md", "- [ ] A2"));
    await vi.advanceTimersByTimeAsync(1500);
    w.vault.trigger("modify", edit(w, "B.md", "- [ ] B2"));
    await vi.advanceTimersByTimeAsync(1500);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0].map(note => note.tasks[0].title).sort()).toEqual(["A2", "B2"]);

    // Continuous typing still saves within the maximum delay.
    put.mockClear();
    for (let i = 0; i < 8; i++) {
      w.vault.trigger("modify", edit(w, "A.md", `- [ ] Typing ${i}`));
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(put).toHaveBeenCalledOnce();
    index.destroy();
  });

  it("indexes normally when the cache fails", async () => {
    const w = world({ "A.md": "- [ ] A", "B.md": "- [ ] B" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: IndexCache = {
      load: () => Promise.reject(new Error("quota")),
      put: () => Promise.reject(new Error("quota")),
      delete: () => Promise.reject(new Error("quota")),
      clear: () => Promise.reject(new Error("quota"))
    };
    try {
      const index = await boot(w, broken);
      expect(index.allTasks().map(task => task.title)).toEqual(["A", "B"]);
      await shutdown(index);
      await (await boot(w, broken)).rebuild();
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("rebuilds from scratch", async () => {
    const w = world({ "A.md": "- [ ] A" });
    const cache = new MemoryIndexCache();
    await shutdown(await boot(w, cache));
    const index = await boot(w, cache);
    cache.notes.set("Ghost.md", { ...cache.notes.get("A.md")!, path: "Ghost.md" } as CachedNote);
    w.vault.cachedRead.mockClear();
    await index.rebuild();
    expect(readPaths(w)).toEqual(["A.md"]);
    await shutdown(index);
    expect([...cache.notes.keys()]).toEqual(["A.md"]);
  });
});
