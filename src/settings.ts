import { Notice, PluginSettingTab, Setting, type App, type SettingDefinitionRender } from "obsidian";
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
        name: "Section heading level",
        desc: "Choose which heading level defines task sections and section destinations in task mode.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => {
          for (let level = 1; level <= 6; level++) dropdown.addOption(String(level), `Heading ${level}`);
          dropdown.setValue(String(this.plugin.settings.sectionHeadingLevel))
            .onChange(value => this.plugin.setSectionHeadingLevel(Number(value)));
        }); }
      },
      {
        name: "Date format",
        desc: "Moment date format for task dates, for example DD/MM/YYYY. Leave empty to use the Daily Notes format (YYYY-MM-DD if unset).",
        render: (setting: Setting) => { setting.addText(text => text
          .setPlaceholder("Daily Notes format")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(value => this.plugin.setDateFormat(value))); }
      },
      {
        name: "Link dates",
        desc: "Write scheduled and deadline dates as [[date]] links. When off, write plain dates. Applies when creating or editing tasks; existing notes are not rewritten automatically.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.linkDates).onChange(async value => {
          this.plugin.settings.linkDates = value;
          await this.plugin.saveSettings();
        })); }
      },
      {
        name: "Update dates",
        desc: "Update scheduled and deadline date tokens in all Markdown tasks in the vault, including completed tasks, to follow Date format and Link dates.",
        render: (setting: Setting) => { setting.addButton(button => button
          .setButtonText("Update dates")
          .onClick(async () => {
            button.setDisabled(true);
            try { await this.plugin.updateTaskDates(); }
            catch (error) { new Notice(String(error)); }
            finally { button.setDisabled(false); }
          })); }
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
      },
      {
        name: "Task highlight on hover",
        desc: "Highlight the task title, background, both, or neither when hovering over a task.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("none", "None").addOption("title", "Title").addOption("background", "Background").addOption("all", "All")
          .setValue(this.plugin.settings.taskHoverHighlight)
          .onChange(async value => {
            if (value !== "none" && value !== "title" && value !== "background" && value !== "all") return;
            this.plugin.settings.taskHoverHighlight = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })); }
      },
      {
        name: "Task height in list view",
        desc: "Minimum row height as a multiplier of the editor font size (minimum 1.0; default 1.0). Wrapped content and controls can make rows taller.",
        render: (setting: Setting) => { setting.addText(text => {
          text.inputEl.type = "number";
          text.inputEl.min = "1";
          text.inputEl.step = "0.1";
          text.setValue(String(this.plugin.settings.taskListRowHeightMultiplier)).onChange(async value => {
            const height = Number(value);
            if (!Number.isFinite(height) || height < 1) return;
            this.plugin.settings.taskListRowHeightMultiplier = height;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
        }); }
      },
      ...([
        ["showGroupTaskCounts", "Show task counts in group headings", "Show the number of tasks beside list group headings and Kanban column headings."],
        ["showSubtaskCounts", "Show subtask counts", "Show completed and total subtask counts beside tasks that have subtasks."]
      ] as const).map(([key, name, desc]) => ({
        name, desc,
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })); }
      })),
      ...([ ["hiddenListTaskProperties", "List"], ["hiddenKanbanTaskProperties", "Kanban"] ] as const).map(([key, layout]) => ({
        name: `Task properties — ${layout}`,
        desc: `Choose properties shown in ${layout.toLowerCase()} layout. Properties implied by the current view or grouping remain hidden.`,
        render: (setting: Setting) => {
          setting.settingEl.addClass("tm-property-visibility-setting");
          const choices = setting.controlEl.createDiv({ cls: "tm-property-visibility-choices", attr: { role: "group", "aria-label": `Task properties — ${layout}` } });
          for (const [property, label] of [
            ["source", "Project / source note"], ["scheduledDate", "Scheduled date"], ["scheduledTime", "Scheduled time"],
            ["deadline", "Deadline date"], ["deadlineTime", "Deadline time"], ["duration", "Duration"],
            ["priority", "Priority"], ["tags", "Tags"]] as const) {
            const choice = choices.createEl("label");
            const checkbox = choice.createEl("input", { type: "checkbox" });
            checkbox.checked = !(this.plugin.settings[key] ?? []).includes(property);
            choice.createSpan({ text: label });
            checkbox.addEventListener("change", () => {
              const hidden = (this.plugin.settings[key] ?? []).filter(item => item !== property);
              this.plugin.settings[key] = checkbox.checked ? hidden : [...hidden, property];
              void this.plugin.saveSettings().then(() => this.plugin.refreshViews());
            });
          }
        }
      })),
      ...([
        ["wrapTaskTitles", "List"],
        ["wrapCalendarTaskTitles", "Calendar"],
        ["wrapKanbanTaskTitles", "Kanban"]
      ] as const).map(([key, layout]) => ({
        name: `Wrap task titles — ${layout}`,
        desc: `Show long task titles on multiple lines in ${layout.toLowerCase()} layout. When off, show the beginning of the title with an ellipsis.`,
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })); }
      }))
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
