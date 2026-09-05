import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type TaskManagerPlugin from "../src/main";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{
  name: string;
  desc: string;
  heading?: boolean;
  value?: string;
  change?: (value: string) => Promise<void>;
}> }));

vi.mock("obsidian", () => ({
  PluginSettingTab: class { containerEl = { empty: () => { rows.length = 0; } }; },
  Setting: class {
    row = { name: "", desc: "" } as typeof rows[number];
    constructor() { rows.push(this.row); }
    setName(name: string) { this.row.name = name; return this; }
    setDesc(desc: string) { this.row.desc = desc; return this; }
    setHeading() { this.row.heading = true; return this; }
    addText(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addDropdown(callback: (control: unknown) => void) { callback(this.control()); return this; }
    control() {
      const row = this.row;
      return {
        setPlaceholder() { return this; },
        addOption() { return this; },
        setValue(value: string) { row.value = value; return this; },
        onChange(change: typeof row.change) { row.change = change; return this; }
      };
    }
  }
}));

import { Setting } from "obsidian";
import { TaskManagerSettingTab } from "../src/settings";

function setup() {
  rows.length = 0;
  const plugin = {
    settings: { inboxPath: "Tasks.md", newTaskPosition: "top" },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshViews: vi.fn()
  };
  const tab = new TaskManagerSettingTab({} as App, plugin as unknown as TaskManagerPlugin);
  return { plugin, tab };
}

describe("settings compatibility", () => {
  it("provides searchable names and descriptions without rendering or saving during indexing", () => {
    const { tab, plugin } = setup();
    const definitions = tab.getSettingDefinitions();
    expect(definitions.map(({ name }) => name)).toEqual(["Inbox note", "New task position"]);
    expect(definitions.every(({ desc }) => desc.length > 0)).toBe(true);
    expect(rows).toHaveLength(0);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it.each(["declarative", "legacy"])("preserves normalization and persistence in the %s page", async (mode) => {
    const { tab, plugin } = setup();
    if (mode === "legacy") {
      tab.display();
      expect(rows[0]).toMatchObject({ name: "Task defaults", heading: true });
    } else {
      for (const definition of tab.getSettingDefinitions()) {
        definition.render(new Setting({} as HTMLElement).setName(definition.name).setDesc(definition.desc));
      }
    }
    const inbox = rows.find(({ name }) => name === "Inbox note")!;
    const position = rows.find(({ name }) => name === "New task position")!;
    expect(inbox.value).toBe("Tasks.md");
    expect(position.value).toBe("top");
    await inbox.change!("  Projects/Queue  ");
    expect(plugin.settings.inboxPath).toBe("Projects/Queue.md");
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.refreshViews).toHaveBeenCalledOnce();
    await inbox.change!("   ");
    expect(plugin.settings.inboxPath).toBe("Inbox.md");
    await position.change!("bottom");
    expect(plugin.settings.newTaskPosition).toBe("bottom");
    await position.change!("invalid");
    expect(plugin.settings.newTaskPosition).toBe("top");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
  });
});
