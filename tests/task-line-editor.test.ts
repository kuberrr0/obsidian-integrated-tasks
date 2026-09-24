import { describe, expect, it } from "vitest";
import { inlineTaskTokens, inactiveTaskTokens } from "../src/task-line-editor";

const text = "Discuss [[Project|plan]] [[2026-09-25]] 10:00 30m {[[2026-09-26]]} p1 #[[work]] ~[[Projects/Work#Ready]]";
const tokens = inlineTaskTokens(text, "YYYY-MM-DD");

describe("inline task token selection", () => {
  it("keeps metadata rendered while the caret is in the title", () => {
    expect(inactiveTaskTokens(tokens, [{ from: 3, to: 3 }])).toEqual(tokens);
  });
  it("reveals only the token containing the caret", () => {
    const date = tokens.find(item => item.token?.kind === "scheduledDate")!;
    const remaining = inactiveTaskTokens(tokens, [{ from: date.from + 4, to: date.from + 4 }]);
    expect(remaining).not.toContain(date);
    expect(remaining.some(item => item.token?.kind === "deadline")).toBe(true);
    expect(remaining.some(item => item.token?.kind === "tags")).toBe(true);
  });
  it("reveals every token touched by a selection", () => {
    const date = tokens.find(item => item.token?.kind === "scheduledDate")!;
    const deadline = tokens.find(item => item.token?.kind === "deadline")!;
    expect(inactiveTaskTokens(tokens, [{ from: date.from, to: deadline.to }]).map(item => item.token?.kind)).not.toContain("deadline");
  });
  it("maps widgets to exact source ranges and includes links and destinations", () => {
    expect(tokens.map(item => text.slice(item.from, item.to))).toEqual([
      "[[Project|plan]]", "[[2026-09-25]] 10:00", "30m", "{[[2026-09-26]]}", "p1", "#[[work]]", "~[[Projects/Work#Ready]]"
    ]);
    expect(tokens[0].label).toBe("plan");
    expect(tokens.at(-1)).toMatchObject({ label: "Work", project: "Projects/Work#Ready" });
  });
  it("retains offsets for pasted child tasks", () => {
    const multiline = "Parent p1\n  - [ ] Child #[[work]]";
    expect(inlineTaskTokens(multiline, "YYYY-MM-DD").map(item => multiline.slice(item.from, item.to))).toEqual(["p1", "#[[work]]"]);
  });
});

it("renders a project name without its folder, extension, or section", () => {
  const source = "Task ~[[Projects/Autumn Open House.md#Ready]]";
  const project = inlineTaskTokens(source, "YYYY-MM-DD")[0];
  expect(project).toMatchObject({ label: "Autumn Open House", project: "Projects/Autumn Open House.md#Ready" });
  expect(source.slice(project.from, project.to)).toBe("~[[Projects/Autumn Open House.md#Ready]]");
});
