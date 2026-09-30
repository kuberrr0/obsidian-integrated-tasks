import { expect, it } from "vitest";
import { activeProjects, projectStatuses } from "../src/project-progress";
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
