import { describe, expect, it } from "vitest";
import { scanTasks } from "../src/parser";
import { todaySummary } from "../src/today-summary";

describe("today summary", () => {
  const now = new Date(2026, 8, 27, 14, 0);
  const tasks = scanTasks("A.md", [
    "- [x] Done 2026-09-27", "- [ ] Write 2026-09-27 1h", "- [ ] Call 2026-09-27 15:30 30m", "- [ ] Earlier 2026-09-27 09:00",
    "- [ ] Overdue 2026-09-20", "- [x] Old done 2026-09-20", "- [ ] Tomorrow 2026-09-28 08:00", "- [ ] Undated", "- [ ] Due {2026-09-27}"
  ].join("\n"), now);

  it("counts today's tasks, planned time and overdue tasks", () => {
    const summary = todaySummary(tasks, now);
    expect(summary).toMatchObject({ total: 5, done: 1, overdue: 1, plannedMinutes: 90 });
  });

  it("finds the next timed task still ahead today", () => {
    expect(todaySummary(tasks, now).next).toMatchObject({ time: "15:30", minutesAway: 90, task: { title: "Call" } });
    expect(todaySummary(tasks, new Date(2026, 8, 27, 16, 0)).next).toBeUndefined();
  });
});
