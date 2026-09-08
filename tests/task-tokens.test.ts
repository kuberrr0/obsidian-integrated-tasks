import { describe, expect, it, vi } from "vitest";
import { taskTokens, tokenClass } from "../src/task-tokens";
import { serializeTask, parseTaskLine } from "../src/parser";

describe("note token pills", () => {
  it("marks only past dates on incomplete tasks as overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12));
    try {
      for (const checkbox of [" ", "x", "X"]) {
        for (const [date, past] of [["2026-09-07", true], ["2026-09-08", false], ["2026-09-09", false]] as const) {
          const tokens = taskTokens(`- [${checkbox}] Task [[${date}]] {${date}}`);
          expect(tokens).toHaveLength(2);
          for (const token of tokens) {
            expect(token.overdue).toBe(checkbox === " " && past);
            expect(tokenClass(token).includes("is-danger")).toBe(checkbox === " " && past);
          }
        }
      }
    } finally { vi.useRealTimers(); }
  });
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


it("formats Markdown date labels with Daily Notes settings while retaining link targets and times", () => {
  const text = "- [ ] Call [[2026-09-09]] 9pm {[[Sep 10, 2026]] noon}";
  const tokens = taskTokens(text, "DD/MM/YYYY");
  expect(tokens.map(token => token.label)).toEqual(["09/09/2026 21:00", "Due 10/09/2026 12:00"]);
  expect(tokens.map(token => token.linkText)).toEqual(["2026-09-09", "Sep 10, 2026"]);
  expect(tokens.map(token => text.slice(token.display!.from, token.display!.to))).toEqual(["[[2026-09-09]]", "[[Sep 10, 2026]]"]);
  expect(taskTokens("- [ ] Call {2026-09-09 noon}", "DD/MM/YYYY")[0]).toMatchObject({ label: "Due 09/09/2026 12:00", display: { label: "09/09/2026 12:00" } });
});
