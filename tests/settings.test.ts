import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { App } from "obsidian";
import type TaskManagerPlugin from "../src/main";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{
  name: string;
  desc: string;
  heading?: boolean;
  click?: () => Promise<void>;
  disabled?: boolean;
  value?: string | boolean;
  change?: (value: string | boolean) => Promise<void>;
}> }));

vi.mock("obsidian", () => ({
  Notice: class {},
  PluginSettingTab: class { containerEl = { empty: () => { rows.length = 0; }, addClass: vi.fn(), createDiv: () => ({}) }; hide() {} },
  Setting: class {
    row = { name: "", desc: "" } as typeof rows[number];
    settingEl = { addClass: vi.fn() };
    constructor() { rows.push(this.row); }
    setName(name: string) { this.row.name = name; return this; }
    setDesc(desc: string) { this.row.desc = desc; return this; }
    setHeading() { this.row.heading = true; return this; }
    addButton(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addToggle(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addText(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addTextArea(callback: (control: unknown) => void) { callback(this.control()); return this; }
    addDropdown(callback: (control: unknown) => void) { callback(this.control()); return this; }
    control() {
      const row = this.row;
      return {
        inputEl: { type: "", min: "", max: "", step: "" },
        setButtonText() { return this; },
        setDisabled(value: boolean) { row.disabled = value; return this; },
        onClick(click: typeof row.click) { row.click = click; return this; },
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
    settings: { dateFormat: "", taskMode: false, linkDates: true, inboxPath: "Tasks.md", newTaskPosition: "top" },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshViews: vi.fn(),
    setDateFormat: vi.fn().mockResolvedValue(undefined),
    updateTaskDates: vi.fn().mockResolvedValue(undefined),
    setTaskMode: vi.fn().mockResolvedValue(undefined),
    index: { applyIgnoreRules: vi.fn() }
  };
  const tab = new TaskManagerSettingTab({} as App, plugin as unknown as TaskManagerPlugin);
  return { plugin, tab };
}

describe("settings compatibility", () => {
  it("provides searchable names and descriptions without rendering or saving during indexing", () => {
    const { tab, plugin } = setup();
    const groups = tab.getSettingDefinitions();
    expect(groups.map(group => [group.heading, group.items.map(item => item.name)])).toEqual([
      ["General", ["Inbox note", "New task position", "Section heading level", "Task mode", "Show undo notices"]],
      ["How tasks are written", ["Date format", "Link dates", "Update dates", "Tag format", "Record completion dates"]],
      ["Ignored tasks", ["Ignored folders and notes", "Ignored tags"]],
      ["Appearance", ["Style", "Task details", "Density", "Show files in sidebar", "Show subtasks in task views"]],
      ["Calendar", ["Color calendar tasks by project", "Color calendar checkboxes by priority"]],
      ["Import", ["Import from the Tasks plugin"]]
    ]);
    const definitions = groups.flatMap(group => group.items);
    expect(definitions.every(({ desc }) => desc.length > 0)).toBe(true);
    expect(rows).toHaveLength(0);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it.each(["declarative", "legacy"])("preserves normalization and persistence in the %s page", async (mode) => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const { tab, plugin } = setup();
    if (mode === "legacy") {
      tab.display();
      expect(rows[0]).toMatchObject({ name: "General", heading: true });
    } else {
      for (const definition of tab.getSettingDefinitions().flatMap(group => group.items)) {
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
    await inbox.change!("  Projects/Qu");
    await inbox.change!("  Projects/Queue  ");
    expect(plugin.settings.inboxPath).toBe("Projects/Queue.md");
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.refreshViews).toHaveBeenCalledOnce();
    await inbox.change!("   ");
    expect(plugin.settings.inboxPath).toBe("Inbox.md");
    // Closing the settings page applies an edit that is still waiting.
    tab.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    expect(plugin.refreshViews).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    await position.change!("bottom");
    expect(plugin.settings.newTaskPosition).toBe("bottom");
    await position.change!("invalid");
    expect(plugin.settings.newTaskPosition).toBe("top");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
    const links = rows.find(({ name }) => name === "Link dates")!;
    expect(links.value).toBe(true);
    await links.change!(false);
    expect(plugin.settings.linkDates).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(5);
    expect(plugin.refreshViews).toHaveBeenCalledTimes(2);
  });
});

 it("saves ignored folders and tags once typing pauses, and re-applies them to the index", async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const { tab, plugin } = setup();
    tab.display();
    const folders = rows.find(row => row.name === "Ignored folders and notes")!;
    const tags = rows.find(row => row.name === "Ignored tags")!;
    expect(folders.value).toBe("");
    await folders.change!("Templates/\n Archive ");
    await tags.change!("#Template, someday");
    expect(plugin.settings).toMatchObject({ ignoredPaths: ["Templates/", "Archive"], ignoredTags: ["template", "someday"] });
    expect(plugin.index.applyIgnoreRules).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.index.applyIgnoreRules).toHaveBeenCalled();
  });

  it("changes the format once typing pauses and runs the date updater with a disabled button until completion", async () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const { tab, plugin } = setup();
    tab.display();
    const format = rows.find(row => row.name === "Date format")!;
    expect(format.value).toBe("");
    for (const typed of ["D", "DD", "DD/", "DD/MM", "DD/MM/YYYY"]) {
      await format.change!(typed);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(plugin.setDateFormat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(plugin.setDateFormat).toHaveBeenCalledExactlyOnceWith("DD/MM/YYYY");
    const update = rows.find(row => row.name === "Update dates")!;
    const pending = update.click!();
    expect(update.disabled).toBe(true);
    await pending;
    expect(plugin.updateTaskDates).toHaveBeenCalledOnce();
    expect(update.disabled).toBe(false);
    plugin.updateTaskDates.mockRejectedValueOnce(new Error("Write failed"));
    await update.click!();
    expect(update.disabled).toBe(false);
 });
