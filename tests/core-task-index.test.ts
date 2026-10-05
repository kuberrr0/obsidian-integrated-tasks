import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import * as parser from "../src/parser";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";
import { FakeEvents, flush } from "./core-events";

const note = (path: string): TFile => Object.assign(new TFile(), { path, extension: "md" });

function setup(paths: string[], contents: Record<string, string> = {}) {
  const files = paths.map(note);
  const text = new Map(paths.map(path => [path, contents[path] ?? `- [ ] Task in ${path}`]));
  const frontmatter = new Map<string, Record<string, unknown>>();
  const vault = Object.assign(new FakeEvents(), {
    getMarkdownFiles: () => files.filter(file => !(file as TFile & { deleted?: boolean }).deleted),
    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
    cachedRead: vi.fn(async (file: TFile) => text.get(file.path) ?? "")
  });
  // Paths whose metadata Obsidian is still reading after a write: it has none for them yet.
  const reading = new Set<string>();
  const metadataCache = Object.assign(new FakeEvents(), {
    getFileCache: (file: TFile) => reading.has(file.path) ? null : frontmatter.has(file.path) ? { frontmatter: frontmatter.get(file.path) } : {},
    getFirstLinkpathDest: () => null
  });
  const app = { vault, metadataCache } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  const listener = vi.fn();
  index.subscribe(listener);
  return { index, files, text, frontmatter, reading, vault, metadataCache, listener };
}

describe("TaskIndex listeners", () => {
  it("removes vault and metadata cache listeners from their own emitters on destroy", async () => {
    const { index, vault, metadataCache } = setup(["A.md"]);
    await index.initialize();
    expect(vault.listenerCount()).toBe(4);
    expect(metadataCache.listenerCount("changed")).toBe(1);
    index.destroy();
    expect(vault.listenerCount()).toBe(0);
    expect(metadataCache.listenerCount()).toBe(0);
  });

  it("registers nothing when initialized after being destroyed", async () => {
    const { index, vault, metadataCache } = setup(["A.md"]);
    index.destroy();
    await index.initialize();
    expect(vault.listenerCount() + metadataCache.listenerCount()).toBe(0);
  });
});

describe("startup scan and deletions", () => {
  it("does not index notes deleted before their batch is read, even from Obsidian's read cache", async () => {
    const paths = Array.from({ length: 120 }, (_, i) => `N${i}.md`);
    const { index, files, vault, frontmatter } = setup(paths);
    frontmatter.set("N100.md", { tags: ["project"] });
    frontmatter.set("N110.md", { tags: ["project"] });
    const read = vault.cachedRead.getMockImplementation()!;
    vault.cachedRead.mockImplementation(async (file: TFile) => {
      if (file.path === "N0.md") {
        // One note is reported deleted; another only carries the deleted flag.
        vault.trigger("delete", files[100]);
        (files[110] as TFile & { deleted?: boolean }).deleted = true;
      }
      return read(file);
    });
    await index.initialize();
    const titles = index.allTasks().map(task => task.title);
    expect(titles).toHaveLength(118);
    expect(titles).not.toContain("Task in N100.md");
    expect(titles).not.toContain("Task in N110.md");
    expect(index.projects()).toEqual([]);
    // Creating a note at a deleted path indexes it again.
    const recreated = note("N100.md");
    files[100] = recreated;
    vault.trigger("create", recreated);
    await flush();
    expect(index.tasksForPath("N100.md").map(task => task.title)).toEqual(["Task in N100.md"]);
  });
});

describe("duplicate rescans", () => {
  it("parses and notifies once per real change, while forced refreshes always parse", async () => {
    const { index, files, text, vault, listener } = setup(["A.md", "B.md"]);
    await index.initialize();
    listener.mockClear();
    const scan = vi.spyOn(parser, "scanTasks");
    try {
      // A save fires modify, and the caller refreshes too: one read, and unchanged content is skipped.
      vault.cachedRead.mockClear();
      vault.trigger("modify", files[0]);
      await index.refreshPath("A.md");
      expect(vault.cachedRead).toHaveBeenCalledOnce();
      expect(scan).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();

      text.set("A.md", "- [ ] Changed");
      vault.trigger("modify", files[0]);
      await index.refreshPath("A.md");
      await flush();
      expect(scan).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledOnce();
      expect(index.tasksForPath("A.md").map(task => task.title)).toEqual(["Changed"]);

      await index.refreshPath("A.md");
      expect(scan).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledOnce();

      // Parsed again, to the same tasks: nothing to redraw.
      await index.refreshPath("A.md", { force: true });
      expect(scan).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledOnce();

      // Typing prose below the tasks changes the note, not its tasks.
      text.set("A.md", "- [ ] Changed\n\nSome notes");
      await index.refreshPath("A.md");
      expect(scan).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenCalledOnce();
    } finally { scan.mockRestore(); }
  });

  it("notifies on metadata changes only when project status or properties change", async () => {
    const { index, files, metadataCache, frontmatter, listener } = setup(["A.md"]);
    await index.initialize();
    listener.mockClear();
    metadataCache.trigger("changed", files[0]);
    expect(listener).not.toHaveBeenCalled();
    frontmatter.set("A.md", { tags: ["project"] });
    metadataCache.trigger("changed", files[0]);
    expect(listener).toHaveBeenCalledOnce();
    expect(index.isProject("A.md")).toBe(true);
    metadataCache.trigger("changed", files[0]);
    expect(listener).toHaveBeenCalledOnce();
    frontmatter.set("A.md", { tags: ["project"], priority: "p1" });
    metadataCache.trigger("changed", files[0]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(index.projects()[0].priority).toBe(1);
    frontmatter.set("A.md", { tags: ["project", "archived"], priority: "p1" });
    metadataCache.trigger("changed", files[0]);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(index.projects()[0].archived).toBe(true);
  });

  it("keeps a project while Obsidian rereads its metadata after a write", async () => {
    const { index, files, text, frontmatter, reading, vault, metadataCache, listener } = setup(["P.md"]);
    frontmatter.set("P.md", { tags: ["project"], priority: "p1" });
    await index.initialize();
    listener.mockClear();
    reading.add("P.md");
    text.set("P.md", "");
    vault.trigger("modify", files[0]);
    await flush();
    // The deleted task updates the view once; the project stays, with its properties.
    expect(listener).toHaveBeenCalledOnce();
    expect(index.isProject("P.md")).toBe(true);
    expect(index.projects()[0].priority).toBe(1);
    reading.delete("P.md");
    metadataCache.trigger("changed", files[0]);
    expect(listener).toHaveBeenCalledOnce();
    expect(index.isProject("P.md")).toBe(true);
  });

  it("rescans every note in batches with one notification", async () => {
    const paths = Array.from({ length: 120 }, (_, i) => `N${i}.md`);
    const { index, listener } = setup(paths);
    await index.initialize();
    listener.mockClear();
    const scan = vi.spyOn(parser, "scanTasks");
    try {
      await index.rescanAll();
      expect(scan).toHaveBeenCalledTimes(120);
      expect(listener).toHaveBeenCalledOnce();
      // Without force, unchanged notes are read but not parsed.
      await index.rescanAll({ force: false });
      expect(scan).toHaveBeenCalledTimes(120);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally { scan.mockRestore(); }
  });
});

it("resolves exact note paths containing # before treating # as a heading", async () => {
  const { index, vault } = setup(["C.md", "C# notes.md", "Work.md"]);
  await index.initialize();
  for (const [target, path] of [["C# notes.md", "C# notes.md"], ["C# notes.md#Plans", "C# notes.md"], ["Work#Section", "Work.md"], ["C", "C.md"]]) {
    vault.cachedRead.mockClear();
    await index.refreshPath(target, { force: true });
    expect(vault.cachedRead.mock.calls.map(([file]) => file.path)).toEqual([path]);
  }
  vault.cachedRead.mockClear();
  const file = vault.getAbstractFileByPath("Work.md")!;
  await index.refreshPath(file, { force: true });
  expect(vault.cachedRead).toHaveBeenCalledExactlyOnceWith(file);
});

it("caches tag summaries until tasks change", async () => {
  const { index, files, text, vault } = setup(["A.md"], { "A.md": "- [ ] One #[[work]]\n- [x] Two #[[work]] #[[home]]" });
  await index.initialize();
  const summaries = index.tagSummaries();
  expect(summaries).toEqual([{ name: "home", openTasks: 0, completedTasks: 1 }, { name: "work", openTasks: 1, completedTasks: 1 }]);
  expect(index.tagSummaries()).toBe(summaries);
  text.set("A.md", "- [ ] One #[[work]]");
  vault.trigger("modify", files[0]);
  await flush();
  expect(index.tagSummaries()).toEqual([{ name: "work", openTasks: 1, completedTasks: 0 }]);
});
