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
    /** Mark tasks scheduled for today with a star; off in the Today list itself. */
    todayMarker?: boolean;
    /** Mark tasks that have subtasks; off where the subtasks are listed as rows themselves. */
    subtaskMark?: boolean;
    /** Put the dates, time and deadline on the line below the title instead of at its end (on phones). */
    datesBelow?: boolean;
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

/** A date as plain text after its icon, as the deadline reads. */
function dateText(parent: HTMLElement, cls: string, text: string, title: string, icon = "calendar"): HTMLElement {
    const element = parent.createSpan({ cls: `tm-things-date ${cls}`, attr: { title } });
    setIcon(element.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), icon);
    element.createSpan({ text });
    return element;
}

export function renderThingsTaskDetails(parts: ThingsRowParts, task: Task, options: ThingsDetailsOptions): void {
    const now = options.now ?? new Date();
    const today = todayIso(now);
    // Only a note or tag grouping hides its property (the group heading already names it);
    // grouped by a date, priority, repeat and the like, each row still shows its own value.
    const byNote = options.grouping === "source", byTag = options.grouping === "tags";
    const show = options.show ?? ((): boolean => true);
    const showDate = (field: "scheduledDate" | "deadline") => show(field);

    // Before the title: a star for today. An earlier date shows in its box, as a later one does.
    // A completed date, when recorded, stands in for the scheduled one.
    const done = task.status === "done" && task.completedDate && show("completed") ? task.completedDate : undefined;
    const scheduled = !done && task.scheduledDate && showDate("scheduledDate") ? task.scheduledDate : undefined;
    const scheduledTitle = scheduled ? `Scheduled ${formatDate(scheduled, options.dateFormat)}` : "";
    const editScheduled = (element: HTMLElement): void => editable(element, `Edit scheduled date: ${formatDate(scheduled!, options.dateFormat)}`, "scheduledDate", () => options.edit("scheduledDate"));
    if (scheduled === today && options.todayMarker !== false) {
        const star = parts.lead.createSpan({ cls: "tm-things-today", attr: { title: scheduledTitle } });
        setIcon(star, "star");
        editScheduled(star);
    }

    // After the title: a checklist mark for subtasks (right beside it), repeat and tags.
    if (task.childIds.length && options.subtaskMark !== false) {
        const checklist = parts.inline.createSpan({ cls: "tm-things-checklist", attr: { role: "img", "aria-label": "Has subtasks", title: `${task.childIds.length} subtask${task.childIds.length === 1 ? "" : "s"}` } });
        setIcon(checklist, "list-checks");
        Array.from(parts.inline.children).find(child => child.classList.contains("tm-task-title"))?.after(checklist);
    }
    if (task.repeat && show("repeat")) {
        const label = repeatLabel(task.repeat);
        const repeat = parts.inline.createSpan({ cls: "tm-things-repeat", attr: { title: `Repeats ${task.repeat}` } });
        setIcon(repeat, "repeat");
        editable(repeat, `Edit repeat: ${label}`, "repeat", () => options.edit("repeat"));
    }
    if (show("tags") && !byTag) for (const tag of options.tags) {
        // A long tag may shrink to a few letters when the line is full; a short one is already that small.
        const label = parts.inline.createSpan({ cls: `tm-things-tag${tag.length > 5 ? " is-long" : ""}`, text: tag });
        if (options.openTag) editable(label, `Open tag: ${tag}`, `tag:${tag}`, () => options.openTag!(tag));
        else editable(label, `Edit tags: ${tag}`, `tag:${tag}`, () => options.edit("tags"));
    }

    // At the end of the line (or below the title): the date with its time, then the deadline, each as text after its icon.
    const trailing = (options.datesBelow ? parts.secondary : parts.inline).createSpan({ cls: "tm-things-trailing" });
    if (done) dateText(trailing, "tm-things-done", taskDoneDateLabel(done, now), `Completed ${formatDate(done, options.dateFormat)}`, "calendar-check");
    const time = taskTimeDurationLabel(
        show("scheduledTime") ? task.scheduledTime : undefined,
        show("duration") ? task.durationMinutes : undefined
    );
    // Today's star stands in for its date, so a time today (or a time alone) reads by the clock.
    const dated = Boolean(scheduled && scheduled !== today);
    if (dated || time) {
        const hasTime = Boolean(task.scheduledTime && show("scheduledTime"));
        const label = [dated ? thingsDateLabel(scheduled!, now) : "", time].filter(Boolean).join(", ");
        const when = dateText(trailing, `tm-things-when${dated && scheduled! < today ? " is-overdue" : ""}`, label,
            dated ? scheduledTitle : hasTime ? "Scheduled time" : "Duration", dated ? "calendar" : "clock");
        if (dated) editScheduled(when);
        else editable(when, `Edit ${hasTime ? "scheduled date and time" : "duration"}: ${time}`, "time", () => options.edit(hasTime ? "scheduledDate" : "durationMinutes"));
    }
    const due = task.deadline && showDate("deadline") ? thingsDeadlineLabel(task.deadline, now) : "";
    const dueTime = task.deadlineTime && show("deadlineTime") ? taskTimeLabel(task.deadlineTime) : "";
    if (due || dueTime) {
        const urgent = !task.completed && (deadlineIsOverdue(task.deadline, task.deadlineTime, now) || task.deadline === today);
        const deadline = trailing.createSpan({ cls: `tm-things-deadline${urgent ? " is-urgent" : ""}`, attr: { title: `Deadline: ${[task.deadline && formatDate(task.deadline, options.dateFormat), dueTime].filter(Boolean).join(", ")}` } });
        setIcon(deadline.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
        deadline.createSpan({ text: [due, dueTime].filter(Boolean).join(", ") });
        editable(deadline, `Edit deadline: ${task.deadline ?? ""}${dueTime ? `, ${dueTime}` : ""}`, "deadline", () => options.edit("deadline"));
    }
    if (!trailing.childElementCount) trailing.remove();

    // Below the title: the note the task lives in, when the list spans several.
    if (options.source && show("source") && !byNote) {
        const source = parts.secondary.createSpan({ cls: "tm-things-source", text: options.source.replace(/\.md$/i, "").split("/").pop(), attr: { title: options.source } });
        editable(source, `Open source note: ${options.source}`, "source", options.openSource);
    }
}

export interface ThingsProjectOptions {
    dateFormat: string;
    now?: Date;
    edit: (field: keyof ProjectDraft) => void;
    /** Put the dates and deadline on the line below the name instead of at its end (on phones). */
    datesBelow?: boolean;
}

/**
 * A project row as Things lists one: a count of its remaining tasks after the name, then its dates and
 * deadline at the end of the line (or, on phones, below the name).
 */
export function renderThingsProjectDetails(parts: ThingsRowParts, project: Project, options: ThingsProjectOptions): void {
    const now = options.now ?? new Date();
    const today = todayIso(now);
    // Ranges read as plain dates; a weekday on one end would be ambiguous.
    const label = (date: string): string => taskDoneDateLabel(date, now);
    if (project.openTasks) parts.inline.createSpan({ cls: "tm-things-count", text: String(project.openTasks), attr: { title: `${project.openTasks} remaining` } });
    // At the end of the line (or below the name): the dates (a start still ahead reads like a task's; a range while
    // it runs), then the deadline.
    const trailing = (options.datesBelow ? parts.secondary : parts.inline).createSpan({ cls: "tm-things-trailing" });
    if (project.scheduledDate && project.endDate) {
        // One calendar icon for the range; each end opens its own date's popover.
        const range = dateText(trailing, "tm-things-when tm-things-range", "",
            `${formatDate(project.scheduledDate, options.dateFormat)} – ${formatDate(project.endDate, options.dateFormat)}`);
        const text = range.lastElementChild as HTMLElement;
        const start = text.createSpan({ text: label(project.scheduledDate), attr: { title: `Starts ${formatDate(project.scheduledDate, options.dateFormat)}` } });
        editable(start, `Edit project start date: ${start.textContent ?? ""}`, "project-date", () => options.edit("date"));
        text.appendText(" – ");
        const end = text.createSpan({ text: label(project.endDate), attr: { title: `Ends ${formatDate(project.endDate, options.dateFormat)}` } });
        editable(end, `Edit project end date: ${end.textContent ?? ""}`, "project-end", () => options.edit("endDate"));
    } else if (project.scheduledDate && project.scheduledDate > today) {
        const start = dateText(trailing, "tm-things-when", thingsDateLabel(project.scheduledDate, now), `Starts ${formatDate(project.scheduledDate, options.dateFormat)}`);
        editable(start, `Edit project start date: ${start.textContent ?? ""}`, "project-date", () => options.edit("date"));
    } else if (project.endDate) {
        const end = dateText(trailing, "tm-things-when", `Until ${label(project.endDate)}`, `Ends ${formatDate(project.endDate, options.dateFormat)}`);
        editable(end, `Edit project end date: ${end.textContent ?? ""}`, "project-end", () => options.edit("endDate"));
    }
    renderThingsProjectDeadline(trailing, project, options);
    if (!trailing.childElementCount) trailing.remove();
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
