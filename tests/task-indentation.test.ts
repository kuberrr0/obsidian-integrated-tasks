import { afterEach, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { indentText, indentWidth, useIndentation } from "../src/task-indentation";
import { scanTasks, serializeTask } from "../src/parser";
import { planBulkTasks } from "../src/bulk-tasks";
import { draftForGroup } from "../src/list-drag";
import { TaskStore } from "../src/task-store";

afterEach(() => useIndentation(() => ({ useTab: false, tabSize: 4 })));

function store(content: string) {
  const file = Object.assign(new TFile(), { path: "Project.md" });
  let text = content;
  const app = { vault: {
    getAbstractFileByPath: () => file, read: async () => text,
    process: async (_file: TFile, update: (content: string) => string) => { text = update(text); }
  } } as unknown as App;
  return { store: new TaskStore(app, () => "YYYY-MM-DD", () => "top", () => true), read: () => text };
}

it("indents with tabs, a tab as wide as Obsidian's tab size", () => {
  useIndentation(() => ({ useTab: true, tabSize: 4 }));
  expect(indentText(8)).toBe("\t\t");
  expect(indentText(6)).toBe("\t  ");
  expect(indentWidth("\t  - [ ] A")).toBe(6);
  expect(serializeTask({ title: "A", completed: false, indent: 4, destination: "" })).toMatch(/^\t- \[ \] A/);
  useIndentation(() => ({ useTab: true, tabSize: 2 }));
  expect(indentWidth("\t\t- [ ] A")).toBe(4);
});

it("reads a tab-indented subtask afresh after the tab size changes", () => {
  useIndentation(() => ({ useTab: true, tabSize: 4 }));
  expect(scanTasks("Project.md", "- [ ] Parent\n\t- [ ] Step")[1].indent).toBe(4);
  useIndentation(() => ({ useTab: true, tabSize: 2 }));
  expect(scanTasks("Project.md", "- [ ] Parent\n\t- [ ] Step")[1].indent).toBe(2);
});

it("adds a first subtask one level in, as Obsidian would type it", async () => {
  useIndentation(() => ({ useTab: true, tabSize: 4 }));
  let { store: tabs, read } = store("- [ ] Parent\n");
  await tabs.addSubtask(scanTasks("Project.md", read())[0], { title: "Step" });
  expect(read()).toBe("- [ ] Parent\n\t- [ ] Step\n");
  useIndentation(() => ({ useTab: false, tabSize: 2 }));
  ({ store: tabs, read } = store("- [ ] Parent\n"));
  await tabs.addSubtask(scanTasks("Project.md", read())[0], { title: "Step" });
  expect(read()).toBe("- [ ] Parent\n  - [ ] Step\n");
});

it("nests a moved task, and its subtasks, with tabs", () => {
  useIndentation(() => ({ useTab: true, tabSize: 4 }));
  const text = "- [ ] A\n- [ ] B\n\t- [ ] B1\n";
  const tasks = scanTasks("Work.md", text);
  const changed = planBulkTasks(new Map([["Work.md", text]]), [{ task: tasks[1], draft: draftForGroup(tasks[1]) }], { anchor: tasks[0], placement: "child" });
  expect(changed.get("Work.md")).toBe("- [ ] A\n\t- [ ] B\n\t\t- [ ] B1\n");
});

it("reads a task's notes indented with tabs without their indentation or bullets", async () => {
  useIndentation(() => ({ useTab: true, tabSize: 4 }));
  const [task] = scanTasks("Work.md", "- [ ] Plan\n\t- First note\n\t- Second note\n\t\t- Detail");
  expect(task.description).toBe("- First note\n- Second note\n    - Detail");
  const { cardNotes } = await import("../src/things-task-card");
  expect(cardNotes(task.description)).toBe("First note\nSecond note\n    - Detail");
});
