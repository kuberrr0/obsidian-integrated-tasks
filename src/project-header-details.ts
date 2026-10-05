import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { thingsDeadlineLabel } from "./things-row-details";
import { longDate } from "./things-task-card";
import { deadlineIsDistant, deadlineIsOverdue, taskDeadlineLabel, taskDoneDateLabel, taskTimeLabel } from "./task-row-details";
import type { ProjectDraft } from "./project-creator";
import type { Project } from "./types";

/** "Sep 27", or "Sep 27, 2025" outside the current year, as a task's dates read. */
export const projectDateLabel = taskDoneDateLabel;

/** `showParent`: the parent project, shown on a project's page but not in the Projects list. */
export function renderProjectHeaderDetails(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date(), deadlineParent = parent, things = false, showParent = true): void {
    if (things) renderThingsProjectDates(parent, project, edit, dateFormat, now);
    else if (project.scheduledDate || project.endDate) {
        const range = parent.createSpan({ cls: "tm-project-date-range" });
        if (project.scheduledDate) {
            const text = [projectDateLabel(project.scheduledDate, now), project.scheduledTime && taskTimeLabel(project.scheduledTime)].filter(Boolean).join(", ");
            const start = range.createSpan({ text, attr: { title: `Start: ${formatDate(project.scheduledDate, dateFormat)}` } });
            editable(start, `project start date: ${text}`, "date", edit);
        }
        if (project.scheduledDate && project.endDate) range.createSpan({ text: " - ", attr: { "aria-hidden": "true" } });
        if (project.endDate) {
            const text = projectDateLabel(project.endDate, now);
            const end = range.createSpan({ text, attr: { title: `End: ${formatDate(project.endDate, dateFormat)}` } });
            editable(end, `project end date: ${text}`, "endDate", edit);
        }
    }
    if (things) renderThingsProjectDeadline(deadlineParent, project, edit, dateFormat, now);
    else renderProjectDeadline(deadlineParent, project, edit, dateFormat, now);
    if (project.parent && showParent) {
        const name = project.parent.replace(/\.md$/i, "");
        const source = parent.createSpan({ cls: "tm-task-source", text: name.split("/").pop(), attr: { title: name } });
        editable(source, `parent project: ${name}`, "parent", edit);
    }
}

function editable(element: HTMLElement, label: string, field: keyof ProjectDraft, edit: (field: keyof ProjectDraft) => void): void {
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", `Edit ${label}`);
        element.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); edit(field); });
        element.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault(); event.stopPropagation(); edit(field);
        });
}

/** The Things dates: a calendar line reading "Mon, Sep 14 – Fri, Oct 16", as an open task card shows its date; each end opens its own editor. */
export function renderThingsProjectDates(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date()): void {
    if (!project.scheduledDate && !project.endDate) return;
    const dates = parent.createSpan({ cls: "tm-things-card-property tm-things-project-dates is-dated" });
    setIcon(dates.createSpan({ cls: "tm-things-card-icon", attr: { "aria-hidden": "true" } }), "calendar");
    const label = dates.createSpan({ cls: "tm-things-card-label" });
    if (project.scheduledDate) {
        const text = [longDate(project.scheduledDate, now), project.scheduledTime && taskTimeLabel(project.scheduledTime)].filter(Boolean).join(", ");
        editable(label.createSpan({ text, attr: { title: `Start: ${formatDate(project.scheduledDate, dateFormat)}` } }), `project start date: ${text}`, "date", edit);
    }
    if (project.scheduledDate && project.endDate) label.createSpan({ text: " – ", attr: { "aria-hidden": "true" } });
    if (project.endDate) {
        const text = longDate(project.endDate, now);
        editable(label.createSpan({ text, attr: { title: `End: ${formatDate(project.endDate, dateFormat)}` } }), `project end date: ${text}`, "endDate", edit);
    }
}

/** The Things deadline: "Deadline: Thu, Sep 25" and how far off it is, in red once due; as an open task card shows it. */
export function renderThingsProjectDeadline(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date()): void {
    if (!project.deadline) return;
    const urgent = deadlineIsOverdue(project.deadline, project.deadlineTime, now) || project.deadline === todayIso(now);
    const due = parent.createSpan({ cls: `tm-things-card-property tm-things-project-deadline${urgent ? " is-urgent" : ""}`, attr: { title: `Deadline: ${formatDate(project.deadline, dateFormat)}` } });
    setIcon(due.createSpan({ cls: "tm-things-card-icon", attr: { "aria-hidden": "true" } }), "flag");
    due.createSpan({ cls: "tm-things-card-label", text: `Deadline: ${longDate(project.deadline, now)}${project.deadlineTime ? `, ${taskTimeLabel(project.deadlineTime)}` : ""}` });
    due.createSpan({ cls: "tm-things-card-extra", text: thingsDeadlineLabel(project.deadline, now) });
    editable(due, `project deadline: ${formatDate(project.deadline, dateFormat)}`, "deadline", edit);
}

export function renderProjectDeadline(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date()): void {
    if (project.deadline) {
        const due = parent.createSpan({ cls: `tm-task-due${deadlineIsDistant(project.deadline, now) ? " is-distant" : ""}${deadlineIsOverdue(project.deadline, project.deadlineTime, now) ? " is-overdue" : ""}`, attr: { title: `Deadline: ${formatDate(project.deadline, dateFormat)}` } });
        setIcon(due.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
        due.createSpan({ text: [taskDeadlineLabel(project.deadline, now), project.deadlineTime && taskTimeLabel(project.deadlineTime)].filter(Boolean).join(", ") });
        editable(due, `project deadline: ${formatDate(project.deadline, dateFormat)}`, "deadline", edit);
    }
}
