import { expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Plugin: class {}, ItemView: class {},
  MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
import TaskManagerPlugin from "../src/main";
import { TaskMainView } from "../src/task-view";
import { smartListDraft, type SmartListDraft } from "../src/smart-list-editor";
import { scanTasks } from "../src/parser";
import { taskMatchesQuery, sortTasks, groupTasks } from "../src/query";
const draft: SmartListDraft = { name: " Work queue ", filters: [{ property: "tags", operator: "is", values: ["work"], conditions: [{ join: "or", operator: "is", values: ["client"] }] }], sort: "priority", descending: false, grouping: "source" };
function setup() {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.app = { workspace: { getLeavesOfType: () => [] } } as unknown as App;
  let saved: unknown;
  plugin.saveData = vi.fn(async data => { saved = JSON.parse(JSON.stringify(data)); });
  plugin.loadData = vi.fn(async () => saved);
  return plugin;
}
it("persists smart lists, preserves their identity on edit, and restores settings", async () => {
  const plugin = setup();
  const list = await plugin.saveSmartList(draft);
  expect(list.name).toBe("Work queue");
  expect(list.id).toBeTruthy();
  const editing = smartListDraft(list);
  editing.filters[0].values[0] = "changed";
  expect(list.filters[0].values).toEqual(["work"]);
  const updated = await plugin.saveSmartList({ ...draft, name: "Client queue", descending: true }, list.id);
  expect(updated.id).toBe(list.id);
  expect(plugin.settings.smartLists).toHaveLength(1);
  plugin.settings.smartLists = [];
  await plugin.loadSettings();
  expect(plugin.settings.smartLists).toEqual([updated]);
});
it("leaves saved lists intact when persistence fails or input is invalid", async () => {
  const plugin = setup();
  const list = await plugin.saveSmartList(draft);
  await expect(plugin.saveSmartList({ ...draft, name: " " })).rejects.toThrow("list name");
  await expect(plugin.saveSmartList(draft, "missing")).rejects.toThrow("no longer exists");
  plugin.saveData = vi.fn().mockRejectedValue(new Error("Write failed"));
  await expect(plugin.saveSmartList({ ...draft, name: "New" }, list.id)).rejects.toThrow("Write failed");
  await expect(plugin.deleteSmartList(list.id)).rejects.toThrow("Write failed");
  expect(plugin.settings.smartLists).toEqual([list]);
});
it("deletes only the definition and redirects open copies of the list", async () => {
  const plugin = setup();
  const list = await plugin.saveSmartList(draft);
  const other = await plugin.saveSmartList({ ...draft, name: "Other" });
  const leaf = { view: { getState: () => ({ smartListId: list.id }) }, setViewState: vi.fn().mockResolvedValue(undefined) };
  plugin.app = { workspace: { getLeavesOfType: () => [leaf] } } as unknown as App;
  await plugin.deleteSmartList(list.id);
  expect(plugin.settings.smartLists).toEqual([other]);
  expect(leaf.setViewState).toHaveBeenCalledExactlyOnceWith({ type: "task-manager-main", state: { mode: "smartLists" } });
});
it("uses saved filters with AND/OR, sorting and grouping on current tasks", async () => {
  const plugin = setup();
  const list = await plugin.saveSmartList(draft);
  const tasks = scanTasks("Work.md", "- [ ] B p2 #[[work]]\n- [ ] A p1 #[[client]]\n- [ ] C p1 #[[home]]");
  const matches = sortTasks(tasks.filter(task => taskMatchesQuery(task, { mode: "smartLists", filters: list.filters, showCompleted: false }, "Inbox.md")), list.sort, list.descending);
  expect(matches.map(task => task.title)).toEqual(["A", "B"]);
  if (list.grouping === "default" || list.grouping === "none") throw new Error("Expected a property grouping");
  expect([...groupTasks(matches, list.grouping).keys()]).toEqual(["Work.md"]);
  const view = new TaskMainView({} as WorkspaceLeaf, plugin);
  vi.spyOn(view, "render").mockImplementation(() => {});
  await view.setState({ mode: "smartLists", smartListId: list.id });
  expect(view.getDisplayText()).toBe("Work queue");
  expect(view.getState().smartListId).toBe(list.id);
});

it("makes edit and delete targets available only for the open saved smart list", async () => {
  const plugin = setup();
  const list = await plugin.saveSmartList(draft);
  let state: Record<string, unknown> = { mode: "smartLists", smartListId: list.id };
  const view = { getState: () => state };
  plugin.app = { workspace: { getActiveViewOfType: () => view } } as unknown as App;
  const active = () => (plugin as unknown as { activeSmartList(): unknown }).activeSmartList();
  expect(active()).toEqual(list);
  state = { mode: "smartLists" }; expect(active()).toBeUndefined();
  state = { mode: "all", smartListId: list.id }; expect(active()).toBeUndefined();
  state = { mode: "smartLists", smartListId: "deleted" }; expect(active()).toBeUndefined();
});
