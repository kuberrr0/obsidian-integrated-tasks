import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { scanTasks } from "../src/parser";
import { TaskStore, type TaskChange } from "../src/task-store";

function vault(initial: Record<string, string>) {
  const contents = new Map(Object.entries(initial));
  const files = new Map<string, TFile>();
  const file = (path: string): TFile => {
    if (!files.has(path)) files.set(path, Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/\.md$/, "") }));
    return files.get(path)!;
  };
  for (const path of contents.keys()) file(path);
  const trashFile = vi.fn(async (target: TFile) => { contents.delete(target.path); files.delete(target.path); });
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? (path === "Folder" ? new TFolder() : null),
      read: async (target: TFile) => contents.get(target.path) ?? "",
      process: async (target: TFile, change: (content: string) => string) => {
        const next = change(contents.get(target.path) ?? "");
        contents.set(target.path, next);
        return next;
      },
      create: async (path: string, content: string) => { contents.set(path, content); return file(path); },
      createFolder: async () => {}
    },
    fileManager: {
      trashFile,
      processFrontMatter: async (target: TFile, change: (frontmatter: Record<string, unknown>) => void) => {
        const frontmatter: Record<string, unknown> = {};
        change(frontmatter);
        const yaml = Object.entries(frontmatter).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
        contents.set(target.path, `---\n${yaml}\n---\n${(contents.get(target.path) ?? "").replace(/^---\n[\s\S]*?\n---\n/, "")}`);
      }
    },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null }
  } as unknown as App;
  const store = new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => false);
  const changes: TaskChange[] = [];
  store.onChange = change => changes.push(change);
  const tasks = (path: string) => scanTasks(path, contents.get(path) ?? "");
  return { app, store, contents, tasks, changes, trashFile, file };
}

describe("undo", () => {
  it("records a labelled change and restores the note", async () => {
    const { store, contents, tasks, changes } = vault({ "A.md": "- [ ] Pay rent\n- [ ] Call Sam\n" });
    await store.toggle(tasks("A.md")[0], true);
    expect(contents.get("A.md")).toBe("- [x] Pay rent\n- [ ] Call Sam\n");
    expect(changes.map(change => change.label)).toEqual(["Completed “Pay rent”"]);
    expect(await store.undo()).toEqual(["A.md"]);
    expect(contents.get("A.md")).toBe("- [ ] Pay rent\n- [ ] Call Sam\n");
    expect(store.lastChange()).toBeUndefined();
    await expect(store.undo()).rejects.toThrow("Nothing to undo.");
  });

  it("refuses without writing anything when a note changed since", async () => {
    const { store, contents, tasks } = vault({ "A.md": "- [ ] One\n", "B.md": "- [ ] Two\n" });
    await store.bulkDrop([tasks("A.md")[0]], { destination: "B.md" });
    expect(contents.get("A.md")).toBe("");
    expect(contents.get("B.md")).toBe("- [ ] One\n- [ ] Two\n");
    contents.set("B.md", "- [ ] One\n- [ ] Two\n- [ ] Typed later\n");
    await expect(store.undo()).rejects.toThrow("Can't undo: B has changed since.");
    expect(contents.get("A.md")).toBe("");
    expect(store.lastChange()?.label).toBe("Moved “One”");
    contents.set("B.md", "- [ ] One\n- [ ] Two\n");
    await store.undo();
    expect(contents.get("A.md")).toBe("- [ ] One\n");
    expect(contents.get("B.md")).toBe("- [ ] Two\n");
  });

  it("moves a note the action created to the trash", async () => {
    const { store, contents, trashFile } = vault({});
    await store.create({ title: "New idea", completed: false, destination: "Inbox.md", indent: 0 });
    expect(contents.get("Inbox.md")).toBe("- [ ] New idea\n");
    expect(store.lastChange()?.files).toEqual([{ path: "Inbox.md", before: undefined, after: "- [ ] New idea\n" }]);
    await store.undo();
    expect(trashFile).toHaveBeenCalledOnce();
    expect(contents.has("Inbox.md")).toBe(false);
  });

  it("undoes an older action on another note, but not one a later action built on", async () => {
    const { store, contents, tasks } = vault({ "A.md": "- [ ] One\n", "B.md": "- [ ] Two\n" });
    await store.toggle(tasks("A.md")[0], true);
    const older = store.lastChange()!;
    await store.toggle(tasks("B.md")[0], true);
    const toggledB = store.lastChange()!;
    await store.undo(older);
    expect(contents.get("A.md")).toBe("- [ ] One\n");
    expect(contents.get("B.md")).toBe("- [x] Two\n");
    await store.update(tasks("B.md")[0], { title: "Two", completed: true, priority: 1, destination: "B.md", indent: 0 });
    await expect(store.undo(toggledB)).rejects.toThrow("Can't undo: B has changed since.");
    await store.undo();
    expect(contents.get("B.md")).toBe("- [x] Two\n");
    await store.undo(toggledB);
    expect(contents.get("B.md")).toBe("- [ ] Two\n");
  });

  it("runs actions one at a time so each records only its own change", async () => {
    const { store, contents, tasks, changes } = vault({ "A.md": "- [ ] One\n- [ ] Two\n" });
    const [one, two] = tasks("A.md");
    await Promise.all([store.toggle(one, true), store.toggle(two, true)]);
    expect(contents.get("A.md")).toBe("- [x] One\n- [x] Two\n");
    expect(changes.map(change => change.files[0].after)).toEqual(["- [x] One\n- [ ] Two\n", "- [x] One\n- [x] Two\n"]);
    await store.undo();
    expect(contents.get("A.md")).toBe("- [x] One\n- [ ] Two\n");
  });

  it("records nothing for a failed action and makes frontmatter edits undoable", async () => {
    const { store, contents, changes, file } = vault({ "P.md": "Body\n" });
    await expect(store.delete({ ...scanTasks("P.md", "- [ ] Gone")[0] })).rejects.toThrow();
    expect(changes).toEqual([]);
    await store.updateFrontmatter(file("P.md"), frontmatter => { frontmatter["start-date"] = "2026-10-01"; }, "Changed dates of “P”");
    expect(contents.get("P.md")).toBe("---\nstart-date: 2026-10-01\n---\nBody\n");
    await store.undo();
    expect(contents.get("P.md")).toBe("Body\n");
  });

  it("keeps the last 20 actions", async () => {
    const { store, contents } = vault({ "A.md": "- [ ] Task\n" });
    for (let index = 0; index < 22; index++) {
      const [task] = scanTasks("A.md", contents.get("A.md")!);
      await store.toggle(task, !task.completed);
    }
    let undone = 0;
    while (store.lastChange()) { await store.undo(); undone++; }
    expect(undone).toBe(20);
    expect(contents.get("A.md")).toBe("- [ ] Task\n");
  });
});
