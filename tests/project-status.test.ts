import { expect, it } from "vitest";
import { activeProjects, projectStatuses, projectTotals } from "../src/project-progress";
import { projectChoices } from "../src/choice-popover";
import type { Project } from "../src/types";

const project = (name: string, openTasks: number, completedTasks: number, extra: Partial<Project> = {}): Project =>
  ({ path: `${name}.md`, name, openTasks, completedTasks, archived: false, ...extra });

it("counts a project whose tasks are all done as completed, not active", () => {
  const projects = [
    project("Doing", 2, 1), project("Done", 0, 3), project("Empty", 0, 0), project("Shelved", 0, 2, { archived: true }),
    // A parent whose own tasks are done stays active while a subproject is; once that is done too, so is the parent.
    project("Parent", 0, 1), project("Child", 1, 0, { parentPath: "Parent.md" }),
    project("Finished parent", 0, 1), project("Finished child", 0, 2, { parentPath: "Finished parent.md" })
  ];
  expect(Object.fromEntries(projectStatuses(projects))).toEqual({
    "Doing.md": "active", "Done.md": "completed", "Empty.md": "active", "Shelved.md": "archived",
    "Parent.md": "active", "Child.md": "active", "Finished parent.md": "completed", "Finished child.md": "completed"
  });
  expect(activeProjects(projects).map(item => item.name)).toEqual(["Doing", "Empty", "Parent", "Child"]);
  // Moving a task offers only active projects.
  expect(projectChoices(projects, "Inbox.md").map(choice => choice.label)).toEqual(["Inbox", "Child", "Doing", "Empty", "Parent"]);
});

it("counts a subproject's tasks towards its parent, leaving an archived one out", () => {
  const projects = [
    // Two done tasks of its own, twenty open in a subproject: a tenth done, and active.
    project("House", 0, 2), project("Kitchen", 20, 0, { parentPath: "House.md" }),
    // With no tasks of its own, it completes with its subprojects.
    project("Trip", 0, 0), project("Flights", 0, 2, { parentPath: "Trip.md" }), project("Hotel", 0, 1, { parentPath: "Trip.md" }),
    project("Garden", 0, 1), project("Pond", 3, 0, { parentPath: "Garden.md", archived: true })
  ];
  expect(projectTotals(projects).get("House.md")).toEqual({ open: 20, completed: 2 });
  expect(projectTotals(projects).get("Trip.md")).toEqual({ open: 0, completed: 3 });
  expect(projectTotals(projects).get("Garden.md")).toEqual({ open: 0, completed: 1 });
  expect(Object.fromEntries(projectStatuses(projects))).toMatchObject({ "House.md": "active", "Trip.md": "completed", "Garden.md": "completed" });
});
