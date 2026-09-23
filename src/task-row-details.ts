import { formatDuration } from "./parser";
import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import type { TaskEditorProperty } from "./task-editor";
import type { Task, TaskGrouping, TaskProperty } from "./types";

/** Calendar-day differences avoid daylight-saving-hour rounding. */
export function taskDayDistance(date: string, now = new Date()): number {
    const [year, month, day] = date.split("-").map(Number);
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

export function taskScheduleLabel(date: string, now = new Date()): string {
    const days = taskDayDistance(date, now);
    if (days < 0) return `${-days}d ago`;
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return formatDate(date, date.slice(0, 4) === String(now.getFullYear()) ? "MMM D" : "MMM D, YYYY");
}

export function taskDeadlineLabel(date: string, now = new Date()): string {
    const days = taskDayDistance(date, now);
    if (days === 0) return "Today";
    const count = Math.abs(days);
    const value = count >= 365 ? `${Math.floor(count / 365)}y` : count >= 30 ? `${Math.floor(count / 30)}m` : `${count}d`;
    return `${value}${days < 0 ? " ago" : ""}`;
}

export function deadlineIsOverdue(date: string | undefined, time: string | undefined, now = new Date()): boolean {
    if (!date) return false;
    const days = taskDayDistance(date, now);
    if (days !== 0) return days < 0;
    if (!time) return false;
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute < now.getHours() * 60 + now.getMinutes();
}

export function taskTimeLabel(time: string): string {
    const [hour, minute] = time.split(":").map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Compact clock ranges keep both meridiems when crossing noon or midnight. */
export function taskTimeDurationLabel(time?: string, duration?: number): string {
    if (!time) return duration ? formatDuration(duration) : "";
    const start = taskTimeLabel(time);
    if (!duration) return start;
    const [hour, minute] = time.split(":").map(Number);
    const total = hour * 60 + minute + duration;
    const endMinute = total % 1440;
    const end = taskTimeLabel(`${Math.floor(endMinute / 60)}:${endMinute % 60}`);
    const samePeriod = start.slice(-2) === end.slice(-2) && total < 1440;
    return `${samePeriod ? start.slice(0, -3) : start}-${end}${total >= 1440 ? ` (+${Math.floor(total / 1440)}d)` : ""}`;
}

interface TaskDetailsOptions {
    grouping: TaskGrouping;
    show: (property: TaskProperty) => boolean;
    dateFormat: string;
    now?: Date;
    source?: string;
    tags: string[];
    edit: (property: TaskEditorProperty) => void;
    openSource: () => void;
}

function editable(element: HTMLElement, label: string, action: () => void): void {
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", label);
    element.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); action(); });
    element.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); event.stopPropagation(); action();
    });
}

export function renderTaskDetails(primary: HTMLElement, metadata: HTMLElement, task: Task, options: TaskDetailsOptions): void {
    const now = options.now ?? new Date();
    const { grouping, show } = options;
    const actionDate = task.scheduledDate && task.deadline ? (task.scheduledDate < task.deadline ? task.scheduledDate : task.deadline) : task.scheduledDate ?? task.deadline;
    const showDate = (field: "scheduledDate" | "deadline") => show(field) && grouping !== field && !(grouping === "date" && task[field] === actionDate);
    const date = task.scheduledDate && showDate("scheduledDate") ? taskScheduleLabel(task.scheduledDate, now) : "";
    const time = taskTimeDurationLabel(
        show("scheduledTime") && grouping !== "scheduledTime" ? task.scheduledTime : undefined,
        show("duration") && grouping !== "duration" ? task.durationMinutes : undefined
    );
    if (date || time) {
        const schedule = metadata.createSpan({ cls: "tm-task-schedule", attr: { title: [task.scheduledDate && formatDate(task.scheduledDate, options.dateFormat), task.scheduledTime].filter(Boolean).join(", ") } });
        if (date) {
            const dateLabel = schedule.createSpan({ cls: !task.completed && task.scheduledDate! < todayIso(now) ? "is-overdue" : "", text: date });
            editable(dateLabel, `Edit scheduled date: ${date}`, () => options.edit("scheduledDate"));
        }
        if (time) {
            const timeLabel = schedule.createSpan({ text: `${date ? ", " : ""}${time}` });
            const hasTime = task.scheduledTime && show("scheduledTime") && grouping !== "scheduledTime";
            editable(timeLabel, `Edit ${hasTime ? "scheduled date and time" : "duration"}: ${time}`, () => options.edit(hasTime ? "scheduledDate" : "durationMinutes"));
        }
    }
    const due = task.deadline && showDate("deadline") ? taskDeadlineLabel(task.deadline, now) : "";
    const dueTime = task.deadlineTime && show("deadlineTime") && grouping !== "deadlineTime" ? taskTimeLabel(task.deadlineTime) : "";
    if (due || dueTime) {
        const badge = primary.createSpan({ cls: `tm-task-due${!task.completed && deadlineIsOverdue(task.deadline, task.deadlineTime, now) ? " is-overdue" : ""}`, attr: { title: [task.deadline && formatDate(task.deadline, options.dateFormat), task.deadlineTime].filter(Boolean).join(", ") } });
        const icon = badge.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, "flag");
        badge.createSpan({ text: [due, dueTime].filter(Boolean).join(", ") });
        editable(badge, `Edit deadline: ${task.deadline ?? ""}${dueTime ? `, ${dueTime}` : ""}`, () => options.edit("deadline"));
    }
    if (options.source && show("source") && grouping !== "source") {
        const source = metadata.createSpan({ cls: "tm-task-source", text: options.source.replace(/\.md$/i, "").split("/").pop(), attr: { title: options.source } });
        editable(source, `Open source note: ${options.source}`, options.openSource);
    }
    if (show("tags") && grouping !== "tags") for (const tag of options.tags) {
        const label = metadata.createSpan({ cls: "tm-task-tag" });
        const icon = label.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, "tag");
        label.createSpan({ text: tag });
        editable(label, `Edit tags: ${tag}`, () => options.edit("tags"));
    }
}
