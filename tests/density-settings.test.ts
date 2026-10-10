import { expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{ name: string; options: string[]; value?: string; change?: (value: string) => Promise<void> }> }));
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(),
  Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class { hide() {} }, Notice: class {}, setIcon: vi.fn(),
  Setting: class {
    row = { name: "", options: [] as string[] } as typeof rows[number];
    settingEl = { addClass() {} };
    constructor() { rows.push(this.row); }
    private control() {
      const row = this.row;
      const control = {
        setPlaceholder: () => control, setButtonText: () => control, setDisabled: () => control, onClick: () => control,
        addOption(value: string) { row.options.push(value); return control; },
        setValue(value: string) { row.value = value; return control; },
        onChange(change: typeof row.change) { row.change = change; return control; }
      };
      return control;
    }
    addText(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addToggle(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addDropdown(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addButton(callback: (control: unknown) => void) { callback(this.control()); return this; }
  }
}));
vi.mock("../src/note-token-editor", () => ({ noteTokenEditor: vi.fn() }));

import { Setting, type App } from "obsidian";
import TaskManagerPlugin from "../src/main";
import { TaskManagerSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/types";

it("defaults density to comfortable and keeps only known values", async () => {
  expect(DEFAULT_SETTINGS.density).toBe("comfortable");
  for (const [saved, expected] of [[null, "comfortable"], [{ density: "compact" }, "compact"], [{ density: "tiny" }, "comfortable"], [{ density: 3 }, "comfortable"]] as const) {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    plugin.loadData = vi.fn().mockResolvedValue(saved);
    await plugin.loadSettings();
    expect(plugin.settings.density).toBe(expected);
  }
});

it("offers a Density dropdown in Appearance that saves and refreshes task and navigation views", async () => {
  rows.length = 0;
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshViews: vi.fn(),
    refreshNavigation: vi.fn()
  };
  const tab = new TaskManagerSettingTab({} as App, plugin as unknown as TaskManagerPlugin);
  const definition = tab.getSettingDefinitions().find(group => group.heading === "Appearance")!.items.find(item => item.name === "Density")!;
  expect(definition.desc).toBe("Compact shows more tasks at once with tighter rows and spacing.");
  definition.render(new Setting({} as HTMLElement));
  const row = rows[0];
  expect(row.options).toEqual(["comfortable", "compact"]);
  expect(row.value).toBe("comfortable");
  await row.change!("compact");
  expect(plugin.settings.density).toBe("compact");
  expect(plugin.saveSettings).toHaveBeenCalledOnce();
  expect(plugin.refreshViews).toHaveBeenCalledOnce();
  expect(plugin.refreshNavigation).toHaveBeenCalledOnce();
  await row.change!("unknown");
  expect(plugin.settings.density).toBe("comfortable");
});

it("records completion dates unless turned off", async () => {
  expect(DEFAULT_SETTINGS.completionDates).toBe(true);
  for (const [saved, expected] of [[null, true], [{ completionDates: false }, false], [{ completionDates: "no" }, true]] as const) {
    const plugin = new TaskManagerPlugin({} as App, {} as never);
    plugin.loadData = vi.fn().mockResolvedValue(saved);
    await plugin.loadSettings();
    expect(plugin.settings.completionDates).toBe(expected);
  }
});
