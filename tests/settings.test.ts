import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type TaskManagerPlugin from "../src/main";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{
  name: string;
  desc: string;
  heading?: boolean;
  value?: string | boolean;
  change?: (value: string | boolean) => Promise<void>;
}> }));

vi.mock("obsidian", () => ({
  PluginSettingTab: class { containerEl = { empty: () => { rows.length = 0; } }; },
  Setting: class {
    row = { name: "", desc: "" } as typeof rows[number];
    constructor() { rows.push(this.row); }
    setName(name: string) { this.row.name = name; return this; }
    setDesc(desc: string) { this.row.desc = desc; return this; }
    setHeading() { this.row.heading = true; return this; }
    addToggle(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addText(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addDropdown(callback: (control: unknown) => void) { callback(this.control()); return this; }
    control() {
      const row = this.row;
      return {
        setPlaceholder() { return this; },
        addOption() { return this; },
        setValue(value: string | boolean) { row.value = value; return this; },
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
    settings: { taskMode: false, wrapTaskTitles: false, wrapCalendarTaskTitles: true, wrapKanbanTaskTitles: true, inboxPath: "Tasks.md", newTaskPosition: "top" },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshViews: vi.fn(),
    setTaskMode: vi.fn().mockResolvedValue(undefined)
  };
  const tab = new TaskManagerSettingTab({} as App, plugin as unknown as TaskManagerPlugin);
  return { plugin, tab };
}

describe("settings compatibility", () => {
  it("provides searchable names and descriptions without rendering or saving during indexing", () => {
    const { tab, plugin } = setup();
    const definitions = tab.getSettingDefinitions();
    expect(definitions.map(({ name }) => name)).toEqual(["Task mode", "Inbox note", "New task position", "Wrap task titles — List", "Wrap task titles — Calendar", "Wrap task titles — Kanban"]);
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
    const taskMode = rows.find(({ name }) => name === "Task mode")!;
    expect(taskMode.value).toBe(false);
    await taskMode.change!(true);
    expect(plugin.setTaskMode).toHaveBeenCalledWith(true);
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
    const wrap = rows.find(({ name }) => name === "Wrap task titles — List")!;
    expect(wrap.value).toBe(false);
    await wrap.change!(true);
    expect(plugin.settings.wrapTaskTitles).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(5);
    expect(plugin.refreshViews).toHaveBeenCalledTimes(3);
    const calendar = rows.find(({ name }) => name === "Wrap task titles — Calendar")!;
    const kanban = rows.find(({ name }) => name === "Wrap task titles — Kanban")!;
    expect(calendar.value).toBe(true);
    expect(kanban.value).toBe(true);
    await calendar.change!(false);
    expect(plugin.settings.wrapCalendarTaskTitles).toBe(false);
    expect(plugin.settings.wrapTaskTitles).toBe(true);
    expect(plugin.settings.wrapKanbanTaskTitles).toBe(true);
    await kanban.change!(false);
    expect(plugin.settings.wrapKanbanTaskTitles).toBe(false);
    expect(plugin.settings.wrapTaskTitles).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(7);
    expect(plugin.refreshViews).toHaveBeenCalledTimes(5);
  });
});
