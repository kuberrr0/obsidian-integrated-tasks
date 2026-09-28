// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderThingsProjectDetails, renderThingsTaskDetails, thingsDateLabel, thingsDeadlineLabel } from "../src/things-row-details";
import { scanTasks } from "../src/parser";
import type { Project, TaskGrouping } from "../src/types";

beforeAll(() => {
  installObsidianDom();
  const fragment = Object.getPrototypeOf(document.createDocumentFragment()) as Record<string, unknown>;
  const patched = DocumentFragment.prototype as unknown as Record<string, unknown>;
  for (const key of ["createEl", "createDiv", "createSpan"]) fragment[key] ??= patched[key];
});
// Saturday, Sep 19 2026.
const now = new Date(2026, 8, 19, 12);

function row(line: string, options: { grouping?: TaskGrouping; source?: string; todayMarker?: boolean } = {}) {
  const lead = document.createElement("span"), inline = document.createElement("div"), secondary = document.createElement("div");
  const task = scanTasks("Note.md", line, now)[0];
  const edit = vi.fn(), openSource = vi.fn();
  renderThingsTaskDetails({ lead, inline, secondary }, task, {
    now, grouping: options.grouping ?? "none", dateFormat: "MMM D, YYYY", tags: task.tags ?? [], source: options.source, todayMarker: options.todayMarker, edit, openSource
  });
  return { lead, inline, secondary, edit, openSource };
}
const classes = (element: HTMLElement) => Array.from(element.children).map(child => child.className);

describe("Things labels", () => {
  it("names dates like Things", () => {
    expect(thingsDateLabel("2026-09-20", now)).toBe("Tomorrow");
    expect(thingsDateLabel("2026-09-23", now)).toBe("Wed");
    expect(thingsDateLabel("2026-10-08", now)).toBe("Oct 8");
    expect(thingsDateLabel("2027-01-02", now)).toBe("Jan 2, 2027");
  });
  it("counts deadline days", () => {
    expect(thingsDeadlineLabel("2026-09-19", now)).toBe("today");
    expect(thingsDeadlineLabel("2026-09-20", now)).toBe("1 day left");
    expect(thingsDeadlineLabel("2026-09-30", now)).toBe("11 days left");
    expect(thingsDeadlineLabel("2026-09-16", now)).toBe("3 days ago");
  });
});

describe("Things task row", () => {
  it("puts repeat and tags after the title, then date, time and deadline together at the end", () => {
    const { lead, inline } = row("- [ ] Plan 2026-10-08 10:00 30m {2026-09-30} every week #[[Errand]] #[[Office]]");
    expect(lead.childElementCount).toBe(0);
    expect(classes(inline)).toEqual(["tm-things-repeat", "tm-things-tag", "tm-things-tag", "tm-things-trailing"]);
    const trailing = inline.querySelector<HTMLElement>(".tm-things-trailing")!;
    expect(Array.from(trailing.children).map(child => [child.className, child.textContent])).toEqual([
      ["tm-things-box tm-things-when", "Oct 8"], ["tm-things-box tm-things-time", "10:00-10:30 AM"], ["tm-things-deadline", "11 days left"]
    ]);
  });

  it("marks a task with subtasks with a checklist icon right after its notes icon", () => {
    const lead = document.createElement("span"), inline = document.createElement("div"), secondary = document.createElement("div");
    inline.createSpan({ cls: "tm-task-title" });
    inline.createSpan({ cls: "tm-description-indicator" });
    inline.createSpan({ cls: "tm-task-recurring" });
    const [task] = scanTasks("Note.md", "- [ ] Plan #[[Errand]]\n  - [ ] Step", now);
    renderThingsTaskDetails({ lead, inline, secondary }, task, { now, grouping: "none", dateFormat: "MMM D, YYYY", tags: ["Errand"], edit: vi.fn(), openSource: vi.fn() });
    expect(classes(inline)).toEqual(["tm-task-title", "tm-description-indicator", "tm-things-checklist", "tm-task-recurring", "tm-things-tag"]);
    expect(classes(row("- [ ] Plan").inline)).toEqual([]);
  });

  it("stars tasks scheduled today or earlier, except in the Today list", () => {
    expect(classes(row("- [ ] Call 2026-09-19").lead)).toEqual(["tm-things-today"]);
    expect(classes(row("- [ ] Call 2026-09-10").lead)).toEqual(["tm-things-today is-overdue"]);
    expect(row("- [ ] Call 2026-09-19", { todayMarker: false }).lead.childElementCount).toBe(0);
  });

  it("marks deadlines due today or overdue as urgent", () => {
    expect(row("- [ ] Pay {2026-09-19}").inline.querySelector(".tm-things-deadline")!.className).toBe("tm-things-deadline is-urgent");
    expect(row("- [ ] Pay {2026-09-15}").inline.querySelector(".tm-things-deadline")!.textContent).toBe("4 days ago");
    expect(row("- [ ] Pay {2026-09-25}").inline.querySelector(".tm-things-deadline")!.className).toBe("tm-things-deadline");
  });

  it("shows the source note below the title and keeps properties editable", () => {
    const { secondary, inline, edit, openSource } = row("- [ ] Plan 2026-10-08", { source: "Projects/New Project.md" });
    expect(secondary.textContent).toBe("New Project");
    (secondary.firstElementChild as HTMLElement).click();
    expect(openSource).toHaveBeenCalledOnce();
    inline.querySelector<HTMLElement>(".tm-things-when")!.click();
    expect(edit).toHaveBeenCalledWith("scheduledDate");
  });

  it("keeps a grouped property on each row, except the note or tag the list is grouped by", () => {
    const line = "- [ ] Plan 2026-10-08 10:00 {2026-09-30} every week #[[Errand]]";
    for (const grouping of ["date", "scheduledDate", "deadline", "scheduledTime", "repeat", "priority"] as const) {
      const { inline } = row(line, { grouping, source: "Work.md" });
      expect(classes(inline)).toEqual(["tm-things-repeat", "tm-things-tag", "tm-things-trailing"]);
      expect(inline.querySelectorAll(".tm-things-trailing > *")).toHaveLength(3);
    }
    expect(row(line, { grouping: "tags" }).inline.querySelector(".tm-things-tag")).toBeNull();
    expect(row(line, { grouping: "source", source: "Work.md" }).secondary.childElementCount).toBe(0);
    expect(row(line, { grouping: "date", source: "Work.md" }).secondary.textContent).toBe("Work");
  });
});

describe("Things project row", () => {
  function projectRow(properties: Partial<Project>) {
    const lead = document.createElement("span"), inline = document.createElement("div"), secondary = document.createElement("div");
    const project: Project = { name: "New Project", path: "Projects/New Project.md", openTasks: 0, completedTasks: 0, archived: false, ...properties };
    const edit = vi.fn();
    renderThingsProjectDetails({ lead, inline, secondary }, project, { dateFormat: "MMM D, YYYY", now, edit });
    return { lead, inline, secondary, edit };
  }

  it("shows the remaining count, then a future start and the deadline together at the end, and the parent below", () => {
    const { lead, inline, secondary, edit } = projectRow({ scheduledDate: "2026-10-08", deadline: "2026-10-25", openTasks: 3, parent: "Area.md" });
    expect(lead.childElementCount).toBe(0);
    expect(Array.from(inline.children).map(child => child.className)).toEqual(["tm-things-count", "tm-things-trailing"]);
    expect(Array.from(inline.querySelector(".tm-things-trailing")!.children).map(child => child.textContent)).toEqual(["Oct 8", "36 days left"]);
    expect(secondary.textContent).toBe("Area");
    (inline.querySelector(".tm-things-deadline") as HTMLElement).click();
    expect(edit).toHaveBeenCalledWith("deadline");
  });

  it("shows a running project's date range and leaves out an empty count", () => {
    const { inline } = projectRow({ scheduledDate: "2026-09-07", endDate: "2026-09-25" });
    expect(inline.textContent).toBe("Sep 7 – Sep 25");
    expect(inline.querySelector(".tm-things-count")).toBeNull();
    // A start already past, without an end, needs no box.
    expect(projectRow({ scheduledDate: "2026-09-07" }).inline.childElementCount).toBe(0);
  });

  it("marks an overdue project deadline as urgent", () => {
    expect(projectRow({ deadline: "2026-09-15" }).inline.querySelector(".tm-things-deadline")!.className).toBe("tm-things-deadline is-urgent");
  });
});

describe("tag pills", () => {
  it("open the tag's view when a handler is given, and the tag editor otherwise", () => {
    const inline = document.createElement("div");
    const task = scanTasks("Note.md", "- [ ] Plan #[[Errand]]", now)[0];
    const edit = vi.fn(), openTag = vi.fn();
    renderThingsTaskDetails({ lead: document.createElement("span"), inline, secondary: document.createElement("div") }, task, {
      now, grouping: "none", dateFormat: "MMM D, YYYY", tags: ["Errand"], edit, openSource: vi.fn(), openTag
    });
    inline.querySelector<HTMLElement>(".tm-things-tag")!.click();
    expect(openTag).toHaveBeenCalledExactlyOnceWith("Errand");
    expect(edit).not.toHaveBeenCalled();
    const { inline: plain, edit: fallback } = row("- [ ] Plan #[[Errand]]");
    plain.querySelector<HTMLElement>(".tm-things-tag")!.click();
    expect(fallback).toHaveBeenCalledWith("tags");
  });
});
