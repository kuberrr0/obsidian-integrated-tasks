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
    if (project.color) progress.style.setProperty("--tm-project-color", project.color);
    const circle = progress.createSpan({ cls: "tm-project-progress-circle", attr: { "aria-hidden": "true" } });
    circle.style.setProperty("--tm-project-progress", `${ratio * 100}%`);
    if (showPercentage) progress.createSpan({ cls: "tm-project-percentage", text: `${percentage}%` });
}

export type ProjectStatus = "active" | "completed" | "archived";

/**
 * Each project's status. As in Things, a project whose tasks are all done (100%) is completed, no longer active;
 * one with no tasks yet is still active, and so is one with an active subproject. Archived outranks both.
 */
export function projectStatuses(projects: Project[]): Map<string, ProjectStatus> {
  const children = new Map<string, Project[]>();
  for (const project of projects) if (project.parentPath) children.set(project.parentPath, [...children.get(project.parentPath) ?? [], project]);
  const statuses = new Map<string, ProjectStatus>();
  const status = (project: Project, seen: Set<string>): ProjectStatus => {
    const known = statuses.get(project.path);
    if (known) return known;
    if (seen.has(project.path)) return "active";
    seen.add(project.path);
    const done = project.openTasks === 0 && project.completedTasks > 0
      && !(children.get(project.path) ?? []).some(child => status(child, seen) === "active");
    const result: ProjectStatus = project.archived ? "archived" : done ? "completed" : "active";
    statuses.set(project.path, result);
    return result;
  };
  for (const project of projects) status(project, new Set());
  return statuses;
}

/** The projects still in progress: neither archived nor completed. */
export function activeProjects(projects: Project[]): Project[] {
  const statuses = projectStatuses(projects);
  return projects.filter(project => statuses.get(project.path) === "active");
}
