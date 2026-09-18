import { setIcon } from "obsidian";

export interface DashboardOptions {
  today: (card: HTMLElement) => void;
  upcoming: (card: HTMLElement) => void;
  projects: (card: HTMLElement) => void;
  calendar: (card: HTMLElement) => void;
  createTask: (mode: "today" | "upcoming") => void;
  createProject: () => void;
}

/** Two dashboard rows with a 40/60 split in each row. */
export function renderDashboard(container: HTMLElement, options: DashboardOptions): void {
  const dashboard = container.createDiv({ cls: "tm-dashboard" });
  const tasks = dashboard.createDiv({ cls: "tm-dashboard-row tm-dashboard-tasks" });
  const planning = dashboard.createDiv({ cls: "tm-dashboard-row tm-dashboard-planning" });
  const panel = (row: HTMLElement, title: string, name: string, render: (card: HTMLElement) => void, add?: () => void): void => {
    const section = row.createEl("section", { cls: `tm-dashboard-panel tm-dashboard-${name}`, attr: { "aria-label": title } });
    const heading = section.createDiv({ cls: "tm-dashboard-heading" });
    heading.createEl("h2", { text: title });
    if (add) {
      const button = heading.createEl("button", { cls: "clickable-icon", attr: { "aria-label": name === "projects" ? "Create new project" : `Add task to ${title}` } });
      setIcon(button, "plus");
      button.addEventListener("click", add);
    }
    render(section.createDiv({ cls: "tm-dashboard-card" }));
  };
  panel(tasks, "Today", "today", options.today, () => options.createTask("today"));
  panel(tasks, "Upcoming", "upcoming", options.upcoming, () => options.createTask("upcoming"));
  panel(planning, "Projects", "projects", options.projects, options.createProject);
  panel(planning, "Calendar", "calendar", options.calendar);
}
