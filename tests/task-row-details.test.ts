import { expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { deadlineIsOverdue, renderTaskDetails, taskScheduleLabel, taskDeadlineLabel, taskDayDistance, taskTimeLabel, taskTimeDurationLabel } from "../src/task-row-details";
import { scanTasks } from "../src/parser";

const now = new Date(2026, 8, 19, 12);
it("formats relative schedules, countdowns, and calendar dates across years", () => {
    expect(taskScheduleLabel("2026-08-07", now)).toBe("43d ago");
    expect(taskScheduleLabel("2026-09-19", now)).toBe("Today");
    expect(taskScheduleLabel("2026-09-20", now)).toBe("Tomorrow");
    expect(taskScheduleLabel("2026-10-01", now)).toBe("Oct 1");
    expect(taskScheduleLabel("2027-01-12", now)).toBe("Jan 12, 2027");
    expect(taskDeadlineLabel("2026-09-23", now)).toBe("4d");
    expect(taskDeadlineLabel("2026-10-20", now)).toBe("1m");
    expect(taskDayDistance("2027-01-01", new Date(2026, 11, 31))).toBe(1);
    expect(taskTimeLabel("00:00")).toBe("12:00 AM");
    expect(taskTimeLabel("21:30")).toBe("9:30 PM");
});

class Element {
    children: Element[] = [];
    attrs: Record<string, string> = {};
    handlers = new Map<string, (event: unknown) => void>();
    cls = "";
    text = "";
    createSpan(options: { text?: string; cls?: string; attr?: Record<string, string> }) {
        const child = new Element();
        child.cls = options.cls ?? ""; child.text = options.text ?? ""; child.attrs = options.attr ?? {};
        this.children.push(child); return child;
    }
    setAttribute(key: string, value: string) { this.attrs[key] = value; }
    addEventListener(type: string, fn: (event: unknown) => void) { this.handlers.set(type, fn); }
}

it("puts deadlines beside titles and schedules, source and plain tags below; keeps actions working", () => {
    const primary = new Element(), metadata = new Element();
    const task = scanTasks("Projects/Launch.md", "- [ ] Prepare 2026-09-20 21:00 30m {2026-09-23} p2 #[[work]]")[0];
    const edit = vi.fn(), openSource = vi.fn();
    renderTaskDetails(primary as never, metadata as never, task, { now, grouping: "none", show: () => true, dateFormat: "MMM D, YYYY", source: task.path, tags: task.tags!, edit, openSource });
    expect(primary.children.map(child => child.cls)).toEqual(["tm-task-due"]);
    expect(primary.children[0].children[1].text).toBe("4d");
    expect(metadata.children.map(child => child.cls)).toEqual(["tm-task-schedule", "tm-task-source", "tm-task-tag"]);
    expect(metadata.children[0].children.map(child => child.text).join("")).toBe("Tomorrow, 9:00-9:30 PM");
    expect(metadata.children[1].text).toBe("Launch");
    const event = { key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    primary.children[0].handlers.get("click")!(event);
    expect(edit).toHaveBeenCalledWith("deadline");
    metadata.children[1].handlers.get("keydown")!(event);
    expect(openSource).toHaveBeenCalledOnce();
});

it("respects hidden and grouped fields, retaining a time without its date", () => {
    const primary = new Element(), metadata = new Element();
    const task = scanTasks("Note.md", "- [ ] Task 2026-09-20 09:00 {2026-09-23} #[[work]]")[0];
    renderTaskDetails(primary as never, metadata as never, task, { now, grouping: "scheduledDate", show: property => !["deadline", "source", "tags"].includes(property), dateFormat: "YYYY-MM-DD", source: task.path, tags: task.tags!, edit: vi.fn(), openSource: vi.fn() });
    expect(primary.children).toHaveLength(0);
    expect(metadata.children).toHaveLength(1);
    expect(metadata.children[0].children[0].text).toBe("9:00 AM");
});

it("marks past dates and elapsed times today overdue, but not undated or all-day today", () => {
    expect(deadlineIsOverdue("2026-09-18", undefined, now)).toBe(true);
    expect(deadlineIsOverdue("2026-09-19", "11:00", now)).toBe(true);
    expect(deadlineIsOverdue("2026-09-19", "13:00", now)).toBe(false);
    expect(deadlineIsOverdue("2026-09-19", undefined, now)).toBe(false);
    expect(deadlineIsOverdue("2026-09-20", "09:00", now)).toBe(false);
});

it.each([
    ["17:00", 30, "5:00-5:30 PM"],
    ["11:45", 30, "11:45 AM-12:15 PM"],
    ["23:45", 30, "11:45 PM-12:15 AM (+1d)"],
    [undefined, 30, "30m"],
    ["17:00", undefined, "5:00 PM"],
    [undefined, undefined, ""]
])("formats time %s with duration %s", (time, duration, expected) => {
    expect(taskTimeDurationLabel(time, duration)).toBe(expected);
});

it("shows duration after the date without a start time, or alone without a date", () => {
    for (const date of ["2026-09-20", ""]) {
        const primary = new Element(), metadata = new Element();
        const task = scanTasks("Note.md", `- [ ] Task ${date} 30m`)[0];
        renderTaskDetails(primary as never, metadata as never, task, { now, grouping: "none", show: () => true, dateFormat: "YYYY-MM-DD", tags: [], edit: vi.fn(), openSource: vi.fn() });
        expect(metadata.children[0].children.map(child => child.text).join("")).toBe(date ? "Tomorrow, 30m" : "30m");
    }
});
