import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {} }));
import { applyProjectDraft, projectEditDraft } from "../src/project-editor";
import type { Project } from "../src/types";
const project: Project = { name: "Launch", path: "Projects/Launch.md", parentPath: "Projects/Studio.md", priority: 2, archived: true, openTasks: 1, completedTasks: 0 };

it("loads aliased fields and link lists, then updates properties without replacing custom metadata", () => {
  const frontmatter = { tags: ["project", "work", "archived"], start_date: ["[[2026-09-18|Friday]]"], EndDate: "2026-09-20", Deadline: "2026-09-21", Priority: "medium", Parent: ["[[Studio]]"], custom: { retained: true } };
  const draft = projectEditDraft(project, frontmatter);
  expect(draft).toEqual({ name: "Launch", date: "[[2026-09-18|Friday]]", endDate: "2026-09-20", deadline: "2026-09-21", priority: "2", parent: "Projects/Studio.md", tags: "project, work", archived: true });
  applyProjectDraft(frontmatter, { ...draft, endDate: "", priority: "1", archived: false }, "YYYY-MM-DD", true);
  expect(frontmatter).toEqual({ tags: ["project", "work"], start_date: "[[2026-09-18]]", EndDate: null, Deadline: "[[2026-09-21]]", Priority: 1, Parent: "[[Projects/Studio]]", custom: { retained: true } });
});

it("rejects invalid edits without partially modifying frontmatter", () => {
  const frontmatter = { tags: ["project"], date: "2026-09-18", custom: "keep" };
  const draft = projectEditDraft(project, frontmatter);
  expect(() => applyProjectDraft(frontmatter, { ...draft, deadline: "garbage" }, "YYYY-MM-DD", false)).toThrow();
  expect(frontmatter).toEqual({ tags: ["project"], date: "2026-09-18", custom: "keep" });
});
