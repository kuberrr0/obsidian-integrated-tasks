import { expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), ItemView: class {}, MarkdownView: class {}, Notice: class {}, setIcon: vi.fn()
}));
import { MarkdownView, TFile } from "obsidian";
import { TaskModeController } from "../src/task-mode";
import { TaskMainView, TASK_MAIN_VIEW } from "../src/task-view";

it("keeps a remembered task-view layout attached to a note after it is renamed", async () => {
  let enabled = true;
  const projects = new Set(["Project.md"]);
  const file = Object.assign(new TFile(), { path: "Project.md" });
  const leaf = { view: undefined as unknown as MarkdownView | TaskMainView, setViewState: vi.fn() };
  const markdown = (state: Record<string, unknown>) => Object.assign(Object.create(MarkdownView.prototype), { file, getState: () => state }) as MarkdownView;
  leaf.view = markdown({ file: "Project.md", mode: "source" });
  leaf.setViewState.mockImplementation(async next => {
    if (next.type === "markdown") { leaf.view = markdown(next.state); return; }
    const view = new TaskMainView(leaf as unknown as WorkspaceLeaf, {} as never);
    vi.spyOn(view, "render").mockImplementation(() => {});
    await view.setState(next.state);
    leaf.view = view;
  });
  const app = {
    workspace: { getLeavesOfType: (type: string) => [leaf].filter(candidate => type === "markdown" ? candidate.view instanceof MarkdownView : type === TASK_MAIN_VIEW && candidate.view instanceof TaskMainView) },
    vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null }
  } as unknown as App;
  const controller = new TaskModeController(app, () => enabled, path => projects.has(path));
  await controller.sync();
  await (leaf.view as unknown as TaskMainView).setState({ ...leaf.view.getState(), layout: "kanban" });
  enabled = false; await controller.sync();
  expect(leaf.view).toBeInstanceOf(MarkdownView);
  // Obsidian moves the Markdown tab to the new path; the remembered layout follows.
  file.path = "Renamed.md";
  projects.clear(); projects.add("Renamed.md");
  controller.renamePath("Project.md", "Renamed.md");
  enabled = true; await controller.sync();
  expect(leaf.view.getState()).toMatchObject({ pagePath: "Renamed.md", layout: "kanban" });
});
