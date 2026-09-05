# Task Manager for Obsidian

A Markdown-native task manager with Inbox, Today, Upcoming, All Tasks, and Projects views. Your notes remain the only source of truth.

## Task syntax

```markdown
- [ ] Draft launch notes [[05-09-2026]] 1h30m {[[07-09-2026]]} p1
```

- `[[05-09-2026]]` — scheduled date
- `1h30m` — estimated duration
- `{[[07-09-2026]]}` — deadline
- `p1`, `p2`, or `p3` — priority

Date links use the format configured in Obsidian's Daily Notes settings (the example uses `DD-MM-YYYY`). ISO-formatted tasks remain supported, and the plugin falls back to `YYYY-MM-DD` when Daily Notes has no configured format. Metadata is parsed from the end of a checklist line. When creating a task, type natural dates directly in the task text, such as `Call today`, `Review tomorrow`, or `Plan next Friday`; no brackets are needed. The detected date appears in Scheduled date and is saved as a date link. Use braces for a deadline, for example `Submit today {tomorrow}` or `Submit {2026-09-10}`. Braced dates fill Deadline independently of Scheduled date and are saved as `{[[date]]}` links. Explicit date links remain supported.

In Markdown notes, recognized task dates, durations, deadlines, and priorities appear as text pills in **Live Preview** and **Reading view**. This is visual only: stored task lines keep their original syntax, with no emoji or symbol prefixes. Live Preview pills style native text and links. Placing the caret in a token exposes its original syntax; moving the cursor away restores the pill. Date links retain Obsidian’s normal click and Ctrl/Cmd-click behavior. Source mode stays plain Markdown.

Add `#project` to a note body or its frontmatter tags to include it in Projects. Indented checklist items are displayed as parent-child task trees. Headings in project notes appear as sections in the task view, in note order. The Projects list shows completed tasks as a percentage of all tasks, including subtasks (empty projects show 0%). Notes tagged both `#project` and `#archived` are hidden from this list until **Show archived projects** is checked. Archiving a project does not hide its tasks from other task views.

Project note properties appear as the same badges used for tasks:

```yaml
---
tags: [project]
priority: p1
date: 2026-09-05
end date: 2026-09-10
duration: 1h30m
---
```

Priority accepts `1`–`3`, `p1`–`p3`, or `high`/`medium`/`low`. Duration accepts hours/minutes text or a number of minutes. Dates accept ISO dates or date links in the Daily Notes format. `start-date` and `end-date` (including space/underscore variants) are also supported. Empty properties are omitted.

In the task editor, use `~[[Project]]` to insert a task at the top of a note, or `~[[Project#Heading]]` to insert it directly below an existing heading. Project headings are also available in the Destination dropdown. New tasks appear before existing content; YAML frontmatter stays at the top. The plugin does not create a Tasks heading.

## Development

```bash
npm install
npm test
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into `.obsidian/plugins/task-manager/` in a test vault, then enable **Task Manager** under Community plugins.
