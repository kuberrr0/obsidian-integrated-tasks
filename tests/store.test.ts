import { describe, expect, it } from "vitest";
import { prependToDestination, toggleTaskInContent, updateTaskInContent } from "../src/markdown";
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
  it("prepends at the note root without adding a heading", () => {
    expect(prependToDestination("# Project\n- [ ] Existing\n", ["- [ ] New task"])).toBe(
      "- [ ] New task\n# Project\n- [ ] Existing\n"
    );
    expect(prependToDestination("", ["- [ ] First"])).toBe("- [ ] First\n");
  });

  it("inserts directly beneath a heading at any level", () => {
    const input = "# Project\n### Plan\n- [ ] Existing\n## Notes\nKeep me\n";
    expect(prependToDestination(input, ["- [ ] New task"], "Plan")).toBe(
      "# Project\n### Plan\n- [ ] New task\n- [ ] Existing\n## Notes\nKeep me\n"
    );
    expect(prependToDestination("Plan\n====\nOld\n", ["- [ ] New"], "Plan")).toBe("Plan\n====\n- [ ] New\nOld\n");
  });

  it("preserves frontmatter and CRLF line endings", () => {
    expect(prependToDestination("---\r\ntags: [project]\r\n---\r\n# Project\r\n", ["- [ ] New task"])).toBe(
      "---\r\ntags: [project]\r\n---\r\n- [ ] New task\r\n# Project\r\n"
    );
  });

  it("rejects missing headings and ignores headings inside code", () => {
    expect(() => prependToDestination("```\n## Plan\n```\n", ["- [ ] New"], "Plan")).toThrow(/Cannot find heading/);
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
