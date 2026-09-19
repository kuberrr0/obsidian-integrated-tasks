import type { Project } from "./types";

/** A fixed outline with an inset pie fill, matching the project's completion ratio. */
export function renderProjectProgress(parent: HTMLElement, project: Project, showPercentage = true): void {
    const total = project.openTasks + project.completedTasks;
    const ratio = total ? Math.max(0, Math.min(1, project.completedTasks / total)) : 0;
    const percentage = Math.round(ratio * 100);
    const progress = parent.createDiv({ cls: "tm-project-progress", attr: {
        role: "progressbar",
        "aria-label": `${project.name}: ${project.completedTasks} of ${total} tasks completed`,
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percentage),
        title: `${percentage}% — ${project.completedTasks} of ${total} tasks completed`
    } });
    const circle = progress.createSpan({ cls: "tm-project-progress-circle", attr: { "aria-hidden": "true" } });
    circle.style.setProperty("--tm-project-progress", `${ratio * 100}%`);
    if (showPercentage) progress.createSpan({ cls: "tm-project-percentage", text: `${percentage}%` });
}
