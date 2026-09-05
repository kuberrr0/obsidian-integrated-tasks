import { describe, expect, it } from "vitest";
import { projectHierarchy } from "../src/project-hierarchy";
import { parseProjectParent } from "../src/project-properties";
import type { Project } from "../src/types";
const project = (name: string, parentPath?: string): Project => ({ name, path: `${name}.md`, parentPath, archived: false, openTasks: 0, completedTasks: 0 });
const rows = (projects: Project[]) => projectHierarchy(projects).map(({ project, depth }) => [project.name, depth]);
describe("project hierarchy", () => {
  it("orders nested children after parents regardless of their alphabetical position", () => {
    expect(rows([project("Child", "Parent.md"), project("Grandchild", "Child.md"), project("Parent"), project("Another")])).toEqual([["Another", 0], ["Parent", 0], ["Child", 1], ["Grandchild", 2]]);
  });
  it("keeps missing, non-project or hidden parents at the root", () => {
    expect(rows([project("Child", "Missing.md")])).toEqual([["Child", 0]]);
  });
  it("breaks cycles without losing projects or their other descendants", () => {
    expect(rows([project("A", "B.md"), project("B", "A.md"), project("C", "B.md"), project("Self", "Self.md")])).toEqual([["A", 0], ["B", 0], ["C", 1], ["Self", 0]]);
  });
  it.each(["[[Projects/Parent]]", "[[Projects/Parent|Alias]]", ["[[Projects/Parent]]"], "Projects/Parent"])("reads parent links: %s", value => {
    expect(parseProjectParent({ parent: value })).toBe("Projects/Parent");
  });
  it("ignores empty and ambiguous parent values", () => {
    expect(parseProjectParent({ parent: ["[[A]]", "[[B]]"] })).toBeUndefined();
    expect(parseProjectParent({ parent: null })).toBeUndefined();
    expect(parseProjectParent({ parent: "" })).toBeUndefined();
  });
});
