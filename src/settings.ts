import { normalizeIgnoredTag, parseIgnoreList } from "./ignore";
import { DEFAULT_COMPLETED_SECTION, completedSectionName } from "./structure";
import { Notice, PluginSettingTab, Setting, type App, type SettingDefinitionRender } from "obsidian";
import type TaskManagerPlugin from "./main";
import type { SidebarSection } from "./types";

/**
 * The settings page's groups, in order: where tasks go, how they are written in notes, which are left out, how views
 * look, what the task sidebar lists, the calendar's colors, and the Tasks plugin import.
 */
export const SETTING_GROUPS = ["General", "How tasks are written", "Ignored tasks", "Appearance", "Task sidebar", "Calendar", "Import"] as const;
type SettingGroup = typeof SETTING_GROUPS[number];

/** Text settings apply once typing pauses, so each keystroke does not save and re-index the vault. */
export const TEXT_SETTING_DELAY_MS = 500;

/** A date format with a year, a month and a day, or empty for the Daily notes format. */
function usableDateFormat(value: string): boolean {
  const format = value.trim();
  return !format || (/Y/.test(format) && /M/.test(format) && /D/.test(format));
}

export class TaskManagerSettingTab extends PluginSettingTab {
  private readonly pendingText = new Map<string, { timer: number; apply: () => Promise<void> }>();

  constructor(app: App, private readonly plugin: TaskManagerPlugin) {
    super(app, plugin);
  }

  private applySoon(key: string, apply: () => Promise<void>): void {
    const pending = this.pendingText.get(key);
    if (pending) window.clearTimeout(pending.timer);
    const timer = window.setTimeout(() => {
      this.pendingText.delete(key);
      void apply().catch(error => new Notice(String(error)));
    }, TEXT_SETTING_DELAY_MS);
    this.pendingText.set(key, { timer, apply });
  }

  private cancelSoon(key: string): void {
    const pending = this.pendingText.get(key);
    if (pending) window.clearTimeout(pending.timer);
    this.pendingText.delete(key);
  }

  /** Apply edits still waiting when the settings page closes. */
  hide(): void {
    for (const pending of this.pendingText.values()) {
      window.clearTimeout(pending.timer);
      void pending.apply().catch(error => new Notice(String(error)));
    }
    this.pendingText.clear();
    super.hide();
  }

  getSettingDefinitions() {
    const rows = this.getSettingRows();
    return SETTING_GROUPS.map(heading => ({
      type: "group" as const,
      heading,
      cls: "tm-settings-section",
      items: rows.filter(row => row.section === heading).map(row => ({
        name: row.name,
        desc: row.desc,
        render: (setting: Setting) => {
          setting.settingEl.addClass("tm-settings-row");
          row.render(setting);
        }
      }))
    }));
  }

  private getSettingRows() {
    return [
      {
        section: "General",
        name: "Inbox note",
        desc: "The note where quick-created tasks are saved.",
        render: (setting: Setting) => this.renderInboxSetting(setting)
      },
      {
        section: "General",
        name: "New project location",
        desc: "The folder where new projects are created, such as Projects. Leave empty for the vault root.",
        render: (setting: Setting) => { setting.addText(text => text
          .setPlaceholder("Vault root")
          .setValue(this.plugin.settings.projectFolder)
          .onChange(value => this.applySoon("projectFolder", () => this.plugin.setProjectFolder(value)))); }
      },
      {
        section: "General",
        name: "Move converted notes to the project location",
        desc: "When the Convert to project command turns a note into a project, also move the note to the new project location.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.moveConvertedProjects).onChange(async value => {
          this.plugin.settings.moveConvertedProjects = value;
          await this.plugin.saveSettings();
        })); }
      },
      {
        section: "General",
        name: "New task position",
        desc: "Insert added or moved tasks at the top or bottom of the first checklist in the destination file or heading. If there is no checklist, insert at the start of the scope.",
        render: (setting: Setting) => this.renderPositionSetting(setting)
      },
      {
        section: "General",
        name: "Completed tasks",
        desc: "Where a task goes in its note when you complete it: it stays where it is, moves below the other tasks in its list, or moves to the completed tasks section. Reopening a moved task puts it back at the top of its list, or of the section it came from.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("keep", "Keep in place")
          .addOption("bottom", "Move to the bottom of the list")
          .addOption("section", "Move to the completed tasks section")
          .setValue(this.plugin.settings.completedPlacement)
          .onChange(async value => {
            this.plugin.settings.completedPlacement = value === "bottom" || value === "section" ? value : "keep";
            await this.plugin.saveSettings();
          })); }
      },
      {
        section: "General",
        name: "Completed tasks section",
        desc: "The heading completed tasks move under when Completed tasks is set to the section, such as Task Log. It is added at the end of the note when missing, at the section heading level, with a heading below it for each section the tasks came from.",
        render: (setting: Setting) => { setting.addText(text => text
          .setPlaceholder(DEFAULT_COMPLETED_SECTION)
          .setValue(this.plugin.settings.completedSection)
          .onChange(value => this.applySoon("completedSection", async () => {
            this.plugin.settings.completedSection = completedSectionName(value);
            await this.plugin.saveSettings();
          }))); }
      },
      {
        section: "General",
        name: "Section heading level",
        desc: "Headings at this level become sections and task destinations. Default: Heading 1.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => {
          for (let level = 1; level <= 6; level++) dropdown.addOption(String(level), `Heading ${level}`);
          dropdown.setValue(String(this.plugin.settings.sectionHeadingLevel))
            .onChange(value => this.plugin.setSectionHeadingLevel(Number(value)));
        }); }
      },
      {
        section: "General",
        name: "Task mode",
        desc: "Open project notes in task view across all tabs. Turning this off restores their Markdown views.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.taskMode).onChange(value => this.plugin.setTaskMode(value))); }
      },
      {
        section: "General",
        name: "Show undo notices",
        desc: "After you complete, move, edit, or delete tasks from the plugin's views, show a notice with an Undo button. The Undo last task change command and Cmd/Ctrl+Z in task views work either way.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.showUndoNotices).onChange(async value => {
          this.plugin.settings.showUndoNotices = value;
          await this.plugin.saveSettings();
        })); }
      },
      {
        section: "How tasks are written",
        name: "Date format",
        desc: "Moment date format for task dates, for example DD/MM/YYYY. Leave empty to use the Daily notes format (YYYY-MM-DD if unset).",
        render: (setting: Setting) => { setting.addText(text => text
          .setPlaceholder("Daily notes format")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(value => {
            // A part-typed format, such as "DD/MM", would misread every date in the vault, so it waits until whole.
            if (usableDateFormat(value)) this.applySoon("dateFormat", () => this.plugin.setDateFormat(value));
            else this.cancelSoon("dateFormat");
          })); }
      },
      {
        section: "How tasks are written",
        name: "Link dates",
        desc: "Write scheduled and deadline dates as [[date]] links. When off, write plain dates. Applies when creating or editing tasks; existing notes are not rewritten automatically.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.linkDates).onChange(async value => {
          this.plugin.settings.linkDates = value;
          await this.plugin.saveSettings();
        })); }
      },
      {
        section: "How tasks are written",
        name: "Update dates",
        desc: "Rewrite task dates, and the completed and canceled dates in recurring-task notes, to follow Date format and Link dates.",
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
        section: "How tasks are written",
        name: "Tag format",
        desc: "How task tags are written, and the only form read as a tag: Obsidian's #tag (no spaces; they become hyphens), or #[[tag]], a link to a note named after the tag. Notes keep the tags they have until you convert them.",
        render: (setting: Setting) => {
          setting.addDropdown(dropdown => dropdown.addOption("hash", "#tag").addOption("wikilink", "#[[tag]]")
            .setValue(this.plugin.settings.tagFormat)
            .onChange(async value => { await this.plugin.setTagFormat(value as "hash" | "wikilink"); }));
          setting.addButton(button => button.setButtonText("Convert notes")
            .onClick(() => void this.plugin.convertTaskTags()));
        }
      },
      {
        section: "How tasks are written",
        name: "Record completion dates",
        desc: "When you complete a task, add the date it was completed, such as ✓Sep 27, 2026. Reopening the task removes it.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.completionDates).onChange(async value => {
          this.plugin.settings.completionDates = value;
          await this.plugin.saveSettings();
        })); }
      },
      {
        section: "Ignored tasks",
        name: "Ignored folders and notes",
        desc: "Tasks in these folders and notes are left out of every task view, list, and count. One per line, such as Templates/ or Journal/Private.md.",
        render: (setting: Setting) => this.renderIgnoreSetting(setting, "ignoredPaths", "Templates/\nArchive/")
      },
      {
        section: "Ignored tasks",
        name: "Ignored tags",
        desc: "Leave out notes with these tags in their properties, and tasks tagged with them. Ignoring a tag also ignores its nested tags. One per line, such as template or someday.",
        render: (setting: Setting) => this.renderIgnoreSetting(setting, "ignoredTags", "template\nsomeday")
      },
      {
        section: "Ignored tasks",
        name: "Task tag",
        desc: "Only checklist items with this tag, or a tag nested under it, are tasks; other checkboxes in your notes are left alone. New tasks get the tag. Leave empty to make every checklist item a task.",
        render: (setting: Setting) => this.renderTaskTagSetting(setting)
      },
      {
        section: "Ignored tasks",
        name: "Ignore tasks in code blocks",
        desc: "Leave out checklist items inside fenced code blocks (``` or ~~~), such as examples in notes. When off, they are tasks like any other.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.ignoreCodeBlockTasks)
          .onChange(value => this.plugin.setIgnoreCodeBlockTasks(value))); }
      },
      {
        section: "Appearance",
        name: "Style",
        desc: "How task lists and task properties look. Project properties look the same in every style.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("griply", "Griply").addOption("things", "Things")
          .setValue(this.plugin.settings.style)
          .onChange(async value => {
            this.plugin.settings.style = value === "things" ? "things" : "griply";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })); }
      },
      {
        section: "Appearance",
        name: "Task details",
        desc: "Where a task you open shows its details. Two panes: in a card in the list (Things) or the task editor (Griply). Three panes: only in the Task details sidebar, which a double-click brings up; new tasks open there too. Phones always use three panes, a tap bringing the sidebar up.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("view", "Two panes: in the view").addOption("sidebar", "Three panes: in the sidebar")
          .setValue(this.plugin.settings.taskDetails)
          .onChange(async value => {
            this.plugin.settings.taskDetails = value === "view" ? "view" : "sidebar";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            // The details have nowhere else to go.
            if (value === "sidebar") await this.plugin.activateTaskSidebar(false);
          })); }
      },
      {
        section: "Appearance",
        name: "Density",
        desc: "Compact shows more tasks at once with tighter rows and spacing.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("comfortable", "Comfortable").addOption("compact", "Compact")
          .setValue(this.plugin.settings.density)
          .onChange(async value => {
            this.plugin.settings.density = value === "comfortable" ? "comfortable" : "compact";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            this.plugin.refreshNavigation();
          })); }
      },
      {
        section: "Appearance",
        name: "Note group names",
        desc: "When tasks are grouped by note, name each group by the note's name alone, such as Launch, or by its full path, such as Projects/Website/Launch.",
        render: (setting: Setting) => { setting.addDropdown(dropdown => dropdown
          .addOption("name", "Note name only").addOption("path", "Full path")
          .setValue(this.plugin.settings.noteGroupLabel)
          .onChange(async value => {
            this.plugin.settings.noteGroupLabel = value === "path" ? "path" : "name";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })); }
      },
      {
        section: "Appearance",
        name: "Show subtasks in task views",
        desc: "In the Things style, list subtasks as their own rows under their task. When off, they appear in the task's card, and a subtask shows on its own only in views its task is not in. The Griply style always lists them.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.showSubtasks).onChange(async value => {
          this.plugin.settings.showSubtasks = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })); }
      },
      // Each of the task sidebar's sections can be left out of it.
      ...([
        ["favorites", "Favorites", "Show Favorites at the top: anything you add from its right-click menu, or drag in."],
        ["inbox", "Inbox", "Show the Inbox list."],
        ["today", "Today", "Show the Today list."],
        ["upcoming", "Upcoming", "Show the Upcoming list."],
        ["all", "All tasks", "Show the All Tasks list, with your smart lists under it."],
        ["projects", "Projects", "Show the Projects heading, which opens the Projects view, with your projects under it."],
        ["tags", "Tags", "Show the Tags heading with your tags under it."]
      ] as const satisfies ReadonlyArray<readonly [SidebarSection, string, string]>).map(([section, name, desc]) => ({
        section: "Task sidebar" as const, name, desc,
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(!this.plugin.settings.hiddenSidebarSections.includes(section)).onChange(async value => {
          const hidden = this.plugin.settings.hiddenSidebarSections.filter(item => item !== section);
          this.plugin.settings.hiddenSidebarSections = value ? hidden : [...hidden, section];
          await this.plugin.saveSettings();
          this.plugin.refreshNavigation();
        })); }
      })),
      {
        section: "Task sidebar",
        name: "Files",
        desc: "List the vault's files and folders below the other sections, so you can open notes without switching to the file explorer.",
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings.showFiles).onChange(async value => {
          this.plugin.settings.showFiles = value;
          await this.plugin.saveSettings();
          this.plugin.refreshNavigation();
        })); }
      },
      // The calendar can color its tasks.
      ...([
        ["calendarProjectColors", "Color calendar tasks by project", "Tint each task in the calendar with its project's color."],
        ["calendarPriorityColors", "Color calendar checkboxes by priority", "Color each calendar task's checkbox by its priority, as in lists."]
      ] as const).map(([key, name, desc]) => ({
        section: "Calendar" as const, name, desc,
        render: (setting: Setting) => { setting.addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })); }
      })),
      {
        section: "Import",
        name: "Import from the Tasks plugin",
        desc: "Convert tasks written for the Tasks plugin into this plugin's format. You'll see a preview first, and you can undo the import.",
        render: (setting: Setting) => { setting.addButton(button => button.setButtonText("Import…").onClick(() => this.plugin.openTasksImport())); }
      },
    ] satisfies (SettingDefinitionRender & { section: SettingGroup })[];
  }

  // Obsidian versions before 1.13 use this imperative settings page.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tm-settings");
    for (const group of this.getSettingDefinitions()) {
      const section = containerEl.createDiv({ cls: group.cls });
      new Setting(section).setName(group.heading).setHeading();
      for (const definition of group.items) {
        const setting = new Setting(section).setName(definition.name).setDesc(definition.desc);
        definition.render(setting);
      }
    }
  }

  private renderIgnoreSetting(setting: Setting, key: "ignoredPaths" | "ignoredTags", placeholder: string): void {
    setting.addTextArea(area => {
      area.setPlaceholder(placeholder).setValue((this.plugin.settings[key] ?? []).join("\n")).onChange(value => {
        this.applySoon(key, async () => {
          this.plugin.settings[key] = parseIgnoreList(value, key === "ignoredTags");
          await this.plugin.saveSettings();
          this.plugin.index.applyIgnoreRules();
        });
      });
      area.inputEl.rows = 3;
    });
  }

  private renderTaskTagSetting(setting: Setting): void {
    setting.addText(text => text
      .setPlaceholder("#task")
      .setValue(this.plugin.settings.taskTag ? `#${this.plugin.settings.taskTag}` : "")
      .onChange(value => {
        // Applied once typing pauses, so a part-typed tag never hides tasks.
        this.applySoon("taskTag", async () => {
          this.plugin.settings.taskTag = normalizeIgnoredTag(value);
          await this.plugin.saveSettings();
          this.plugin.index.applyIgnoreRules();
        });
      }));
  }

  private renderInboxSetting(setting: Setting): void {
    setting.addText((text) => text
      .setPlaceholder("Inbox.md")
      .setValue(this.plugin.settings.inboxPath)
      .onChange((value) => {
        // Applied once typing pauses, so tasks never go to a part-typed note.
        this.applySoon("inboxPath", async () => {
          const path = value.trim() || "Inbox.md";
          this.plugin.settings.inboxPath = path.endsWith(".md") ? path : `${path}.md`;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
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
