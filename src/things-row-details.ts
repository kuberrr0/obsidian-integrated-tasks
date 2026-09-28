import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { repeatLabel } from "./parser";
import { deadlineIsOverdue, editable, taskDayDistance, taskDoneDateLabel, taskTimeDurationLabel, taskTimeLabel, type TaskDetailsOptions } from "./task-row-details";
import type { Task } from "./types";

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

    // When: a star for today (and anything overdue, which Things folds into Today), else a date box.
    if (task.status === "done" && task.completedDate && show("completed") && grouping !== "completed") {
        box(parts.lead, "tm-things-done", taskDoneDateLabel(task.completedDate, now), `Completed ${formatDate(task.completedDate, options.dateFormat)}`);
    } else if (task.scheduledDate && showDate("scheduledDate")) {
        const title = `Scheduled ${formatDate(task.scheduledDate, options.dateFormat)}`;
        let when: HTMLElement | undefined;
        if (task.scheduledDate <= today) {
            if (options.todayMarker !== false) {
                when = parts.lead.createSpan({ cls: `tm-things-today${task.scheduledDate < today ? " is-overdue" : ""}`, attr: { title } });
                setIcon(when, "star");
            }
        } else when = box(parts.lead, "tm-things-when", thingsDateLabel(task.scheduledDate, now), title);
        if (when) editable(when, `Edit scheduled date: ${formatDate(task.scheduledDate, options.dateFormat)}`, "scheduledDate", () => options.edit("scheduledDate"));
    }
    const time = taskTimeDurationLabel(
        show("scheduledTime") && grouping !== "scheduledTime" ? task.scheduledTime : undefined,
        show("duration") && grouping !== "duration" ? task.durationMinutes : undefined
    );
    if (time) {
        const hasTime = Boolean(task.scheduledTime && show("scheduledTime") && grouping !== "scheduledTime");
        const label = box(parts.lead, "tm-things-time", time, hasTime ? "Scheduled time" : "Duration");
        editable(label, `Edit ${hasTime ? "scheduled date and time" : "duration"}: ${time}`, "time", () => options.edit(hasTime ? "scheduledDate" : "durationMinutes"));
    }

    // After the title: repeat and tags, then the deadline pushed to the end of the line.
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
    const due = task.deadline && showDate("deadline") ? thingsDeadlineLabel(task.deadline, now) : "";
    const dueTime = task.deadlineTime && show("deadlineTime") && grouping !== "deadlineTime" ? taskTimeLabel(task.deadlineTime) : "";
    if (due || dueTime) {
        const urgent = !task.completed && (deadlineIsOverdue(task.deadline, task.deadlineTime, now) || task.deadline === today);
        const deadline = parts.inline.createSpan({ cls: `tm-things-deadline${urgent ? " is-urgent" : ""}`, attr: { title: `Deadline: ${[task.deadline && formatDate(task.deadline, options.dateFormat), dueTime].filter(Boolean).join(", ")}` } });
        setIcon(deadline.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
        deadline.createSpan({ text: [due, dueTime].filter(Boolean).join(", ") });
        editable(deadline, `Edit deadline: ${task.deadline ?? ""}${dueTime ? `, ${dueTime}` : ""}`, "deadline", () => options.edit("deadline"));
    }

    // Below the title: the note the task lives in, when the list spans several.
    if (options.source && show("source") && grouping !== "source") {
        const source = parts.secondary.createSpan({ cls: "tm-things-source", text: options.source.replace(/\.md$/i, "").split("/").pop(), attr: { title: options.source } });
        editable(source, `Open source note: ${options.source}`, "source", options.openSource);
    }
}
