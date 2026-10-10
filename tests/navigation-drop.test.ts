// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() };
});

import type { WorkspaceLeaf } from "obsidian";
import { TaskNavigationView } from "../src/navigation-view";
import { dropTargetAt, dropTargetOf, startTaskDrag, TASK_DRAG_TYPE, type SidebarDrop } from "../src/sidebar-drop";
import { DEFAULT_SETTINGS } from "../src/types";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => installObsidianDom());

function sidebar() {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, showFiles: false },
    index: {
      projects: () => [{ path: "Work.md", name: "Work", archived: false, progress: 0 }],
      tagSummaries: () => [{ name: "errand", openTasks: 1, completedTasks: 0 }],
      query: () => []
    }
  } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({} as WorkspaceLeaf, plugin);
  // Tags start folded; open them.
  (view as unknown as { expanded: Set<string> }).expanded.add("tags");
  view.refresh();
  const container = view.containerEl.children[1] as HTMLElement;
  const row = (key: string) => container.querySelector(`[data-tm-nav-key="${key}"]`)!.closest<HTMLElement>(".tm-nav-item")!;
  return { container, row };
}

/** A native drag event carrying `types`, as a calendar card's drag does. */
function dragEvent(type: string, types: string[]): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { types, dropEffect: "none" } });
  return event;
}

it("marks Inbox, Today, each project and each tag as places to drop tasks, and no other list", () => {
  const { container, row } = sidebar();
  const drops = (key: string) => dropTargetOf(row(key))?.drop;
  expect(drops("mode:inbox")).toEqual({ kind: "inbox" });
  expect(drops("mode:today")).toEqual({ kind: "today" });
  expect(drops("project:Work.md")).toEqual({ kind: "project", path: "Work.md" });
  expect(drops("tag:errand")).toEqual({ kind: "tag", tag: "errand" });
  for (const key of ["mode:upcoming", "mode:all", "mode:projects", "mode:tags"]) expect(drops(key)).toBeUndefined();
  // The list under the pointer, found from anything inside its row.
  const label = row("mode:today").querySelector<HTMLElement>(".tm-nav-label")!;
  const doc = { elementFromPoint: () => label } as unknown as Document;
  expect(dropTargetAt(doc, 0, 0)).toEqual({ element: row("mode:today"), drop: { kind: "today" } });
  expect(container.querySelectorAll("[data-tm-drop]")).toHaveLength(4);
});

it("takes a native drag of tasks, lighting up while over, and ignores other drags", async () => {
  const { row } = sidebar();
  const drop = vi.fn(async (_target: SidebarDrop) => {});
  const project = row("project:Work.md");
  // A file dragged over the sidebar is not a task.
  startTaskDrag(document, { tasks: [], drop });
  const file = dragEvent("dragover", ["Files"]);
  project.dispatchEvent(file);
  expect(file.defaultPrevented).toBe(false);
  expect(project.classList.contains("is-drop-target")).toBe(false);
  const over = dragEvent("dragover", ["text/plain", TASK_DRAG_TYPE]);
  project.dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  expect(project.classList.contains("is-drop-target")).toBe(true);
  project.dispatchEvent(dragEvent("drop", ["text/plain", TASK_DRAG_TYPE]));
  expect(drop).toHaveBeenCalledExactlyOnceWith({ kind: "project", path: "Work.md" });
  expect(project.classList.contains("is-drop-target")).toBe(false);
  // Once the drag ends, nothing is dragged any more.
  document.dispatchEvent(new Event("dragend"));
  project.dispatchEvent(dragEvent("drop", ["text/plain", TASK_DRAG_TYPE]));
  expect(drop).toHaveBeenCalledOnce();
});
