import { describe, expect, it } from "vitest";
import { parseProjectProperties } from "../src/project-properties";

describe("project note properties", () => {
  it("reads the note's date, end date, priority and duration", () => {
    expect(parseProjectProperties({ date: "2026-08-28", "end date": "2026-09-10", priority: "p1", duration: "1h 30m" })).toEqual({
      scheduledDate: "2026-08-28", deadline: "2026-09-10", priority: 1, durationMinutes: 90
    });
  });

  it("accepts date links, property name variants and numeric minutes", () => {
    expect(parseProjectProperties({ "Start-Date": ["[[05-09-2026]]"], end_date: "[[10-09-2026|Finish]]", Priority: 2, duration: 45 }, "DD-MM-YYYY")).toEqual({
      scheduledDate: "2026-09-05", deadline: "2026-09-10", priority: 2, durationMinutes: 45
    });
  });

  it("omits empty or malformed properties", () => {
    expect(parseProjectProperties({ date: "2026-02-30", "end date": null, priority: "critical", duration: -1 })).toEqual({
      scheduledDate: undefined, deadline: undefined, priority: undefined, durationMinutes: undefined
    });
    expect(parseProjectProperties(undefined).priority).toBeUndefined();
  });

  it.each([["high", 1], ["Medium", 2], ["low", 3]])("maps %s priority", (priority, expected) => {
    expect(parseProjectProperties({ priority }).priority).toBe(expected);
  });
});
