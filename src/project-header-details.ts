import { setIcon } from "obsidian";
import { formatDate } from "./date";
import { deadlineIsOverdue, taskDeadlineLabel, taskTimeLabel } from "./task-row-details";
import type { ProjectDraft } from "./project-creator";
import type { Project } from "./types";

export function projectDateLabel(date: string, now = new Date()): string {
    return formatDate(date, date.slice(0, 4) === String(now.getFullYear()) ? "MMM D" : "MMM D, YYYY");
}

export function renderProjectHeaderDetails(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date(), deadlineParent = parent): void {
    if (project.scheduledDate || project.endDate) {
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
    renderProjectDeadline(deadlineParent, project, edit, dateFormat, now);
    if (project.parent) {
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

export function renderProjectDeadline(parent: HTMLElement, project: Project, edit: (field: keyof ProjectDraft) => void, dateFormat: string, now = new Date()): void {
    if (project.deadline) {
        const due = parent.createSpan({ cls: `tm-task-due${deadlineIsOverdue(project.deadline, project.deadlineTime, now) ? " is-overdue" : ""}`, attr: { title: `Deadline: ${formatDate(project.deadline, dateFormat)}` } });
        setIcon(due.createSpan({ cls: "tm-task-detail-icon", attr: { "aria-hidden": "true" } }), "flag");
        due.createSpan({ text: [taskDeadlineLabel(project.deadline, now), project.deadlineTime && taskTimeLabel(project.deadlineTime)].filter(Boolean).join(", ") });
        editable(due, `project deadline: ${formatDate(project.deadline, dateFormat)}`, "deadline", edit);
    }
}
