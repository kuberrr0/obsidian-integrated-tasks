import { describe, expect, it } from "vitest";
import { findInputDate, findInputDeadline, parseDateTimeExpression, parseStrictDateExpression } from "../src/date";
import { parseTaskInput, parseTaskLine, scanTasks } from "../src/parser";
import { parseProjectProperties } from "../src/project-properties";

const reference = new Date(2026, 8, 26, 12);
const FORMAT = "MMM D, YYYY";

describe("note links that read as dates", () => {

  it("still reads formatted and ISO date links, with a trailing time", () => {
    expect(parseTaskLine("- [ ] Lunch [[Sep 30, 2026]]", reference, FORMAT)).toMatchObject({ title: "Lunch", scheduledDate: "2026-09-30" });
    expect(parseTaskLine("- [ ] Lunch [[2026-09-30]] 09:30", reference, FORMAT)).toMatchObject({ title: "Lunch", scheduledDate: "2026-09-30", scheduledTime: "09:30" });
    expect(parseTaskLine("- [ ] Lunch {[[Sep 30, 2026]] noon}", reference, FORMAT)).toMatchObject({ deadline: "2026-09-30", deadlineTime: "12:00" });
    expect(parseDateTimeExpression("[[Sep 30, 2026]] 5pm", reference, FORMAT)).toEqual({ date: "2026-09-30", time: "17:00" });
    expect(parseStrictDateExpression("2026-02-30")).toBeUndefined();
    expect(scanTasks("Note.md", "- [ ] Lunch with [[April]]", reference, FORMAT)[0].scheduledDate).toBeUndefined();
  });

  it("keeps natural language for editor input and deadline braces", () => {
    expect(parseTaskLine("- [ ] Report {next week}", reference, FORMAT)?.deadline).toBe("2026-10-03");
    expect(parseTaskInput("Call tomorrow", reference, FORMAT)).toMatchObject({ title: "Call", scheduledDate: "2026-09-27" });
    expect(findInputDate("Call tomorrow", reference)?.date).toBe("2026-09-27");
    expect(findInputDeadline("Report {tomorrow} now", reference, FORMAT)?.date).toBe("2026-09-27");
    // The parser's plain-date path stays strict.
    expect(parseDateTimeExpression("tomorrow", reference, FORMAT, true)).toBeUndefined();
    expect(parseDateTimeExpression("Sep 30, 2026 09:15", reference, FORMAT, true)).toEqual({ date: "2026-09-30", time: "09:15" });
  });
});

describe("project frontmatter dates", () => {
  it("accepts only formatted or ISO dates", () => {
    expect(parseProjectProperties({ date: "May", deadline: "[[Friday]]", "end date": "next week" }, FORMAT)).toMatchObject({
      scheduledDate: undefined, deadline: undefined, endDate: undefined
    });
    expect(parseProjectProperties({ date: "Sep 30, 2026", deadline: "[[2026-10-02]]", "end date": "[[Oct 1, 2026|End]]" }, FORMAT)).toMatchObject({
      scheduledDate: "2026-09-30", deadline: "2026-10-02", endDate: "2026-10-01"
    });
  });
});
