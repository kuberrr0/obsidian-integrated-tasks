import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { repeatLabel } from "./parser";
import { deadlineIsOverdue, editable, taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import type { TaskEditorProperty } from "./task-editor";
import { checkboxLabel, statusClass } from "./task-status";
import { renderThingsTaskDetails, thingsDeadlineLabel, type ThingsDetailsOptions } from "./things-row-details";
import type { Task } from "./types";

/** The card's unsaved title and notes, kept by the view so a re-render does not lose typing. */
export interface TaskCardDraft {
    title: string;
    notes: string;
}

export interface TaskCardOptions {
    task: Task;
    /** How a subtask's properties render in the checklist, as on its own row. */
    childDetails?: (child: Task) => ThingsDetailsOptions;
    /** Subtasks, shown as the card's checklist. */
    children: Task[];
    draft: TaskCardDraft;
    tags: string[];
    /** Nesting level, matching the rows around the card. */
    depth: number;
    now?: Date;
    change: (draft: TaskCardDraft) => void;
    toggle: (task: Task, completed: boolean) => void;
    edit: (property: TaskEditorProperty) => void;
    collapse: () => void;
}

/**
 * Notes as Things shows them: top-level bullets read as plain lines. Saving turns each plain line
 * back into a bullet (see `descriptionLines`), so the note file keeps its shape.
 */
export function cardNotes(description: string | undefined): string {
    return (description ?? "").split("\n").map(line => line.replace(/^[-*+] (?!\[[ xX/?-]\])/, "")).join("\n");
}

/** "Thu, Oct 8", with the year outside the current one. */
function longDate(date: string, now: Date): string {
    return formatDate(date, date.slice(0, 4) === String(now.getFullYear()) ? "ddd, MMM D" : "ddd, MMM D, YYYY");
}

function autosize(area: HTMLTextAreaElement): void {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
}

/**
 * A task opened in place, as in Things: title and notes edit directly, subtasks form a checklist,
 * and each set property is a line that opens its editor. Toolbar buttons add the properties not set yet.
 */
export function renderThingsTaskCard(parent: HTMLElement, options: TaskCardOptions): HTMLElement {
    const { task, draft } = options;
    const now = options.now ?? new Date();
    const today = todayIso(now);
    const card = parent.createDiv({ cls: `tm-things-card tm-task-item${task.completed ? " is-completed" : ""}`, attr: { "data-task-id": task.id, role: "listitem" } });
    card.style.setProperty("--tm-depth", String(options.depth));

    const head = card.createDiv({ cls: "tm-things-card-head" });
    const checkbox = head.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task), "data-tm-focus-key": "card-checkbox" } });
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => options.toggle(task, checkbox.checked));
    const title = head.createEl("input", { type: "text", cls: "tm-things-card-title", value: draft.title, attr: { "aria-label": "Title", placeholder: "New To-Do", "data-tm-focus-key": "card-title" } });
    const notes = card.createEl("textarea", { cls: "tm-things-card-notes", attr: { "aria-label": "Notes", placeholder: "Notes", rows: "1", "data-tm-focus-key": "card-notes" } });
    notes.value = draft.notes;
    const change = (): void => options.change({ title: title.value, notes: notes.value });
    title.addEventListener("input", change);
    notes.addEventListener("input", () => { autosize(notes); change(); });
    // Enter in the title moves on to the notes, as in Things.
    title.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); notes.focus(); }
    });
    card.addEventListener("keydown", event => {
        // Escape, or Cmd/Ctrl+Enter, closes the card and saves it.
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
            event.preventDefault(); event.stopPropagation();
            options.collapse();
        }
        // Keep row shortcuts (M, S, arrows) from acting while typing.
        else event.stopPropagation();
    });
    requestAnimationFrame(() => autosize(notes));

    if (options.children.length) {
        const checklist = card.createDiv({ cls: "tm-things-card-checklist", attr: { role: "list", "aria-label": "Subtasks" } });
        for (const child of options.children) {
            // Not a label: clicking a property must open its editor, not tick the box.
            const item = checklist.createDiv({ cls: `tm-things-card-check${child.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
            const box = item.createEl("input", { type: "checkbox", cls: "tm-things-card-check-box", attr: { "aria-label": checkboxLabel(child) } });
            box.checked = child.completed;
            box.addEventListener("change", () => options.toggle(child, box.checked));
            // Subtasks show their properties as task rows do: a star or date box, then tags and the deadline.
            const lead = item.createSpan({ cls: "tm-things-lead" });
            item.createSpan({ cls: "tm-things-card-check-title", text: child.title });
            if (options.childDetails) renderThingsTaskDetails({ lead, inline: item, secondary: item }, child, options.childDetails(child));
            if (!lead.childElementCount) lead.remove();
        }
    }

    const properties = card.createDiv({ cls: "tm-things-card-properties" });
    const line = (icon: string, label: string, property: TaskEditorProperty, extra?: string, cls = ""): HTMLElement => {
        const element = properties.createDiv({ cls: `tm-things-card-property${cls ? ` ${cls}` : ""}` });
        setIcon(element.createSpan({ cls: "tm-things-card-icon", attr: { "aria-hidden": "true" } }), icon);
        element.createSpan({ cls: "tm-things-card-label", text: label });
        if (extra) element.createSpan({ cls: "tm-things-card-extra", text: extra });
        editable(element, `Edit ${label}`, `card-${property}`, () => options.edit(property));
        return element;
    };
    if (options.tags.length) {
        const tags = properties.createDiv({ cls: "tm-things-card-tags" });
        for (const tag of options.tags) editable(tags.createSpan({ cls: "tm-things-card-tag", text: tag }), `Edit tags: ${tag}`, `card-tag:${tag}`, () => options.edit("tags"));
    }
    if (task.scheduledDate) {
        const isToday = task.scheduledDate <= today;
        line(isToday ? "star" : "calendar", isToday ? "Today" : longDate(task.scheduledDate, now), "scheduledDate",
            task.scheduledDate < today ? `since ${longDate(task.scheduledDate, now)}` : undefined, isToday ? "is-today" : "");
    }
    const time = taskTimeDurationLabel(task.scheduledTime, task.durationMinutes);
    if (time) line("clock", time, task.scheduledTime ? "scheduledDate" : "durationMinutes");
    if (task.repeat) line("repeat", `Repeats ${repeatLabel(task.repeat).toLowerCase()}`, "repeat");
    if (task.deadline) {
        const urgent = !task.completed && (deadlineIsOverdue(task.deadline, task.deadlineTime, now) || task.deadline === today);
        const label = `Deadline: ${longDate(task.deadline, now)}${task.deadlineTime ? `, ${taskTimeLabel(task.deadlineTime)}` : ""}`;
        line("flag", label, "deadline", thingsDeadlineLabel(task.deadline, now), urgent ? "is-urgent" : "");
    }
    if (!properties.childElementCount) properties.remove();

    // Things keeps buttons for the properties not set yet at the card's bottom right.
    const toolbar = card.createDiv({ cls: "tm-things-card-toolbar" });
    const add = (icon: string, label: string, property: TaskEditorProperty): void => {
        const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label, "data-tm-focus-key": `card-add-${property}` } });
        setIcon(button, icon);
        button.addEventListener("click", event => { event.stopPropagation(); options.edit(property); });
    };
    if (!task.scheduledDate) add("calendar", "When", "scheduledDate");
    if (!options.tags.length) add("tag", "Tags", "tags");
    if (!task.repeat) add("repeat", "Repeat", "repeat");
    if (!task.deadline) add("flag", "Deadline", "deadline");
    if (!toolbar.childElementCount) toolbar.remove();
    return card;
}
