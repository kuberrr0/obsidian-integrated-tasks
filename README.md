# Integrated Task Manager for Obsidian

A Markdown-native task manager with Inbox, Today, Upcoming, All Tasks, and Projects views. Your notes remain the only source of truth.

Requires Obsidian **1.7.2 or newer**, on desktop or mobile.

The plugin enumerates Markdown files in the current vault to build its local task and project index. It reads those notes and writes task changes to their source notes. This vault-wide access supports the cross-note views; indexing happens locally and does not upload notes or task data to an external service.

Enable **Task mode** in the sidebar, ribbon, settings, or with **Toggle task mode** in the command palette. All open project notes (tagged `#project`) switch to task views in their existing tabs, and newly opened projects do the same. Ordinary notes stay in Markdown. Turning task mode off restores the project tabs’ Markdown views. The setting is remembered across restarts.

**Convert to project** adds the `project` tag and missing `date`, `end date`, `deadline`, `priority`, and `duration` properties to the current note. Existing tags, property values, and supported property aliases are preserved. It also works from a page or project task view.

Every task view—Inbox, Today, Upcoming, All Tasks, individual projects, and any page—includes search, priority/date filters, sorting by date/priority/title/note order/duration in either direction, and grouping by date/priority/source note/status or no grouping. Views spanning multiple notes also have a source-note filter. **Group: View default** retains each view's original layout, including note headings for page and project views. Visible subtasks stay beside their parents, with the selected sort applied among siblings. Controls reset when switching to a different view or page.

## Task syntax

```markdown
- [ ] Draft launch notes [[05-09-2026]] 9pm 1h30m {[[07-09-2026]] noon} p1
```

- `[[05-09-2026]]` — scheduled date
- `9pm` — scheduled time (also accepts `21:00`, `9:30 pm`, `noon`, or `midnight`)
- `1h30m` — estimated duration
- `{[[07-09-2026]] noon}` — deadline with optional time
- `p1`, `p2`, or `p3` — priority

Date links use the format configured in Obsidian's Daily Notes settings (the example uses `DD-MM-YYYY`). ISO-formatted tasks remain supported, and the plugin falls back to `YYYY-MM-DD` when Daily Notes has no configured format. Metadata is parsed from the end of a checklist line. When creating a task, type natural dates directly in the task text, such as `Call today`, `Review tomorrow`, or `Plan next Friday`; no brackets are needed. The detected date appears in Scheduled date and is saved as a date link. Use braces for a deadline, for example `Submit today {tomorrow}` or `Submit {2026-09-10}`. Braced dates fill Deadline independently of Scheduled date and are saved as `{[[date]]}` links. Explicit date links remain supported. Times can follow date links or appear in natural input: `Call tomorrow at 9pm {next Friday at noon}`. Scheduled and deadline times are independent, appear in task badges, and are saved in 24-hour `HH:mm` format. The editor’s scheduled and deadline fields accept dates with times. A time alone in new-task input, such as `Call at 9pm`, uses the next occurrence of that time. Date-only tasks keep no time.

In Markdown notes, recognized task dates, durations, deadlines, and priorities appear as text pills in **Live Preview** and **Reading view**. This is visual only: stored task lines keep their original syntax, with no emoji or symbol prefixes. Live Preview pills style native text and links. Placing the caret in a token exposes its original syntax; moving the cursor away restores the pill. Date links retain Obsidian’s normal click and Ctrl/Cmd-click behavior. Source mode stays plain Markdown.

Add `#project` to a note body or its frontmatter tags to include it in Projects. Indented checklist items are displayed as parent-child task trees. Headings in project notes appear as sections in the task view, in note order. The Projects list shows completed tasks as a percentage of all tasks, including subtasks (empty projects show 0%). Notes tagged both `#project` and `#archived` are hidden from this list until **Show archived projects** is checked. Archiving a project does not hide its tasks from other task views.

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
duration: 1h30m
---
```

Priority accepts `1`–`3`, `p1`–`p3`, or `high`/`medium`/`low`. Duration accepts hours/minutes text or a number of minutes. Dates accept ISO dates or date links in the Daily Notes format. `start-date` and `end-date` (including space/underscore variants) are also supported. Empty properties are omitted.

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
