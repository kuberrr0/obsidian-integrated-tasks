import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", async importOriginal => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), ItemView: class {}, MarkdownView: class {}, Notice: class {}, setIcon: vi.fn()
}));
import { MarkdownView, TFile } from "obsidian";
import { TaskModeController } from "../src/task-mode";
import { TaskMainView, TASK_MAIN_VIEW } from "../src/task-view";

async function setup() {
  let enabled = false;
  const projects = new Set(["Project.md", "Project2.md"]);
  const files = new Map<string, TFile>();
  const leaves: Array<{ view: MarkdownView | TaskMainView; setViewState: ReturnType<typeof vi.fn> }> = [];
  const app = { workspace: { getLeavesOfType: (type: string) => leaves.filter(leaf => type === "markdown" ? leaf.view instanceof MarkdownView : type === TASK_MAIN_VIEW && leaf.view instanceof TaskMainView) }, vault: { getAbstractFileByPath: (path: string) => files.get(path) } } as unknown as App;
  const controller = new TaskModeController(app, () => enabled, path => projects.has(path));
  const add = (path: string) => {
    const file = Object.assign(new TFile(), { path }); files.set(path, file);
    const state = { file: path, mode: "source", source: true, scroll: 12 };
    const markdown = Object.assign(Object.create(MarkdownView.prototype), { file, getState: () => state }) as MarkdownView;
    const leaf = { view: markdown as MarkdownView | TaskMainView, setViewState: vi.fn() };
    leaf.setViewState.mockImplementation(async next => {
      if (next.type === "markdown") leaf.view = Object.assign(Object.create(MarkdownView.prototype), { file, getState: () => next.state });
      else {
        const view = new TaskMainView(leaf as unknown as WorkspaceLeaf, {} as never);
        vi.spyOn(view, "render").mockImplementation(() => {});
        await view.setState(next.state);
        leaf.view = view;
      }
      void controller.sync(); // Simulate layout-change during conversion.
    });
    leaves.push(leaf);
    return { leaf, state };
  };
  return { controller, projects, add, setEnabled: (value: boolean) => { enabled = value; } };
}

describe("global task mode", () => {
  it("converts every project tab without touching ordinary notes or requesting focus", async () => {
    const { controller, add, setEnabled } = await setup();
    const first = add("Project.md"); const second = add("Project2.md"); const ordinary = add("Notes.md");
    setEnabled(true); await controller.sync();
    for (const { leaf, state } of [first, second]) {
      expect(leaf.setViewState).toHaveBeenCalledExactlyOnceWith({ type: TASK_MAIN_VIEW, state: { mode: "all", pagePath: state.file, markdownState: state } });
    }
    expect(ordinary.leaf.setViewState).not.toHaveBeenCalled();
  });
  it("restores all project editors and their original state when disabled", async () => {
    const { controller, add, setEnabled } = await setup();
    const { leaf, state } = add("Project.md");
    setEnabled(true); await controller.sync(); setEnabled(false); await controller.sync();
    expect(leaf.setViewState).toHaveBeenLastCalledWith({ type: "markdown", state });
    expect(leaf.view).toBeInstanceOf(MarkdownView);
  });
  it("converts newly opened projects while enabled and leaves notes alone when disabled", async () => {
    const { controller, add, setEnabled } = await setup();
    const first = add("Project.md"); await controller.sync();
    expect(first.leaf.setViewState).not.toHaveBeenCalled();
    setEnabled(true); await controller.sync();
    const second = add("Project2.md"); await controller.sync();
    expect(second.leaf.view).toBeInstanceOf(TaskMainView);
  });
  it("responds to project tags being added and removed", async () => {
    const { controller, add, setEnabled, projects } = await setup();
    const { leaf } = add("Notes.md"); setEnabled(true);
    projects.add("Notes.md"); await controller.sync(); expect(leaf.view).toBeInstanceOf(TaskMainView);
    projects.delete("Notes.md"); await controller.sync(); expect(leaf.view).toBeInstanceOf(MarkdownView);
  });
  it("coalesces event bursts and stops after disposal", async () => {
    const { controller, add, setEnabled } = await setup();
    const { leaf } = add("Project.md"); setEnabled(true);
    await Promise.all([controller.sync(), controller.sync(), controller.sync()]);
    expect(leaf.setViewState).toHaveBeenCalledOnce();
    controller.dispose(); setEnabled(false); await controller.sync();
    expect(leaf.setViewState).toHaveBeenCalledOnce();
  });
});
