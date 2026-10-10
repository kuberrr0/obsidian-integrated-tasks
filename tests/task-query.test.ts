import { describe, expect, it } from "vitest";
import { parseTaskQuery, type TaskQueryContext } from "../src/task-query";

const context: TaskQueryContext = {
  sourcePath: "Daily/2026-09-27.md", dateFormat: "MMM D, YYYY", now: new Date(2026, 8, 27, 12),
  smartLists: [{ id: "q", name: "Quick wins", filters: [{ property: "duration", operator: "before", values: ["30"] }], sort: "priority", descending: false, grouping: "tags" }],
  resolveNote: name => ({ "Website Refresh": "Projects/Website Refresh.md", Inbox: "Inbox.md" } as Record<string, string>)[name]
};
const parse = (source: string) => parseTaskQuery(source, context);

describe("task query parsing", () => {
  it("reads views, sorting, grouping, limits and titles", () => {
    expect(parse("view: today\nsort: priority desc\ngroup: source\nlimit: 10\ntitle: Focus")).toMatchObject({
      query: { mode: "today", showCompleted: false, filters: [] }, sort: "priority", descending: true, grouping: "source", limit: 10, title: "Focus", opens: { mode: "today" }, errors: []
    });
    expect(parse("view: overdue").query).toMatchObject({ mode: "all", dateFilter: "overdue" });
    expect(parse("").query).toMatchObject({ mode: "all" });
  });

  it("reads layouts: a list unless a board or a calendar (on a week, or another period) is asked for", () => {
    expect(parse("")).toMatchObject({ layout: "list", calendarScope: "week" });
    expect(parse("layout: board")).toMatchObject({ layout: "board", errors: [] });
    expect(parse("layout: Kanban")).toMatchObject({ layout: "board", errors: [] });
    expect(parse("layout: calendar")).toMatchObject({ layout: "calendar", calendarScope: "week", errors: [] });
    expect(parse("layout: calendar month")).toMatchObject({ layout: "calendar", calendarScope: "month" });
    expect(parse("layout: calendar 4 days")).toMatchObject({ layout: "calendar", calendarScope: "four-day" });
    expect(parse("layout: calendar day")).toMatchObject({ layout: "calendar", calendarScope: "day" });
    expect(parse("layout: gantt").errors).toEqual(['Line 1: "gantt" isn\'t a layout. Use list, board, calendar, or calendar with day, 4 days, week or month and a date.']);
    expect(parse("layout: board month").errors).toHaveLength(1);
    expect(parse("layout: board 2026-11-01").errors).toHaveLength(1);
  });

  it("reads the date a calendar opens on, with or without its period, in the vault's format or in words", () => {
    expect(parse("layout: calendar").calendarAnchor).toBeUndefined();
    expect(parse("layout: calendar month 2026-11-01")).toMatchObject({ calendarScope: "month", calendarAnchor: "2026-11-01", errors: [] });
    expect(parse("layout: calendar 2026-11-01 month")).toMatchObject({ calendarScope: "month", calendarAnchor: "2026-11-01", errors: [] });
    expect(parse("layout: calendar Nov 3, 2026")).toMatchObject({ calendarScope: "week", calendarAnchor: "2026-11-03", errors: [] });
    expect(parse("layout: calendar 4 days from tomorrow")).toMatchObject({ calendarScope: "four-day", calendarAnchor: "2026-09-28", errors: [] });
    expect(parse("layout: calendar week of 2026-12-24")).toMatchObject({ calendarScope: "week", calendarAnchor: "2026-12-24", errors: [] });
    expect(parse("layout: calendar month someday").errors).toEqual(['Line 1: "someday" isn\'t a date I understand. Try a date such as 2026-09-27, today, or next friday.']);
  });

  it("turns property lines into filters, resolving relative dates when rendered", () => {
    const { query, errors } = parse([
      "deadline: before next friday", "scheduled: between today and in 7 days", "priority: 1, 2", "tags: #work or [[home]]",
      "status: open", "duration: is not 1h30m", "hidden until: someday", "note: this", "source: Inbox", "task title: contains report", "repeat: has"
    ].join("\n"));
    expect(errors).toEqual([]);
    expect(query.filters).toEqual([
      { property: "deadline", operator: "before", values: ["2026-10-02"] },
      { property: "scheduledDate", operator: "between", values: ["2026-09-27", "2026-10-04"] },
      { property: "priority", operator: "is", values: ["1", "2"] },
      { property: "tags", operator: "is", values: ["work", "home"] },
      { property: "status", operator: "is", values: ["Open"] },
      { property: "duration", operator: "isNot", values: ["90"] },
      { property: "defer", operator: "is", values: ["Someday"] },
      { property: "source", operator: "is", values: ["Daily/2026-09-27.md"] },
      { property: "source", operator: "is", values: ["Inbox.md"] },
      { property: "title", operator: "contains", values: ["report"] },
      { property: "repeat", operator: "has", values: [] }
    ]);
  });

  it("reads times as HH:mm, so they compare in order", () => {
    expect(parse("scheduled time: before 9:00\ndeadline time: between 9am and 5:30pm").query.filters).toEqual([
      { property: "scheduledTime", operator: "before", values: ["09:00"] },
      { property: "deadlineTime", operator: "between", values: ["09:00", "17:30"] }
    ]);
    expect(parse("scheduled time: after lunch").errors).toEqual(['Line 1: "lunch" isn\'t a time. Use a time such as 09:30 or 2pm.']);
  });

  it("uses a smart list's filters, sort and grouping, and projects by name or this note", () => {
    expect(parse("smart list: quick wins\npriority: 1")).toMatchObject({
      sort: "priority", grouping: "tags", opens: { mode: "smartLists", smartListId: "q" },
      query: { filters: [{ property: "duration", operator: "before", values: ["30"] }, { property: "priority", operator: "is", values: ["1"] }] }
    });
    expect(parse("project: [[Website Refresh]]").query).toMatchObject({ mode: "project", projectPath: "Projects/Website Refresh.md" });
    expect(parse("project: this").query.projectPath).toBe("Daily/2026-09-27.md");
  });

  it("shows completed tasks when asked, or when filtering on completion", () => {
    expect(parse("show completed: yes").query.showCompleted).toBe(true);
    expect(parse("completed: after 7 days ago").query).toMatchObject({ showCompleted: true, filters: [{ property: "completed", operator: "after", values: ["2026-09-20"] }] });
  });

  it("ignores comments but keeps #tags", () => {
    expect(parse("# My focus list\nview: today # just today\ntags: #work").query).toMatchObject({ mode: "today", filters: [{ property: "tags", values: ["work"] }] });
  });

  it("explains mistakes line by line", () => {
    expect(parse("view: someday\npriority: urgent\ndeadline: whenever\nsmart list: Nope\nbanana: 3\njust text\ntags: before today\nlimit: many").errors).toEqual([
      'Line 1: "someday" isn\'t a view. Use today, upcoming, inbox, all, overdue.',
      'Line 2: Priority is 1, 2, or 3, not "urgent".',
      'Line 3: "whenever" isn\'t a date I understand. Try a date such as 2026-09-27, today, or next friday.',
      'Line 4: There\'s no smart list named "Nope".',
      expect.stringMatching(/^Line 5: Unknown option "banana"\. Options: view, smart list/),
      'Line 6: write each option as "name: value", for example "view: today".',
      'Line 7: Tags can\'t be compared with "before".',
      "Line 8: Limit is a whole number, such as 10."
    ]);
  });
});
