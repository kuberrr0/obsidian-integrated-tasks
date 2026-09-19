import { expect, it, vi } from "vitest";
import { type App, MarkdownView, TFile } from "obsidian";
vi.mock("obsidian", async original => ({
    ...await original<typeof import("./obsidian-mock")>(), Plugin: class {}, ItemView: class {},
    MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
import TaskManagerPlugin from "../src/main";
import { TaskMainView } from "../src/task-view";
import { scanTasks } from "../src/parser";

it.each([false, true])("routes recurring commands with task mode %s", async taskMode => {
    const file = Object.assign(new TFile(), { path: "Project.md" });
    const habit = Object.assign(new TFile(), { path: "Habit.md" });
    const content = "- [ ] Ordinary\n- [ ] [[Habit]] 2026-09-19";
    const task = scanTasks(file.path, content)[1];
    const save = vi.fn(async () => {});
    const clearSelection = vi.fn();
    const markdown = { file, editor: { getValue: () => content, getCursor: () => ({ line: 1 }) }, save };
    const view = { getSelectedTasks: () => [task], clearSelection };
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    Object.assign(plugin, { app: {
        workspace: { getActiveViewOfType: (type: unknown) => type === MarkdownView ? (!taskMode ? markdown : null) : type === TaskMainView ? (taskMode ? view : null) : null },
        metadataCache: { getFirstLinkpathDest: () => habit, getFileCache: () => ({ frontmatter: { tags: ["recurring-task"] } }) }
    } });
    plugin.settings.taskMode = taskMode;
    plugin.dateFormat = () => "YYYY-MM-DD";
    const resolveRecurring = vi.fn(async () => [file.path, habit.path]);
    const refreshPath = vi.fn(async () => {});
    Object.assign(plugin, { store: { resolveRecurring }, index: { refreshPath } });
    const command = (plugin as unknown as { recurringTaskCommand: (checking: boolean, outcome: "SKIPPED") => boolean }).recurringTaskCommand.bind(plugin);
    expect(command(true, "SKIPPED")).toBe(true);
    expect(resolveRecurring).not.toHaveBeenCalled();
    expect(command(false, "SKIPPED")).toBe(true);
    await vi.waitFor(() => expect(refreshPath).toHaveBeenCalledTimes(2));
    expect(resolveRecurring).toHaveBeenCalledWith(task, "SKIPPED");
    expect(save).toHaveBeenCalledTimes(taskMode ? 0 : 1);
    expect(clearSelection).toHaveBeenCalledTimes(taskMode ? 1 : 0);
});
