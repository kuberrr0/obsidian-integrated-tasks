// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderThingsTaskDetails, thingsDateLabel, thingsDeadlineLabel } from "../src/things-row-details";
import { scanTasks } from "../src/parser";
import type { TaskGrouping } from "../src/types";

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
  it("puts a date box before the title, tags and repeat after it, and the deadline last", () => {
    const { lead, inline } = row("- [ ] Plan 2026-10-08 10:00 30m {2026-09-30} every week #[[Errand]] #[[Office]]");
    expect(classes(lead)).toEqual(["tm-things-box tm-things-when", "tm-things-box tm-things-time"]);
    expect(Array.from(lead.children).map(child => child.textContent)).toEqual(["Oct 8", "10:00-10:30 AM"]);
    expect(classes(inline)).toEqual(["tm-things-repeat", "tm-things-tag", "tm-things-tag", "tm-things-deadline"]);
    expect(inline.querySelector(".tm-things-deadline")!.textContent).toBe("11 days left");
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
    const { secondary, lead, edit, openSource } = row("- [ ] Plan 2026-10-08", { source: "Projects/New Project.md" });
    expect(secondary.textContent).toBe("New Project");
    (secondary.firstElementChild as HTMLElement).click();
    expect(openSource).toHaveBeenCalledOnce();
    (lead.firstElementChild as HTMLElement).click();
    expect(edit).toHaveBeenCalledWith("scheduledDate");
  });

  it("leaves out properties the list is grouped by", () => {
    const { lead, inline } = row("- [ ] Plan 2026-10-08 {2026-09-30}", { grouping: "scheduledDate" });
    expect(lead.childElementCount).toBe(0);
    expect(inline.querySelector(".tm-things-deadline")).not.toBeNull();
  });
});
