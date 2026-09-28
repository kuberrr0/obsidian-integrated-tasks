import { expect, it, vi } from "vitest";
vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {} }));
import { parseProjectProperties, projectColorName, projectColorValue } from "../src/project-properties";
import { projectNoteContent, type ProjectDraft } from "../src/project-creator";
import { applyProjectDraft, projectEditDraft } from "../src/project-editor";
import type { Project } from "../src/types";

it.each([
  ["red", "var(--color-red)"], ["Blue", "var(--color-blue)"], [" PURPLE ", "var(--color-purple)"], ["gray", "var(--color-base-50)"],
  ["#abc", "#abc"], ["#A1B2C3", "#a1b2c3"]
])("accepts %j as %s", (raw, css) => expect(projectColorValue(raw)).toBe(css));

it.each([
  "url(x)", "red;background:x", "#abcd", "#abcdeg", "abc", "#", "", "teal", "var(--color-red)", "red ;", "rgb(0,0,0)",
  12, 0xff0000, null, undefined, true, { color: "red" }, ["red"]
])("rejects %j", raw => {
  expect(projectColorValue(raw)).toBeUndefined();
  expect(projectColorName(raw)).toBeUndefined();
});

it("parses the colour property, including aliases, into project properties", () => {
  expect(parseProjectProperties({ color: "Green" }).color).toBe("var(--color-green)");
  expect(parseProjectProperties({ Colour: "#FFF" }).color).toBe("#fff");
  expect(parseProjectProperties({ color: "expression(alert(1))" }).color).toBeUndefined();
  expect(parseProjectProperties({}).color).toBeUndefined();
});

const project: Project = { name: "Launch", path: "Launch.md", archived: false, openTasks: 0, completedTasks: 0 };
const blank: ProjectDraft = { name: "Launch", date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "project", archived: false };

it("writes the canonical colour to new notes and omits it for none", () => {
  expect(projectNoteContent({ ...blank, color: "Blue" }, "YYYY-MM-DD", false)).toContain('\ncolor: "blue"\n');
  expect(projectNoteContent({ ...blank, color: "#A1B2C3" }, "YYYY-MM-DD", false)).toContain('\ncolor: "#a1b2c3"\n');
  for (const color of ["", undefined]) expect(projectNoteContent({ ...blank, color }, "YYYY-MM-DD", false)).not.toContain("color");
  expect(() => projectNoteContent({ ...blank, color: "red;x" }, "YYYY-MM-DD", false)).toThrow("hex");
});

it("loads, changes, removes and preserves the colour property when editing", () => {
  expect(projectEditDraft(project, { Color: "Blue" }).color).toBe("blue");
  expect(projectEditDraft(project, {}).color).toBe("");
  // Inherited colours are not the note's own.
  expect(projectEditDraft({ ...project, color: "var(--color-red)" }, {}).color).toBe("");
  const unknown = { tags: ["project"], color: "teal" };
  const draft = projectEditDraft(project, unknown);
  expect(draft.color).toBeUndefined();
  applyProjectDraft(unknown, draft, "YYYY-MM-DD", false);
  expect(unknown.color).toBe("teal");

  const frontmatter: Record<string, unknown> = { tags: ["project"], Colour: "red", custom: 1 };
  applyProjectDraft(frontmatter, { ...projectEditDraft(project, frontmatter), color: "#0af" }, "YYYY-MM-DD", false);
  expect(frontmatter).toMatchObject({ Colour: "#0af", custom: 1 });
  expect(frontmatter).not.toHaveProperty("color");
  applyProjectDraft(frontmatter, { ...projectEditDraft(project, frontmatter), color: "" }, "YYYY-MM-DD", false);
  expect(frontmatter).not.toHaveProperty("Colour");
  expect(frontmatter.custom).toBe(1);
  const before = { tags: ["project"], color: "red" };
  expect(() => applyProjectDraft(before, { ...blank, color: "url(x)" }, "YYYY-MM-DD", false)).toThrow();
  expect(before.color).toBe("red");
});
