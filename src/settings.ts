import { PluginSettingTab, Setting, type App, type SettingDefinitionRender } from "obsidian";
import type TaskManagerPlugin from "./main";

export class TaskManagerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TaskManagerPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions() {
    return [
      {
        name: "Task mode",
        desc: "Open project notes in task view across all tabs. Turning this off restores their Markdown views.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.taskMode).onChange(value => this.plugin.setTaskMode(value))); }
      },
      {
        name: "Inbox note",
        desc: "Quick-created tasks are inserted into this Markdown note’s checklist.",
        render: (setting: Setting) => this.renderInboxSetting(setting)
      },
      {
        name: "New task position",
        desc: "Insert added or moved tasks at the top or bottom of the first checklist in the destination file or heading. If there is no checklist, insert at the start of the scope.",
        render: (setting: Setting) => this.renderPositionSetting(setting)
      }
    ] satisfies SettingDefinitionRender[];
  }

  // Obsidian versions before 1.13 use this imperative settings page.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Task defaults").setHeading();
    for (const definition of this.getSettingDefinitions()) {
      const setting = new Setting(containerEl)
        .setName(definition.name)
        .setDesc(definition.desc ?? "");
      definition.render(setting);
    }
  }

  private renderInboxSetting(setting: Setting): void {
    setting.addText((text) => text
      .setPlaceholder("Inbox.md")
      .setValue(this.plugin.settings.inboxPath)
      .onChange(async (value) => {
        const path = value.trim() || "Inbox.md";
        this.plugin.settings.inboxPath = path.endsWith(".md") ? path : `${path}.md`;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));
  }

  private renderPositionSetting(setting: Setting): void {
    setting.addDropdown((dropdown) => dropdown
      .addOption("top", "Top")
      .addOption("bottom", "Bottom")
      .setValue(this.plugin.settings.newTaskPosition)
      .onChange(async (value) => {
        this.plugin.settings.newTaskPosition = value === "bottom" ? "bottom" : "top";
        await this.plugin.saveSettings();
      }));
  }
}
