import { expect, it, vi } from "vitest";
import { parseTaskInput, parseTaskLine, scanTasks, serializeTask } from "../src/parser";
import { parseTaskTreeInput } from "../src/task-input";
import { formatTags, parseTags } from "../src/task-tags";
import { taskTokens } from "../src/task-tokens";
import { matchesFilter } from "../src/task-properties";
import { groupTasks, taskMatchesQuery } from "../src/query";
import { draftForGroup, taskGroupTarget } from "../src/list-drag";
import { planBulkTasks } from "../src/bulk-tasks";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}
}));
import { bulkPropertyPatch } from "../src/bulk-task-editor";

it("round-trips multiple tags interleaved with other metadata, retaining order and deduplicating", () => {
  const parsed = parseTaskLine("- [ ] Report #[[work]] [[2026-09-08]] #[[client notes]] 30m {[[2026-09-15]]} p1 #[[work]]")!;
  expect(parsed).toMatchObject({ title: "Report", tags: ["work", "client notes"], scheduledDate: "2026-09-08", deadline: "2026-09-15", durationMinutes: 30, priority: 1 });
  const saved = serializeTask({ ...parsed, destination: "Inbox.md" });
  expect(saved).toBe("- [ ] Report [[2026-09-08]] 30m {[[2026-09-15]]} p1 #[[work]] #[[client notes]]");
  expect(parseTaskLine(saved)).toEqual(parsed);
});

it.each(["Task #[[]]", "Task #[[   ]]", "Task #[[unfinished", "Task `#[[work]]`", "Task [[work]]", "Task #[[work]] in prose", "Task \\#[[work]]"])("retains non-metadata syntax: %s", input => {
  const parsed = parseTaskLine(`- [ ] ${input}`)!;
  expect(parsed.title).toBe(input);
  expect(parsed.tags).toBeUndefined();
});

it("does not interpret date-like tags as scheduled dates", () => {
  expect(parseTaskInput("Plan #[[today]] #[[2026-09-08]]")).toMatchObject({ title: "Plan", tags: ["today", "2026-09-08"] });
  expect(parseTaskInput("Plan #[[today]]")?.scheduledDate).toBeUndefined();
});

it("keeps independent tags in multiline task input", () => {
  const result = parseTaskTreeInput("Main #[[work]]\n  - [ ] Child #[[home]]", "Inbox.md");
  expect(result.tags).toEqual(["work"]);
  expect(result.additionalLines).toEqual(["  - [ ] Child #[[home]]"]);
});

it("returns a separate linked token for each tag", () => {
  const line = "- [ ] Task #[[work]] #[[client notes]]";
  const tokens = taskTokens(line);
  expect(tokens.map(token => [line.slice(token.from, token.to), token.kind, token.label, token.linkText])).toEqual([
    ["#[[work]]", "tags", "work", "work"], ["#[[client notes]]", "tags", "client notes", "client notes"]
  ]);
});

it("validates structured tags without losing names containing spaces or commas", () => {
  expect(parseTags("#[[work]] #[[client, notes]] #[[work]]")).toEqual(["work", "client, notes"]);
  expect(formatTags([" work ", "work"])).toBe("#[[work]]");
  expect(parseTags("")).toEqual([]);
  for (const value of ["work", "#[[]]", "#[[work]] stray", "#[[work|alias]]"]) expect(() => parseTags(value)).toThrow();
});

it("searches and filters individual tags and groups equivalent tag sets", () => {
  const [task, other, empty] = scanTasks("Inbox.md", "- [ ] One #[[work]] #[[client notes]]\n- [ ] Two #[[client notes]] #[[work]]\n- [ ] Three");
  expect(taskMatchesQuery(task, { mode: "all", showCompleted: false, search: "CLIENT" }, "Inbox.md")).toBe(true);
  expect(matchesFilter(task, { property: "tags", operator: "is", values: ["WORK"] })).toBe(true);
  expect(matchesFilter(task, { property: "tags", operator: "is", values: ["wor"] })).toBe(false);
  expect(matchesFilter(task, { property: "tags", operator: "isNot", values: ["work"] })).toBe(false);
  expect(matchesFilter(empty, { property: "tags", operator: "missing", values: [] })).toBe(true);
  expect([...groupTasks([task, other, empty], "tags").values()]).toEqual([[task, other], [empty]]);
  expect(draftForGroup(empty, taskGroupTarget("tags", task)).tags).toEqual(["client notes", "work"]);
});

it("preserves tags during unrelated bulk changes and supports replacing and clearing them", () => {
  const content = "- [ ] Task #[[work]] #[[client notes]]";
  const [task] = scanTasks("Inbox.md", content);
  const plan = (patch: object) => planBulkTasks(new Map([[task.path, content]]), [{ task, draft: { ...task, destination: task.path, ...patch } }]).get(task.path);
  expect(plan({ priority: 1 })).toBe("- [ ] Task p1 #[[work]] #[[client notes]]");
  expect(plan(bulkPropertyPatch({ tags: "#[[home]] #[[errands]]" }, "YYYY-MM-DD"))).toBe("- [ ] Task #[[home]] #[[errands]]");
  expect(plan(bulkPropertyPatch({ tags: "" }, "YYYY-MM-DD"))).toBe("- [ ] Task");
});
