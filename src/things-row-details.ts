import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { repeatLabel } from "./parser";
import { deadlineIsOverdue, editable, taskDayDistance, taskDoneDateLabel, taskTimeDurationLabel, taskTimeLabel, type TaskDetailsOptions } from "./task-row-details";
import type { ProjectDraft } from "./project-creator";
import type { Project, Task } from "./types";

/** Where the Things style places a row's details: before the title, after it on the same line, and on a quieter line below. */
export interface ThingsRowParts {
    lead: HTMLElement;
    inline: HTMLElement;
    secondary: HTMLElement;
}

export interface ThingsDetailsOptions extends TaskDetailsOptions {
    /** Mark tasks scheduled for today (or earlier) with a star; off in the Today list itself. */
    todayMarker?: boolean;
}

/** "Tomorrow", a weekday within the coming week, then "Oct 8" (with the year outside the current one). */
export function thingsDateLabel(date: string, now = new Date()): string {
    const days = taskDayDistance(date, now);
    if (days === 1) return "Tomorrow";
    if (days > 1 && days < 7) return formatDate(date, "ddd");
    return taskDoneDateLabel(date, now);
}

/** "today", "1 day left", "12 days left", "3 days ago". */
export function thingsDeadlineLabel(date: string, now = new Date()): string {
    const days = taskDayDistance(date, now);
    if (days === 0) return "today";
    const count = Math.abs(days);
    return `${count} day${count === 1 ? "" : "s"} ${days < 0 ? "ago" : "left"}`;
}

function box(parent: HTMLElement, cls: string, text: string, title: string): HTMLElement {
    return parent.createSpan({ cls: `tm-things-box ${cls}`, text, attr: { title } });
}

export function renderThingsTaskDetails(parts: ThingsRowParts, task: Task, options: ThingsDetailsOptions): void {
    const now = options.now ?? new Date();
    const today = todayIso(now);
    const { grouping } = options;
    const show = options.show ?? ((): boolean => true);
    const actionDate = task.scheduledDate && task.deadline ? (task.scheduledDate < task.deadline ? task.scheduledDate : task.deadline) : task.scheduledDate ?? task.deadline;
    const showDate = (field: "scheduledDate" | "deadline") => show(field) && grouping !== field && !(grouping === "date" && task[field] === actionDate);

    // Before the title: a star for today, and for anything overdue, which Things folds into Today.
    // A completed date, when recorded, stands in for the scheduled one.
    const done = task.status === "done" && task.completedDate && show("completed") && grouping !== "completed" ? task.completedDate : undefined;
    const scheduled = !done && task.scheduledDate && showDate("scheduledDate") ? task.scheduledDate : undefined;
    const scheduledTitle = scheduled ? `Scheduled ${formatDate(scheduled, options.dateFormat)}` : "";
    const editScheduled = (element: HTMLElement): void => editable(element, `Edit scheduled date: ${formatDate(scheduled!, options.dateFormat)}`, "scheduledDate", () => options.edit("scheduledDate"));
    if (scheduled && scheduled <= today && options.todayMarker !== false) {
        const star = parts.lead.createSpan({ cls: `tm-things-today${scheduled < today ? " is-overdue" : ""}`, attr: { title: scheduledTitle } });
        setIcon(star, "star");
        editScheduled(star);
    }

    // After the title: a checklist mark for subtasks (next to the notes mark), repeat and tags.
    if (task.childIds.length) {
        const checklist = parts.inline.createSpan({ cls: "tm-things-checklist", attr: { role: "img", "aria-label": "Has subtasks", title: `${task.childIds.length} subtask${task.childIds.length === 1 ? "" : "s"}` } });
        setIcon(checklist, "list-todo");
        const notes = Array.from(parts.inline.children).find(child => child.classList.contains("tm-description-indicator"));
        notes?.after(checklist);
    }
    if (task.repeat && show("repeat") && grouping !== "repeat") {
        const label = repeatLabel(task.repeat);
        const repeat = parts.inline.createSpan({ cls: "tm-things-repeat", attr: { title: `Repeats ${task.repeat}` } });
        setIcon(repeat, "repeat");
        editable(repeat, `Edit repeat: ${label}`, "repeat", () => options.edit("repeat"));
    }
    if (show("tags") && grouping !== "tags") for (const tag of options.tags) {
        const label = parts.inline.createSpan({ cls: "tm-things-tag", text: tag });
        editable(label, `Edit tags: ${tag}`, `tag:${tag}`, () => options.edit("tags"));
    }

    // At the end of the line: date and time boxes, then the deadline.
    const trailing = parts.inline.createSpan({ cls: "tm-things-trailing" });
    if (done) box(trailing, "tm-things-done", taskDoneDateLabel(done, now), `Completed ${formatDate(done, options.dateFormat)}`);
    else if (scheduled && scheduled > today) editScheduled(box(trailing, "tm-things-when", thingsDateLabel(scheduled, now), scheduledTitle));
    const time = taskTimeDurationLabel(
        show("scheduledTime") && grouping !== "scheduledTime" ? task.scheduledTime : undefined,
        show("duration") && grouping !== "duration" ? task.durationMinutes : undefined
    );
    if (time) {
        const hasTime = Boolean(task.scheduledTime && show("scheduledTime") && grouping !== "scheduledTime");
        const label = box(trailing, "tm-things-time", time, hasTime ? "Scheduled time" : "Duration");
        editable(label, `Edit ${hasTime ? "scheduled date and time" : "duration"}: ${time}`, "time", () => options.edit(hasTime ? "scheduledDate" : "durationMinutes"));
    }
    const due = task.deadline && showDate("deadline") ? thingsDeadlineLabel(task.deadline, now) : "";
    const dueTime = task.deadlineTime && show("deadlineTime") && grouping !== "deadlineTime" ? taskTimeLabel(task.deadlineTime) : "";
    if (due || dueTime) {
        const urgent = !task.completed && (deadlineIsOverdue(task.deadline, task.deadlineTime, now) || task.deadline === today);
        const deadline = trailing.createSpan({ cls: `tm-things-deadline${urgent ? " is-urgent" : ""}`, attr: { title: `Deadline: ${[task.deadline && formatDate(task.deadline, options.dateFormat), dueTime].filter(Boolean).join(", ")}` } });
        setIcon(deadline.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
        deadline.createSpan({ text: [due, dueTime].filter(Boolean).join(", ") });
        editable(deadline, `Edit deadline: ${task.deadline ?? ""}${dueTime ? `, ${dueTime}` : ""}`, "deadline", () => options.edit("deadline"));
    }
    if (!trailing.childElementCount) trailing.remove();

    // Below the title: the note the task lives in, when the list spans several.
    if (options.source && show("source") && grouping !== "source") {
        const source = parts.secondary.createSpan({ cls: "tm-things-source", text: options.source.replace(/\.md$/i, "").split("/").pop(), attr: { title: options.source } });
        editable(source, `Open source note: ${options.source}`, "source", options.openSource);
    }
}

export interface ThingsProjectOptions {
    dateFormat: string;
    now?: Date;
    edit: (field: keyof ProjectDraft) => void;
}

/**
 * A project row as Things lists one: a count of its remaining tasks after the name, its dates and
 * deadline at the end of the line, and the parent project below.
 */
export function renderThingsProjectDetails(parts: ThingsRowParts, project: Project, options: ThingsProjectOptions): void {
    const now = options.now ?? new Date();
    const today = todayIso(now);
    // Ranges read as plain dates; a weekday on one end would be ambiguous.
    const label = (date: string): string => taskDoneDateLabel(date, now);
    if (project.openTasks) parts.inline.createSpan({ cls: "tm-things-count", text: String(project.openTasks), attr: { title: `${project.openTasks} remaining` } });
    // At the end of the line: the dates (a start still ahead reads like a task's; a range while it runs), then the deadline.
    const trailing = parts.inline.createSpan({ cls: "tm-things-trailing" });
    if (project.scheduledDate && project.endDate) {
        const range = box(trailing, "tm-things-when", `${label(project.scheduledDate)} – ${label(project.endDate)}`,
            `${formatDate(project.scheduledDate, options.dateFormat)} – ${formatDate(project.endDate, options.dateFormat)}`);
        editable(range, `Edit project dates: ${range.textContent ?? ""}`, "project-date", () => options.edit("date"));
    } else if (project.scheduledDate && project.scheduledDate > today) {
        const start = box(trailing, "tm-things-when", thingsDateLabel(project.scheduledDate, now), `Starts ${formatDate(project.scheduledDate, options.dateFormat)}`);
        editable(start, `Edit project start date: ${start.textContent ?? ""}`, "project-date", () => options.edit("date"));
    } else if (project.endDate) {
        const end = box(trailing, "tm-things-when", `Until ${label(project.endDate)}`, `Ends ${formatDate(project.endDate, options.dateFormat)}`);
        editable(end, `Edit project end date: ${end.textContent ?? ""}`, "project-end", () => options.edit("endDate"));
    }
    renderThingsProjectDeadline(trailing, project, options);
    if (!trailing.childElementCount) trailing.remove();
    if (project.parent) {
        const name = project.parent.replace(/\.md$/i, "");
        const parent = parts.secondary.createSpan({ cls: "tm-things-source", text: name.split("/").pop(), attr: { title: name } });
        editable(parent, `Edit parent project: ${name}`, "project-parent", () => options.edit("parent"));
    }
}

/** A project's deadline as a Things row shows it: a flag and "N days left", red once due; opens the deadline editor. */
export function renderThingsProjectDeadline(parent: HTMLElement, project: Project, options: ThingsProjectOptions): void {
    if (!project.deadline) return;
    const now = options.now ?? new Date();
    const urgent = deadlineIsOverdue(project.deadline, project.deadlineTime, now) || project.deadline === todayIso(now);
    const time = project.deadlineTime ? taskTimeLabel(project.deadlineTime) : "";
    const deadline = parent.createSpan({ cls: `tm-things-deadline${urgent ? " is-urgent" : ""}`, attr: { title: `Deadline: ${[formatDate(project.deadline, options.dateFormat), time].filter(Boolean).join(", ")}` } });
    setIcon(deadline.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
    deadline.createSpan({ text: [thingsDeadlineLabel(project.deadline, now), time].filter(Boolean).join(", ") });
    editable(deadline, `Edit project deadline: ${formatDate(project.deadline, options.dateFormat)}`, "project-deadline", () => options.edit("deadline"));
}
