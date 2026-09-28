import { describe, expect, it } from "vitest";
import { draftFromTitle, draftMatchesTask } from "../src/task-draft";
import { scanTasks } from "../src/parser";

// Saturday, Sep 19 2026.
const now = new Date(2026, 8, 19, 12);
const task = (line: string) => scanTasks("Work.md", line, now)[0];

describe("typing a card title", () => {
  it("sets the properties typed into the title and keeps the rest", () => {
    const draft = draftFromTitle(task("- [ ] Call Sam {2026-09-30} #[[Work]]"), "Call Sam tomorrow 3pm p1 #[[Calls]]", now, "YYYY-MM-DD");
    expect(draft).toMatchObject({ title: "Call Sam", scheduledDate: "2026-09-20", scheduledTime: "15:00", priority: 1, deadline: "2026-09-30", tags: ["Work", "Calls"] });
  });

  it("reads natural-language dates only in what was newly typed", () => {
    const planned = task("- [ ] Plan for tomorrow");
    expect(draftFromTitle(planned, "Plan for tomorrow", now).scheduledDate).toBeUndefined();
    expect(draftMatchesTask(planned, draftFromTitle(planned, "Plan for tomorrow", now))).toBe(true);
    expect(draftFromTitle(planned, "Plan for tomorrow friday", now)).toMatchObject({ title: "Plan for tomorrow", scheduledDate: "2026-09-25" });
  });

  it("moves the task to a typed ~[[note]] unless told to stay", () => {
    const item = task("- [ ] Pack");
    expect(draftFromTitle(item, "Pack ~[[Trip]]", now).destination).toBe("Trip.md");
    expect(draftFromTitle(item, "Pack ~[[Trip]]", now, undefined, false)).toMatchObject({ title: "Pack", destination: "Work.md" });
  });

  it("keeps the old title when the new one is empty, and notices a plain rename", () => {
    const item = task("- [ ] Pack p2");
    expect(draftMatchesTask(item, draftFromTitle(item, "   ", now))).toBe(true);
    expect(draftMatchesTask(item, draftFromTitle(item, "Pack bags", now))).toBe(false);
  });
});
