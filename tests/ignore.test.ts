import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { frontmatterTags, isIgnoredPath, isIgnoredTag, parseIgnoreList, visibleTasks } from "../src/ignore";
import { scanTasks } from "../src/parser";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS, type TaskManagerSettings } from "../src/types";

describe("ignore rules", () => {
  it("match folders anywhere inside them, and notes with or without .md", () => {
    const ignored = ["Templates/", "Archive", "Journal/Private"];
    expect(isIgnoredPath("Templates/Daily.md", ignored)).toBe(true);
    expect(isIgnoredPath("Archive/2025/Old.md", ignored)).toBe(true);
    expect(isIgnoredPath("Journal/Private.md", ignored)).toBe(true);
    expect(isIgnoredPath("templates/daily.md", ignored)).toBe(true);
    expect(isIgnoredPath("Archive.md", ["Archive/"])).toBe(false);
    expect(isIgnoredPath("Archived notes/Plan.md", ignored)).toBe(false);
    expect(isIgnoredPath("Journal/Private notes.md", ignored)).toBe(false);
  });

  it("match tags case-insensitively, including nested tags", () => {
    expect(isIgnoredTag("#Someday", ["someday"])).toBe(true);
    expect(isIgnoredTag("archive/2025", ["#archive"])).toBe(true);
    expect(isIgnoredTag("#[[archive]]", ["archive"])).toBe(true);
    expect(isIgnoredTag("archived", ["archive"])).toBe(false);
  });

  it("read settings lists and frontmatter tags", () => {
    expect(parseIgnoreList(" Templates/ \n\n/Archive\nTemplates/", false)).toEqual(["Templates/", "Archive"]);
    expect(parseIgnoreList("#Template, someday\n#[[Later]]", true)).toEqual(["template", "someday", "later"]);
    expect(frontmatterTags({ tags: ["project", "template"], tag: "x, y" })).toEqual(["project", "template", "x", "y"]);
    expect(frontmatterTags({ tags: "a b" })).toEqual(["a", "b"]);
  });

  it("drop tagged tasks and their subtasks, and tidy the remaining child lists", () => {
    const tasks = scanTasks("A.md", "- [ ] Keep\n  - [ ] Idea #someday\n    - [ ] Deeper\n  - [ ] Child kept\n- [ ] Later #[[Someday/Maybe]]\n- [ ] Also kept");
    const visible = visibleTasks(tasks, ["someday"]);
    expect(visible.map(task => task.title)).toEqual(["Keep", "Child kept", "Also kept"]);
    expect(visible[0].childIds).toEqual(["A.md:3"]);
    expect(tasks[0].childIds).toEqual(["A.md:1", "A.md:3"]);
    expect(visibleTasks(tasks, [])).toBe(tasks);
  });
});

async function setup(settings: Partial<TaskManagerSettings>) {
  const notes: Record<string, { content: string; frontmatter?: Record<string, unknown> }> = {
    "Work.md": { content: "- [ ] Report\n- [ ] Idea #someday\n  - [ ] Sub idea", frontmatter: { tags: ["project"] } },
    "Templates/Daily.md": { content: "- [ ] Template task" },
    "Old project.md": { content: "- [ ] Leftover", frontmatter: { tags: ["project", "template"] } },
    "Inbox.md": { content: "- [ ] Inbox task" }
  };
  const files = Object.keys(notes).map(path => Object.assign(new TFile(), { path, extension: "md" }));
  let changed: (file: TFile) => void = () => {};
  const cachedRead = vi.fn(async (file: TFile) => notes[file.path].content);
  const app = {
    vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null, cachedRead, on: () => ({}), offref: () => {} },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: notes[file.path].frontmatter }),
      on: (event: string, callback: (file: TFile) => void) => { if (event === "changed") changed = callback; return {}; },
      offref: () => {}
    }
  } as unknown as App;
  const current: TaskManagerSettings = { ...DEFAULT_SETTINGS, ...settings };
  const index = new TaskIndex(app, () => current, () => "YYYY-MM-DD");
  await index.initialize();
  const titles = () => index.allTasks().map(task => task.title).sort();
  return { index, current, titles, cachedRead, notes, files, changed: (path: string) => changed(files.find(file => file.path === path)!) };
}

describe("ignored notes and tags in the index", () => {
  it("leave out ignored folders, notes with an ignored frontmatter tag, and tagged tasks", async () => {
    const { index, titles } = await setup({ ignoredPaths: ["Templates/"], ignoredTags: ["template", "someday"] });
    expect(titles()).toEqual(["Inbox task", "Report"]);
    // A note left out entirely is not a project either; a project keeps its other tasks.
    expect(index.projects().map(project => [project.name, project.openTasks])).toEqual([["Work", 1]]);
    expect(index.tagSummaries().map(tag => tag.name)).toEqual([]);
  });

  it("apply changed settings at once, without reading any note again", async () => {
    const { index, current, titles, cachedRead } = await setup({});
    expect(titles()).toHaveLength(6);
    const reads = cachedRead.mock.calls.length;
    const listener = vi.fn();
    index.subscribe(listener);
    current.ignoredPaths = ["Templates"];
    current.ignoredTags = ["someday"];
    index.applyIgnoreRules();
    expect(titles()).toEqual(["Inbox task", "Leftover", "Report"]);
    expect(listener).toHaveBeenCalledOnce();
    current.ignoredPaths = [];
    current.ignoredTags = [];
    index.applyIgnoreRules();
    expect(titles()).toHaveLength(6);
    expect(cachedRead.mock.calls.length).toBe(reads);
  });

  it("follow frontmatter tag changes in a note", async () => {
    const { index, titles, notes, changed } = await setup({ ignoredTags: ["template"] });
    expect(titles()).not.toContain("Leftover");
    notes["Old project.md"].frontmatter = { tags: ["project"] };
    changed("Old project.md");
    expect(titles()).toContain("Leftover");
    expect(index.isProject("Old project.md")).toBe(true);
    notes["Work.md"].frontmatter = { tags: ["project", "Template/Weekly"] };
    changed("Work.md");
    expect(titles()).not.toContain("Report");
    expect(index.isProject("Work.md")).toBe(false);
  });
});
