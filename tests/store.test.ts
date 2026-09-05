import { describe, expect, it } from "vitest";
import { insertIntoDestination, toggleTaskInContent, updateTaskInContent } from "../src/markdown";
import type { Task, TaskDraft } from "../src/types";

const sourceTask: Task = {
  id: "Inbox.md:2",
  path: "Inbox.md",
  line: 2,
  endLine: 2,
  raw: "- [ ] Original [[2026-09-04]] p2",
  indent: 0,
  completed: false,
  title: "Original",
  scheduledDate: "2026-09-04",
  priority: 2,
  childIds: []
};

describe("Markdown task insertion", () => {
  it("inserts above headings when there is no root checklist", () => {
    expect(insertIntoDestination("# Project\n- [ ] Existing\n", ["- [ ] New task"])).toBe(
      "- [ ] New task\n# Project\n- [ ] Existing\n"
    );
    expect(insertIntoDestination("", ["- [ ] First"])).toBe("- [ ] First\n");
  });

  it("inserts directly beneath a heading at any level", () => {
    const input = "# Project\n### Plan\n- [ ] Existing\n## Notes\nKeep me\n";
    expect(insertIntoDestination(input, ["- [ ] New task"], "Plan")).toBe(
      "# Project\n### Plan\n- [ ] New task\n- [ ] Existing\n## Notes\nKeep me\n"
    );
    expect(insertIntoDestination("Plan\n====\nOld\n", ["- [ ] New"], "Plan")).toBe("Plan\n====\n- [ ] New\nOld\n");
  });

  it("preserves frontmatter and CRLF line endings", () => {
    expect(insertIntoDestination("---\r\ntags: [project]\r\n---\r\n# Project\r\n", ["- [ ] New task"])).toBe(
      "---\r\ntags: [project]\r\n---\r\n- [ ] New task\r\n# Project\r\n"
    );
  });

  it("rejects missing headings and ignores headings inside code", () => {
    expect(() => insertIntoDestination("```\n## Plan\n```\n", ["- [ ] New"], "Plan")).toThrow(/Cannot find heading/);
  });

  it("toggles only the intended checklist line", () => {
    const content = "# Inbox\n- [ ] Other\n- [ ] Original [[2026-09-04]] p2\n- [ ] Other\n";
    expect(toggleTaskInContent(content, sourceTask, true)).toBe(
      "# Inbox\n- [ ] Other\n- [x] Original [[2026-09-04]] p2\n- [ ] Other\n"
    );
  });

  it("rewrites the root task while preserving surrounding Markdown", () => {
    const draft: TaskDraft = {
      title: "Updated",
      scheduledDate: "2026-09-05",
      durationMinutes: 45,
      deadline: "2026-09-06",
      priority: 1,
      completed: false,
      destination: "Inbox.md",
      indent: 0
    };
    const content = "# Inbox\n\n- [ ] Original [[2026-09-04]] p2\n  - [ ] Child\n";
    expect(updateTaskInContent(content, sourceTask, draft)).toBe(
      "# Inbox\n\n- [ ] Updated [[2026-09-05]] 45m {[[2026-09-06]]} p1\n  - [ ] Child\n"
    );
  });

  it("fails safely when the source line no longer exists", () => {
    expect(() => toggleTaskInContent("# Inbox\n- [ ] Different\n", sourceTask, true)).toThrow(/changed/);
  });
});


describe("checklist insertion order", () => {
  const content = "## Plan\nIntro paragraph.\n\n- [ ] First\n  Notes for first.\n  - [ ] Child\n- [x] Last\n  - [ ] Last child\n\nClosing paragraph.\n## Next\n- [ ] Elsewhere\n";

  it("keeps the introduction before new top tasks", () => {
    expect(insertIntoDestination(content, ["- [ ] New"], "Plan")).toBe(content.replace("- [ ] First", "- [ ] New\n- [ ] First"));
  });

  it("appends after the last task's descendants and before trailing prose", () => {
    expect(insertIntoDestination(content, ["- [ ] New"], "Plan", "bottom")).toBe(content.replace("  - [ ] Last child", "  - [ ] Last child\n- [ ] New"));
  });

  it.each(["top", "bottom"] as const)("inserts at file start when only heading checklists exist (%s)", (position) => {
    expect(insertIntoDestination(content, ["- [ ] New"], undefined, position)).toBe("- [ ] New\n" + content);
  });

  it.each(["top", "bottom"] as const)("keeps root fallback above prose and setext headings, after YAML (%s)", (position) => {
    const yaml = "---\r\ntags: [project]\r\n---\r\n";
    const body = "Intro paragraph\r\n\r\nHeading 1\r\n=========\r\n- [ ] Existing\r\n";
    expect(insertIntoDestination(yaml + body, ["- [ ] New"], undefined, position)).toBe(yaml + "- [ ] New\r\n" + body);
  });

  it.each(["top", "bottom"] as const)("uses only the root checklist when one exists (%s)", (position) => {
    const intro = "Intro\n\n";
    const root = "- [ ] Root\n  - [ ] Child\n";
    const section = "## Heading\n- [ ] Section task\n";
    const expected = position === "top" ? "- [ ] New\n" + root : root + "- [ ] New\n";
    expect(insertIntoDestination(intro + root + section, ["- [ ] New"], undefined, position)).toBe(intro + expected + section);
  });

  it("ignores YAML and fenced examples when finding a checklist", () => {
    const input = "---\nsample: |\n  - [ ] YAML\n---\n```md\n- [ ] Example\n```\nIntro\n- [ ] Real\n";
    expect(insertIntoDestination(input, ["- [ ] New"])).toBe(input.replace("- [ ] Real", "- [ ] New\n- [ ] Real"));
  });

  it("does not use a subsection's checklist for an empty heading scope", () => {
    const input = "## Plan\nIntro\n### Child\n- [ ] Child task\n";
    expect(insertIntoDestination(input, ["- [ ] New"], "Plan", "bottom")).toBe("## Plan\n- [ ] New\nIntro\n### Child\n- [ ] Child task\n");
  });

  it("preserves CRLF, indentation, and moved task children", () => {
    expect(insertIntoDestination("Intro\r\n  - [ ] Old\r\n    - [ ] Child\r\n", ["- [ ] New", "  - [ ] New child"], undefined, "bottom")).toBe("Intro\r\n  - [ ] Old\r\n    - [ ] Child\r\n  - [ ] New\r\n    - [ ] New child\r\n");
  });

  it("does not cross a heading or an intervening paragraph at the bottom", () => {
    for (const separator of ["## Next", "Separate paragraph"]) {
      const input = `- [ ] First\n${separator}\n- [ ] Second\n`;
      expect(insertIntoDestination(input, ["- [ ] New"], undefined, "bottom")).toBe(`- [ ] First\n- [ ] New\n${separator}\n- [ ] Second\n`);
    }
  });
});
