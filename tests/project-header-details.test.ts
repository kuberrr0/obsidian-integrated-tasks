import { expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { projectDateLabel, renderProjectHeaderDetails } from "../src/project-header-details";
import type { Project } from "../src/types";
const now = new Date(2026, 8, 19);
class Element {
    children: Element[] = [];
    handlers = new Map<string, (event: unknown) => void>();
    attrs: Record<string, string> = {};
    cls = ""; text = "";
    createSpan(options: { cls?: string; text?: string; attr?: Record<string, string> }) {
        const child = new Element(); child.cls = options.cls ?? ""; child.text = options.text ?? ""; child.attrs = options.attr ?? {};
        this.children.push(child); return child;
    }
    setAttribute(key: string, value: string) { this.attrs[key] = value; }
    addEventListener(type: string, fn: (event: unknown) => void) { this.handlers.set(type, fn); }
}
const project: Project = { path: "Launch.md", name: "Launch", openTasks: 3, completedTasks: 1, archived: false };
it("hides only the current year", () => {
    expect(projectDateLabel("2026-09-19", now)).toBe("Sep 19");
    expect(projectDateLabel("2027-01-10", now)).toBe("Jan 10, 2027");
    expect(projectDateLabel("2025-12-31", now)).toBe("Dec 31, 2025");
});
it("renders start - end with independently editable endpoints and matching details", () => {
    const root = new Element(), edit = vi.fn();
    renderProjectHeaderDetails(root as never, { ...project, scheduledDate: "2026-09-20", endDate: "2027-01-10", deadline: "2026-09-23", priority: 2, parent: "Projects/Studio.md" }, edit, "YYYY-MM-DD", now);
    expect(root.children.map(child => child.cls)).toEqual(["tm-project-date-range", "tm-task-due", "tm-task-source"]);
    expect(root.children[0].children.map(child => child.text).join("")).toBe("Sep 20 - Jan 10, 2027");
    expect(root.children[1].children[1].text).toBe("4d");
    expect(root.children[2].text).toBe("Studio");
    for (const [element, field] of [[root.children[0].children[0], "date"], [root.children[0].children[2], "endDate"], [root.children[1], "deadline"], [root.children[2], "parent"]] as const) {
        element.handlers.get("click")!({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(edit).toHaveBeenLastCalledWith(field);
        element.handlers.get("keydown")!({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(edit).toHaveBeenLastCalledWith(field);
    }
});
it.each(["scheduledDate", "endDate"] as const)("shows a lone %s without a dangling separator", field => {
    const root = new Element();
    renderProjectHeaderDetails(root as never, { ...project, [field]: "2026-09-20" }, vi.fn(), "YYYY-MM-DD", now);
    expect(root.children[0].children.map(child => child.text).join("")).toBe("Sep 20");
});

it("marks overdue project deadlines and hides project priority", () => {
    const root = new Element();
    renderProjectHeaderDetails(root as never, { ...project, deadline: "2026-09-18", priority: 1 }, vi.fn(), "YYYY-MM-DD", now);
    expect(root.children.map(child => child.cls)).toEqual(["tm-task-due is-overdue"]);
});

it("places list deadlines beside the title while retaining metadata and edit actions", () => {
    const metadata = new Element(), primary = new Element(), edit = vi.fn();
    primary.createSpan({ text: project.name });
    renderProjectHeaderDetails(metadata as never, { ...project, scheduledDate: "2026-09-20", deadline: "2026-09-23", parent: "Studio.md" }, edit, "YYYY-MM-DD", now, primary as never);
    expect(primary.children.map(child => child.cls)).toEqual(["", "tm-task-due"]);
    expect(metadata.children.map(child => child.cls)).toEqual(["tm-project-date-range", "tm-task-source"]);
    const deadline = primary.children[1];
    expect(deadline.children[1].text).toBe("4d");
    deadline.handlers.get("click")!({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(edit).toHaveBeenCalledWith("deadline");
});

it.each([
    ["2026-09-26", "tm-task-due"],
    ["2026-09-27", "tm-task-due is-distant"],
    ["2027-01-01", "tm-task-due is-distant"]
])("mutes project deadlines only beyond seven calendar days: %s", (deadline, cls) => {
    const root = new Element();
    renderProjectHeaderDetails(root as never, { ...project, deadline }, vi.fn(), "YYYY-MM-DD", now);
    expect(root.children[0].cls).toBe(cls);
});
it("shows the Things deadline in the Things style: the date and how far off it is, red once due", () => {
    const root = new Element(), edit = vi.fn();
    renderProjectHeaderDetails(root as never, { ...project, deadline: "2026-10-25" }, edit, "YYYY-MM-DD", now, undefined, true);
    const [deadline] = root.children;
    expect(deadline.cls).toBe("tm-things-card-property tm-things-project-deadline");
    expect(deadline.children.map(child => [child.cls, child.text])).toEqual([
        ["tm-things-card-icon", ""], ["tm-things-card-label", "Deadline: Sun, Oct 25"], ["tm-things-card-extra", "36 days left"]
    ]);
    deadline.handlers.get("click")!({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(edit).toHaveBeenCalledWith("deadline");
    const overdue = new Element();
    renderProjectHeaderDetails(overdue as never, { ...project, deadline: "2026-09-18" }, edit, "YYYY-MM-DD", now, undefined, true);
    expect(overdue.children[0].cls).toBe("tm-things-card-property tm-things-project-deadline is-urgent");
    expect(overdue.children[0].children[2].text).toBe("1 day ago");
});
it("shows the Things dates in the Things style: one calendar line whose start and end edit separately", () => {
    const root = new Element(), edit = vi.fn();
    renderProjectHeaderDetails(root as never, { ...project, scheduledDate: "2026-09-20", endDate: "2027-01-10", deadline: "2026-10-25" }, edit, "YYYY-MM-DD", now, undefined, true);
    const [dates, deadline] = root.children;
    expect(dates.cls).toBe("tm-things-card-property tm-things-project-dates");
    expect(deadline.cls).toBe("tm-things-card-property tm-things-project-deadline");
    const [icon, label] = dates.children;
    expect(icon.cls).toBe("tm-things-card-icon");
    expect(label.children.map(child => child.text).join("")).toBe("Sun, Sep 20 – Sun, Jan 10, 2027");
    for (const [element, field] of [[label.children[0], "date"], [label.children[2], "endDate"]] as const) {
        element.handlers.get("click")!({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(edit).toHaveBeenLastCalledWith(field);
    }
    const lone = new Element();
    renderProjectHeaderDetails(lone as never, { ...project, endDate: "2026-09-25" }, vi.fn(), "YYYY-MM-DD", now, undefined, true);
    expect(lone.children[0].children[1].children.map(child => child.text).join("")).toBe("Fri, Sep 25");
});
