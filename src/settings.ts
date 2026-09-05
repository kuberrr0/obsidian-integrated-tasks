import { PluginSettingTab, Setting, type App } from "obsidian";
import type TaskManagerPlugin from "./main";

export class TaskManagerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TaskManagerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Integrated Task Manager" });
    new Setting(containerEl)
      .setName("Inbox note")
      .setDesc("Quick-created tasks are inserted into this Markdown note’s checklist.")
      .addText((text) => text
        .setPlaceholder("Inbox.md")
        .setValue(this.plugin.settings.inboxPath)
        .onChange(async (value) => {
          const path = value.trim() || "Inbox.md";
          this.plugin.settings.inboxPath = path.endsWith(".md") ? path : `${path}.md`;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
    new Setting(containerEl)
      .setName("New task position")
      .setDesc("Insert added or moved tasks at the top or bottom of the first checklist in the destination file or heading. If there is no checklist, insert at the start of the scope.")
      .addDropdown((dropdown) => dropdown
        .addOption("top", "Top")
        .addOption("bottom", "Bottom")
        .setValue(this.plugin.settings.newTaskPosition)
        .onChange(async (value) => {
          this.plugin.settings.newTaskPosition = value === "bottom" ? "bottom" : "top";
          await this.plugin.saveSettings();
        }));
  }
}
