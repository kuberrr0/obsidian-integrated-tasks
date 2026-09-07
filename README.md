# Integrated Task Manager for Obsidian

A Markdown-native task manager with Inbox, Today, Upcoming, All Tasks, and Projects views. Your notes remain the only source of truth.

Requires Obsidian **1.7.2 or newer**, on desktop or mobile.

The plugin enumerates Markdown files in the current vault to build its local task and project index. It reads those notes and writes task changes to their source notes. This vault-wide access supports the cross-note views; indexing happens locally and does not upload notes or task data to an external service.

Enable **Task mode** in the sidebar, ribbon, settings, or with **Toggle task mode** in the command palette. All open project notes (tagged `#project`) switch to task views in their existing tabs, and newly opened projects do the same. Ordinary notes stay in Markdown. Turning task mode off restores the project tabs’ Markdown views. The setting is remembered across restarts.

**Convert to project** adds the `project` tag and missing `date`, `end date`, `deadline` and `priority` properties to the current note. Existing tags, property values, and supported property aliases are preserved. It also works from a page or project task view.

Every task view—Inbox, Today, Upcoming, All Tasks, individual projects, and any page—includes search, priority/date filters, sorting by date/priority/title/note order/duration in either direction, and grouping by date/priority/source note/status or no grouping. Views spanning multiple notes also have a source-note filter. **Group: View default** retains each view's original layout, including note headings for page and project views. Visible subtasks stay beside their parents, with the selected sort applied among siblings. Controls reset when switching to a different view or page.

Date sorting compares the date first, then the time on the same day, for both scheduled dates and deadlines. Action date sorting uses the earlier scheduled/deadline date and time. Date-only tasks come before timed tasks on the same day in ascending order. **Wrap task titles** has independent **List**, **Calendar**, and **Kanban** toggles, all enabled by default. Turning a layout’s toggle off shows the beginning of long titles followed by an ellipsis. Existing list-wrapping preferences are preserved; timed calendar cards remain limited to their scheduled duration.

## Task syntax

```markdown
- [ ] Draft launch notes [[05-09-2026]] 9pm 1h30m {[[07-09-2026]] noon} p1
```

- `#[[work]] #[[client notes]]` — multiple task tags (tag names can contain spaces)
- `[[05-09-2026]]` — scheduled date
- `9pm` — scheduled time (also accepts `21:00`, `9:30 pm`, `noon`, or `midnight`)
- `1h30m` — estimated duration
- `{[[07-09-2026]] noon}` — deadline with optional time
- `p1`, `p2`, or `p3` — priority

Date links use the format configured in Obsidian's Daily Notes settings (the example uses `DD-MM-YYYY`). ISO-formatted tasks remain supported, and the plugin falls back to `YYYY-MM-DD` when Daily Notes has no configured format. Metadata is parsed from the end of a checklist line. When creating or editing a task, type natural dates directly in the raw task text, such as `Call today`, `Review tomorrow`, or `Plan next Friday`; no brackets are needed. The detected date appears in Scheduled date and is saved as a date link. Use braces for a deadline, for example `Submit today {tomorrow}` or `Submit {2026-09-10}`. Braced dates fill Deadline independently of Scheduled date and are saved as `{[[date]]}` links. Explicit date links remain supported. Times can follow date links or appear in natural input: `Call tomorrow at 9pm {next Friday at noon}`. Scheduled and deadline times are independent, appear in task badges, and are saved in 24-hour `HH:mm` format. The editor’s scheduled and deadline fields accept dates with times. A time alone in new-task input, such as `Call at 9pm`, uses the next occurrence of that time. Date-only tasks keep no time.

Add tags after the task title alongside other trailing properties, for example `- [ ] Write report p1 #[[work]] #[[client notes]]`. The **Tags** field in task and bulk editors uses the same syntax; clearing it removes all tags. Tags appear as metadata, are searchable, and support Tags filters (Is matches any complete tag). Sorting and grouping by Tags use the complete tag set. Duplicate tags are saved once.

With **Task mode off**, type explicit `@` dates in Markdown checklist lines, for example `- [ ] do this task @today {@next week}`. Press Enter or move the caret to another line to convert them to `[[date]]` and `{[[date]]}` using your Daily Notes date format. Leaving a task line also orders recognized properties, even without an `@date`, as scheduled date/time, duration, deadline date/time, priority, then tags—the same order used in Task mode. Multiword dates stay editable until you leave the line; unrecognized expressions remain unchanged.

In Markdown notes, recognized task dates, durations, deadlines, and priorities appear as pills with the same property glyphs used in Task mode in **Live Preview** and **Reading view**. This is visual only: stored task lines keep their original syntax, with no emoji or symbol prefixes. Date pills in Live Preview and Reading view display dates in the Daily Notes format, even when the stored date uses another format. Placing the caret in a token exposes its original syntax; moving the cursor away restores the pill. Date links keep their original note targets and support click and Ctrl/Cmd-click. Source mode stays plain Markdown.

Add `#project` to a note body or its frontmatter tags to include it in Projects. Indented checklist items are displayed as parent-child task trees. Plain bullets (`-`, `*`, or `+`) nested under a checklist item form its description. Descriptions are hidden in List, Calendar, and Kanban layouts, but always appear as the last editable property in the New task, Edit task, and Edit task properties modals. Enter plain text or bullets in the description box; changes save as indented bullets and stay with the task when it is moved. Task search includes descriptions. Headings in project notes appear as sections in the task view, in note order. The Projects list shows completed tasks as a percentage of all tasks, including subtasks (empty projects show 0%). Notes tagged both `#project` and `#archived` are hidden from this list until **Show archived projects** is checked. Archiving a project does not hide its tasks from other task views.

The new-task modal's raw text field accepts multiple lines. Put each task on its own line and indent subtasks (plain task text or `- [ ]` checklists both work). Natural dates, deadlines, durations, and priorities are parsed separately on every task line. Indented plain bullets remain descriptions. Structured properties apply only to the first task; editing them preserves the remaining lines. The batch saves together to the main task's destination. **Enter** inserts a newline in raw text; **Cmd/Ctrl+Enter** saves in both the new-task and edit-task modals.

In **Projects**, select **Gantt** to display projects on a timeline, including their parent hierarchy. Bars run from `date` (or `start-date`) to `deadline` when present, otherwise to `end date`. When both finish dates exist, a draggable `|` marks `end date` independently, including dates later than the deadline. Drag the left/right edges to change the start/finish date, or drag the marker to change only the end date. If a project has no end date, click a day inside its bar to set one. Drag across an entirely undated project row to set start and end dates together. Edge handles appear on hover or keyboard focus; arrow keys on a focused handle adjust its date by one day. Changes save to the project's frontmatter, preserving property aliases and date-link formatting. Projects without enough dates remain visible with a link to edit their note.

`end date` and `deadline` are separate project properties; `end date` is no longer interpreted as a deadline alias.

Project note properties appear as the same badges used for tasks:

```yaml
---
tags: [project]
priority: p1
date: 2026-09-05
end date: 2026-09-10
deadline: 2026-09-12
---
```

Priority accepts `1`–`3`, `p1`–`p3`, or `high`/`medium`/`low`. Dates accept ISO dates or date links in the Daily Notes format. `start-date` and `end-date` (including space/underscore variants) are also supported. Empty properties are omitted.

In the task editor, use `~[[Project]]` to insert a task into the first checklist before any headings in a note, or `~[[Project#Heading]]` to target the first checklist in an existing heading’s section. Project headings are also available in the Destination dropdown. The **New task position** setting chooses **Top** (default) or **Bottom** of that checklist, preserving introductory prose and keeping subtasks with their parents. It applies to added tasks and tasks moved to another destination. A file-only destination searches only before the first heading; it never uses a heading’s checklist. A heading’s scope ends at the next heading. If the scope has no checklist, tasks are inserted at its start; YAML frontmatter stays at the top. The plugin does not create a Tasks heading.

## Development

```bash
npm install
npm test
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into `.obsidian/plugins/integrated-task-manager/` in a test vault, then enable **Integrated Task Manager** under Community plugins.

## License

[MIT](LICENSE), copyright 2026 Integrated Task Manager contributors.

The **Search task in list** command is available when task mode is on and the active task view is a project. It focuses the Search tasks field and selects its existing text without changing the layout or search.


Left-click a task’s body or title to open its editor. **Right-click** selects the task, **Shift+right-click** selects the visible range from the last selected task, and **Cmd/Ctrl+right-click** adds a task to the selection. Selection follows the current displayed order. Use **Escape** on a focused block or **Clear selection** to clear it.

With tasks selected, run **Edit task properties** (or use the selection toolbar) to bulk-edit scheduled date and time, deadline date and time, duration, priority, destination, and description. Shared values are prefilled; differing values show **Mixed — unchanged**. Only edited fields are applied, and **Clear** explicitly removes a property. **Save task** or **Cmd/Ctrl+Enter** saves; **Cancel** leaves tasks untouched; **Delete task** deletes selected tasks and their subtrees.

Drag a task directly to move it without selecting it first. Drag a selected block to move the selection together. List and Kanban drops preserve the selected blocks' displayed order and their descriptions/subtasks; dropping into a property group applies that group's property to the selected tasks. Calendar drops reschedule selected tasks to the dropped date/time. Selecting both a parent and a child never moves or deletes the child twice. Hidden or changed tasks are removed from the selection, and failed bulk writes restore earlier writes when the notes have not been edited concurrently.

Opening a project from the Projects list or Gantt view opens its note in a new tab and automatically enables task mode. Turning task mode off restores the note’s Markdown view. Older project tabs also follow the toggle.

Use the **+** glyph beside a task group or project heading to add a task with that group’s properties or destination prefilled. This also works for empty project headings and Kanban columns.
