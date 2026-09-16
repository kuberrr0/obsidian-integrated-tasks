import { expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {},
  PluginSettingTab: class {}, Notice: class {}, Setting: class {}, setIcon: vi.fn()
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));
import TaskManagerPlugin from "../src/main";

it("defaults to Daily Notes, overrides it, and retains the source format until updating", async () => {
  const plugin = new TaskManagerPlugin({} as App, {} as never);
  plugin.app = {
    internalPlugins: { getPluginById: () => ({ instance: { options: { format: "DD.MM.YYYY" } } }) },
    vault: { getMarkdownFiles: () => [] }, workspace: { getLeavesOfType: () => [] }
  } as unknown as App;
  plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
  plugin.store = { updateDates: vi.fn().mockResolvedValue([]) } as never;
  expect(plugin.settings.dateFormat).toBe("");
  expect(plugin.dateFormat()).toBe("DD.MM.YYYY");
  await plugin.setDateFormat(" MM/DD/YYYY ");
  expect(plugin.dateFormat()).toBe("MM/DD/YYYY");
  await plugin.setDateFormat("YYYY/MM/DD");
  expect(plugin.settings.previousDateFormat).toBe("DD.MM.YYYY");
  await plugin.updateTaskDates();
  expect(plugin.store.updateDates).toHaveBeenCalledWith(["DD.MM.YYYY", "YYYY/MM/DD", "DD.MM.YYYY"]);
  expect(plugin.settings.previousDateFormat).toBeUndefined();
  await plugin.setDateFormat("   ");
  expect(plugin.dateFormat()).toBe("DD.MM.YYYY");
  plugin.app = {} as App;
  expect(plugin.dateFormat()).toBe("YYYY-MM-DD");
});
