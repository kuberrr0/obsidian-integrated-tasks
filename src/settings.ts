import { PluginSettingTab, Setting, type App } from "obsidian";
import type TaskManagerPlugin from "./main";

export class TaskManagerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TaskManagerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Task Manager" });
    new Setting(containerEl)
      .setName("Inbox note")
      .setDesc("Quick-created tasks are inserted at the top of this Markdown note.")
      .addText((text) => text
        .setPlaceholder("Inbox.md")
        .setValue(this.plugin.settings.inboxPath)
        .onChange(async (value) => {
          const path = value.trim() || "Inbox.md";
          this.plugin.settings.inboxPath = path.endsWith(".md") ? path : `${path}.md`;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
  }
}
