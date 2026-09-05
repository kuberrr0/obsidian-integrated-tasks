import { describe, expect, it } from "vitest";
import { taskTokens } from "../src/task-tokens";
import { serializeTask, parseTaskLine } from "../src/parser";

describe("note token pills", () => {
  it("identifies exact source ranges and labels without changing stored text", () => {
    const line = "- [ ] do this [[Sep 5, 2026]] 1h45m {[[Sep 12, 2026]]} p1";
    const tokens = taskTokens(line, "MMM D, YYYY");
    expect(tokens.map((token) => line.slice(token.from, token.to))).toEqual([
      "[[Sep 5, 2026]]", "1h45m", "{[[Sep 12, 2026]]}", "p1"
    ]);
    expect(tokens.map((token) => token.label)).toEqual(["Sep 5, 2026", "1h45m", "Due Sep 12, 2026", "P1"]);
    expect(serializeTask({ ...parseTaskLine(line)!, destination: "Inbox.md" }, "MMM D, YYYY")).toBe(line);
  });

  it("handles tabs, completed tasks, emoji in titles, reordered tokens and trailing spaces", () => {
    const line = "\t- [x] A 🐈 task p2 {2026-09-12} [[2026-09-05]] 45m   ";
    const tokens = taskTokens(line);
    expect(tokens.map((token) => line.slice(token.from, token.to))).toEqual(["p2", "{2026-09-12}", "[[2026-09-05]]", "45m"]);
    expect(tokens[1].linkText).toBeUndefined();
  });

  it.each([
    "Ordinary text p1", "- [ ] Discuss p1 choices", "- [ ] Literal `p1`",
    "- [ ] Read [[Project notes]]", "- [ ] Invalid [[2026-02-30]]", "- [ ] Task tomorrow"
  ])("does not style ordinary or unparsed content: %s", (line) => {
    expect(taskTokens(line)).toEqual([]);
  });

  it("only marks the metadata instance of a repeated token", () => {
    const line = "- [ ] Discuss p1 with the team p1";
    expect(taskTokens(line)).toMatchObject([{ from: line.lastIndexOf("p1"), to: line.length, kind: "priority" }]);
  });

  it("continues to identify metadata before a destination marker", () => {
    expect(taskTokens("- [ ] Task 30m p3 ~[[Project#Plan]]").map((token) => token.label)).toEqual(["30m", "P3"]);
  });
});


it("includes times in date pills while retaining date-only link targets", () => {
  const line = "- [ ] Call [[2026-09-05]] 9pm 1h30m {[[2026-09-07]] noon}";
  const tokens = taskTokens(line);
  expect(tokens.map((token) => line.slice(token.from, token.to))).toEqual(["[[2026-09-05]] 9pm", "1h30m", "{[[2026-09-07]] noon}"]);
  expect(tokens.map((token) => token.label)).toEqual(["2026-09-05 21:00", "1h30m", "Due 2026-09-07 12:00"]);
  expect(tokens[0].linkText).toBe("2026-09-05");
  expect(tokens[2].linkText).toBe("2026-09-07");
});
