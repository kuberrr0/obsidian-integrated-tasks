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
