// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderTaskDetails } from "../src/task-row-details";
import { scanTasks } from "../src/parser";
import type { TaskGrouping, TaskProperty } from "../src/types";

beforeAll(() => {
  installObsidianDom();
  // happy-dom's document creates fragments from a window-bound subclass the helper does not patch.
  const fragment = Object.getPrototypeOf(document.createDocumentFragment()) as Record<string, unknown>;
  const patched = DocumentFragment.prototype as unknown as Record<string, unknown>;
  for (const key of ["createEl", "createDiv", "createSpan"]) fragment[key] ??= patched[key];
});
const now = new Date(2026, 8, 19, 12);

function row(line: string, options: { grouping?: TaskGrouping; show?: (property: TaskProperty) => boolean } = {}) {
  const primary = document.createElement("div"), metadata = document.createElement("div");
  const task = scanTasks("Note.md", line, now)[0];
  const edit = vi.fn();
  renderTaskDetails(primary, metadata, task, { now, grouping: options.grouping ?? "none", show: options.show, dateFormat: "MMM D, YYYY", tags: task.tags ?? [], edit, openSource: vi.fn() });
  return { primary, metadata, edit, defer: metadata.querySelector<HTMLElement>(".tm-task-defer") };
}

describe("task row defer pill", () => {
  it("shows an editable relative label after the schedule while hiding the task", () => {
    const { metadata, defer, edit } = row("- [ ] Renew 2026-09-19 >2026-09-20 #[[x]]");
    expect(Array.from(metadata.children).map(child => child.className)).toEqual(["tm-task-schedule", "tm-task-defer is-active", "tm-task-tag"]);
    expect(defer!.textContent).toBe("Hidden until Tomorrow");
    expect(defer!.getAttribute("title")).toBe("Hidden until Sep 20, 2026");
    expect(defer!.getAttribute("data-tm-focus-key")).toBe("defer");
    expect(defer!.getAttribute("role")).toBe("button");
    defer!.click();
    expect(edit).toHaveBeenCalledWith("defer");
    defer!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(edit).toHaveBeenCalledTimes(2);
  });
  it("labels someday and drops the active state once the date arrives", () => {
    expect(row("- [ ] Learn >someday").defer).toMatchObject({ textContent: "Someday", className: "tm-task-defer is-active" });
    expect(row("- [ ] Past >2026-09-19").defer).toMatchObject({ textContent: "Hidden until Today", className: "tm-task-defer" });
    expect(row("- [ ] Past >2026-09-10").defer!.textContent).toBe("Hidden until 9d ago");
  });
  it("respects hidden fields and grouping by defer", () => {
    expect(row("- [ ] Renew >2026-09-20", { show: property => property !== "defer" }).defer).toBeNull();
    expect(row("- [ ] Renew >2026-09-20", { grouping: "defer" }).defer).toBeNull();
    expect(row("- [ ] Renew").defer).toBeNull();
  });
});

