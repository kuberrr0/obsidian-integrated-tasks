import { expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Plugin: class {}, ItemView: class {},
  MarkdownView: class {}, Modal: class { open() {} }, PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
import TaskManagerPlugin from "../src/main";
import { ProjectCreatorModal, type ProjectDraft } from "../src/project-creator";
import type { TaskIndex } from "../src/task-index";

it("saves to the existing note, preserves its folder on rename, and refuses name collisions", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  const file = new TFile(); file.path = "Projects/Launch.md";
  const metadata: Record<string, unknown> = { tags: ["project"], date: "2026-09-18", custom: "keep" };
  const processFrontMatter = vi.fn(async (_file, update: (value: Record<string, unknown>) => void) => update(metadata));
  const renameFile = vi.fn(async (_file, path: string) => { file.path = path; });
  plugin.app = {
    vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : path === "Projects/Taken.md" ? new TFile() : null },
    metadataCache: { getFileCache: () => ({ frontmatter: metadata }) }, fileManager: { processFrontMatter, renameFile }
  } as unknown as App;
  const refreshPath = vi.fn();
  plugin.index = { projects: () => [{ path: file.path, name: "Launch", openTasks: 1, completedTasks: 0, archived: false }], refreshPath } as unknown as TaskIndex;
  vi.spyOn(plugin, "dateFormat").mockReturnValue("YYYY-MM-DD");
  vi.spyOn(plugin, "openProject").mockResolvedValue(undefined);
  let options!: { initial: ProjectDraft; createProject: (draft: ProjectDraft) => Promise<void> };
  const open = vi.spyOn(ProjectCreatorModal.prototype, "open").mockImplementation(function (this: ProjectCreatorModal) {
    options = (this as unknown as { options: typeof options }).options;
  });
  plugin.openProjectEditor(file.path, "deadline");
  await expect(options.createProject({ ...options.initial, name: "Taken" })).rejects.toThrow("already exists");
  expect(processFrontMatter).not.toHaveBeenCalled();
  await expect(options.createProject({ ...options.initial, parent: file.path })).rejects.toThrow("own parent");
  await options.createProject({ ...options.initial, name: "Renamed", priority: "1" });
  expect(renameFile).toHaveBeenCalledWith(file, "Projects/Renamed.md");
  expect(metadata.custom).toBe("keep");
  expect(metadata.priority).toBe(1);
  expect(refreshPath).toHaveBeenCalledWith("Projects/Renamed.md");
  expect(plugin.openProject).toHaveBeenCalledWith("Projects/Renamed.md");
  open.mockRestore();
});
