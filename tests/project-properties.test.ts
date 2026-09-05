import { describe, expect, it } from "vitest";
import { addProjectProperties, parseProjectProperties } from "../src/project-properties";

describe("project note properties", () => {
  it("reads the note's date, end date, priority and duration", () => {
    expect(parseProjectProperties({ date: "2026-08-28", "end date": "2026-09-10", priority: "p1", duration: "1h 30m" })).toEqual({
      scheduledDate: "2026-08-28", endDate: "2026-09-10", deadline: undefined, priority: 1, durationMinutes: 90
    });
  });

  it("accepts date links, property name variants and numeric minutes", () => {
    expect(parseProjectProperties({ "Start-Date": ["[[05-09-2026]]"], end_date: "[[10-09-2026|Finish]]", Priority: 2, duration: 45 }, "DD-MM-YYYY")).toEqual({
      scheduledDate: "2026-09-05", endDate: "2026-09-10", deadline: undefined, priority: 2, durationMinutes: 45
    });
  });

  it("omits empty or malformed properties", () => {
    expect(parseProjectProperties({ date: "2026-02-30", "end date": null, priority: "critical", duration: -1 })).toEqual({
      scheduledDate: undefined, endDate: undefined, deadline: undefined, priority: undefined, durationMinutes: undefined
    });
    expect(parseProjectProperties(undefined).priority).toBeUndefined();
  });

  it.each([["high", 1], ["Medium", 2], ["low", 3]])("maps %s priority", (priority, expected) => {
    expect(parseProjectProperties({ priority }).priority).toBe(expected);
  });
});

describe("convert to project", () => {
  it("adds a project tag and empty editable properties", () => {
    const properties = {};
    addProjectProperties(properties);
    expect(properties).toEqual({ tags: ["project"], date: null, "end date": null, deadline: null, priority: null, duration: null });
  });

  it("preserves existing tags, aliases, values and unrelated properties on repeated conversion", () => {
    const properties = { tags: ["work", "#project/client"], "Start-Date": "2026-09-10", deadline: "2026-09-12", Priority: "p1", duration: 45, owner: "Me" };
    const original = structuredClone(properties);
    addProjectProperties(properties);
    addProjectProperties(properties);
    expect(properties).toEqual({ ...original, "end date": null });
  });

  it("normalizes scalar tag lists without losing tags or duplicating project", () => {
    const properties = { tags: "work, #project personal" };
    addProjectProperties(properties);
    expect(properties.tags).toEqual(["work", "#project", "personal"]);
  });
});
