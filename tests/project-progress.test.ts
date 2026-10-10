import { expect, it, vi } from "vitest";
import { renderProjectProgress } from "../src/project-progress";
import type { Project } from "../src/types";

it.each([[0, 0, 0], [4, 5, 56], [0, 8, 100], [8, 0, 0]])("renders progress for %i open and %i completed tasks", (openTasks, completedTasks, percentage) => {
    const spans: Array<Record<string, unknown>> = [];
    const setProperty = vi.fn();
    const createDiv = vi.fn(() => ({ createSpan: (options: Record<string, unknown>) => { spans.push(options); return { style: { setProperty } }; } }));
    const project = { name: "Project", openTasks, completedTasks } as Project;
    renderProjectProgress({ createDiv } as never, project);
    expect(createDiv).toHaveBeenCalledWith(expect.objectContaining({ attr: expect.objectContaining({ role: "progressbar", "aria-valuenow": String(percentage) }) }));
    expect(spans[0].cls).toBe("tm-project-progress-circle");
    expect(spans[1]).toMatchObject({ cls: "tm-project-percentage", text: `${percentage}%` });
    const total = openTasks + completedTasks;
    expect(setProperty).toHaveBeenCalledWith("--tm-project-progress", `${total ? completedTasks / total * 100 : 0}%`);
});
it("uses only the circle when replacing a project list icon", () => {
    const createSpan = vi.fn(() => ({ style: { setProperty: vi.fn() } }));
    renderProjectProgress({ createDiv: () => ({ createSpan }) } as never, { name: "Project", openTasks: 4, completedTasks: 5 } as Project, false);
    expect(createSpan).toHaveBeenCalledOnce();
    expect(createSpan).toHaveBeenCalledWith(expect.objectContaining({ cls: "tm-project-progress-circle" }));
});
it("draws a parent's ring from its subprojects' tasks too", () => {
    const createDiv = vi.fn(() => ({ createSpan: () => ({ style: { setProperty: vi.fn() } }) }));
    renderProjectProgress({ createDiv } as never, { name: "House", openTasks: 0, completedTasks: 2, totals: { open: 18, completed: 2 } } as Project);
    expect(createDiv).toHaveBeenCalledWith(expect.objectContaining({ attr: expect.objectContaining({ "aria-valuenow": "10", "aria-label": "House: 2 of 20 tasks completed" }) }));
});
