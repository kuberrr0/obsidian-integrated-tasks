import { expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
vi.mock("obsidian", async original => ({
    ...await original<typeof import("./obsidian-mock")>(), Plugin: class {}, ItemView: class {},
    MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
import TaskManagerPlugin from "../src/main";
import { scanTasks } from "../src/parser";

it("completes a note checkbox once while saving and refreshing its notes", async () => {
    const file = Object.assign(new TFile(), { path: "Project.md" });
    const habit = Object.assign(new TFile(), { path: "Habit.md" });
    const task = scanTasks(file.path, "- [ ] [[Habit]] 2026-09-19")[0];
    const save = vi.fn(async () => {});
    const resolveRecurring = vi.fn(async () => [file.path, habit.path]);
    const refreshPath = vi.fn(async () => {});
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    Object.assign(plugin, { app: {
        workspace: { getActiveViewOfType: () => ({ file, save }) },
        metadataCache: { getFirstLinkpathDest: () => habit, getFileCache: () => ({ frontmatter: { tags: "recurring-task" } }) }
    }, store: { resolveRecurring }, index: { refreshPath } });
    const complete = (plugin as unknown as { completeRecurringTaskFromNote: (candidate: typeof task) => boolean }).completeRecurringTaskFromNote.bind(plugin);
    expect(complete(task)).toBe(true);
    expect(complete(task)).toBe(true);
    await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledOnce();
    expect(resolveRecurring).toHaveBeenCalledExactlyOnceWith(task, "COMPLETED");
    plugin.settings.taskMode = true;
    expect(complete(task)).toBe(false);
});
