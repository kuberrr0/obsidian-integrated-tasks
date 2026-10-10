import type { Project, ProjectTotals } from "./types";

/** A fixed outline with an inset pie fill, matching the project's completion ratio. */
export function renderProjectProgress(parent: HTMLElement, project: Project, showPercentage = true): void {
    const { open, completed } = project.totals ?? { open: project.openTasks, completed: project.completedTasks };
    const total = open + completed;
    const ratio = total ? Math.max(0, Math.min(1, completed / total)) : 0;
    const percentage = Math.round(ratio * 100);
    const progress = parent.createDiv({ cls: "tm-project-progress", attr: {
        role: "progressbar",
        "aria-label": `${project.name}: ${completed} of ${total} tasks completed`,
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percentage),
        title: `${percentage}% — ${completed} of ${total} tasks completed`
    } });
    if (project.color) progress.style.setProperty("--tm-project-color", project.color);
    const circle = progress.createSpan({ cls: "tm-project-progress-circle", attr: { "aria-hidden": "true" } });
    circle.style.setProperty("--tm-project-progress", `${ratio * 100}%`);
    if (showPercentage) progress.createSpan({ cls: "tm-project-percentage", text: `${percentage}%` });
}

export type ProjectStatus = "active" | "completed" | "archived";

function subprojects(projects: Project[]): Map<string, Project[]> {
  const children = new Map<string, Project[]>();
  for (const project of projects) if (project.parentPath) children.set(project.parentPath, [...children.get(project.parentPath) ?? [], project]);
  return children;
}

/** Each project's open and completed tasks, its subprojects' included; an archived subproject's are left out. */
export function projectTotals(projects: Project[]): Map<string, ProjectTotals> {
  const children = subprojects(projects);
  const totals = new Map<string, ProjectTotals>();
  const total = (project: Project, seen: Set<string>): ProjectTotals => {
    const known = totals.get(project.path);
    if (known) return known;
    seen.add(project.path);
    const sum = { open: project.openTasks, completed: project.completedTasks };
    for (const child of children.get(project.path) ?? []) {
      if (child.archived || seen.has(child.path)) continue;
      const counts = total(child, seen);
      sum.open += counts.open;
      sum.completed += counts.completed;
    }
    totals.set(project.path, sum);
    return sum;
  };
  for (const project of projects) total(project, new Set());
  return totals;
}

/**
 * Each project's status. As in Things, a project whose tasks are all done (100%) is completed, no longer active;
 * one with no tasks yet is still active, and so is one with an active subproject. A subproject's tasks count
 * towards its parent's, so a parent with none of its own completes with its subprojects. Archived outranks both.
 */
export function projectStatuses(projects: Project[]): Map<string, ProjectStatus> {
  const children = subprojects(projects);
  const totals = projectTotals(projects);
  const statuses = new Map<string, ProjectStatus>();
  const status = (project: Project, seen: Set<string>): ProjectStatus => {
    const known = statuses.get(project.path);
    if (known) return known;
    if (seen.has(project.path)) return "active";
    seen.add(project.path);
    const { open, completed } = totals.get(project.path)!;
    const done = open === 0 && completed > 0
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
