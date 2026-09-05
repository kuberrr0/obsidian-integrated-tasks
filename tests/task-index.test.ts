import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";

function setup() {
  const file = Object.assign(new TFile(), { path: "Project.md", extension: "md" });
  let tags = ["project"];
  let properties: Record<string, unknown> = {};
  let content = "- [ ] Parent\n  - [x] Child\n- [x] Done\n";
  let changed: (file: TFile) => void = () => {};
  const app = {
    vault: {
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: () => file,
      cachedRead: async () => content,
      on: () => ({}), offref: () => {}
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { tags, ...properties } }),
      on: (_event: string, callback: (file: TFile) => void) => { changed = callback; return {}; }
    }
  } as unknown as App;
  return {
    index: new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD"),
    setProperties: (next: Record<string, unknown>) => { properties = next; changed(file); },
    setTags: (next: string[]) => { tags = next; changed(file); },
    setContent: (next: string) => { content = next; }
  };
}

describe("project progress and archive indexing", () => {
  it("counts all checklist items, including nested and completed tasks", async () => {
    const { index } = setup();
    await index.initialize();
    expect(index.projects()[0]).toMatchObject({ openTasks: 1, completedTasks: 2, archived: false });
  });

  it("reacts to adding and removing archived tags without hiding project tasks", async () => {
    const { index, setTags } = setup();
    await index.initialize();
    setTags(["project", "archived"]);
    expect(index.projects()[0].archived).toBe(true);
    expect(index.query({ mode: "project", projectPath: "Project.md", showCompleted: true })).toHaveLength(3);
    setTags(["project"]);
    expect(index.projects()[0].archived).toBe(false);
    setTags(["archived"]);
    expect(index.projects()).toHaveLength(0);
  });

  it("refreshes task counts and supports empty projects", async () => {
    const { index, setContent } = setup();
    await index.initialize();
    setContent("# Empty project\n");
    await index.refreshPath("Project.md");
    expect(index.projects()[0]).toMatchObject({ openTasks: 0, completedTasks: 0 });
  });
});


it("updates project property badges when note properties change or are removed", async () => {
  const { index, setProperties } = setup();
  await index.initialize();
  setProperties({ date: "2026-09-05", "end date": "2026-09-10", priority: "p2", duration: "1h30m" });
  expect(index.projects()[0]).toMatchObject({ scheduledDate: "2026-09-05", endDate: "2026-09-10", deadline: undefined, priority: 2, durationMinutes: 90 });
  setProperties({});
  expect(index.projects()[0].scheduledDate).toBeUndefined();
  expect(index.projects()[0].deadline).toBeUndefined();
  expect(index.projects()[0].priority).toBeUndefined();
  expect(index.projects()[0].durationMinutes).toBeUndefined();
});


it("resolves parent links relative to the project note and refreshes changes", async () => {
  const parent = Object.assign(new TFile(), { path: "Projects/Parent.md", extension: "md" });
  const child = Object.assign(new TFile(), { path: "Projects/Child.md", extension: "md" });
  let parentValue: unknown = ["[[Parent|Parent project]]"];
  let changed: (file: TFile) => void = () => {};
  const app = {
    vault: { getMarkdownFiles: () => [parent, child], cachedRead: async () => "", on: () => ({}), offref: () => {} },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: { tags: ["project"], ...(file === child ? { parent: parentValue } : {}) } }),
      getFirstLinkpathDest: (link: string, source: string) => link === "Parent" && source === child.path ? parent : null,
      on: (_event: string, callback: (file: TFile) => void) => { changed = callback; return {}; }
    }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  expect(index.projects().find(project => project.path === child.path)?.parentPath).toBe(parent.path);
  parentValue = null;
  changed(child);
  expect(index.projects().find(project => project.path === child.path)?.parentPath).toBeUndefined();
});
