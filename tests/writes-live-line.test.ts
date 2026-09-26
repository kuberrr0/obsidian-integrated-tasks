import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { scanTasks } from "../src/parser";
import { bodyLines } from "../src/structure";
import { findLiveLine, toggleTaskInContent } from "../src/markdown";
import { TaskStore } from "../src/task-store";
import type { Task } from "../src/types";

function setup(content: string) {
  const file = Object.assign(new TFile(), { path: "Week.md" });
  let text = content;
  const app = { vault: {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    read: async () => text,
    process: async (_file: TFile, update: (content: string) => string) => { text = update(text); }
  } } as unknown as App;
  return { store: new TaskStore(app, () => "YYYY-MM-DD"), read: () => text, write: (value: string) => { text = value; } };
}

describe("locating stale snapshots of duplicate lines", () => {
  const week = "# Mon\n- [ ] Water plants\n    - note mon\n# Tue\n- [ ] Water plants\n    - note tue\n";

  it("deletes the Tuesday task after lines were added above, never Monday's", async () => {
    const { store, read, write } = setup(week);
    const tuesday = scanTasks("Week.md", week)[1];
    write("Intro\n\nMore\n" + week);
    await store.delete(tuesday);
    expect(read()).toBe("Intro\n\nMore\n# Mon\n- [ ] Water plants\n    - note mon\n# Tue\n");
  });

  it("refuses to guess between identical tasks in the same section", async () => {
    const content = "# Mon\n- [ ] Water plants\n- [ ] Water plants\n";
    const { store, read, write } = setup(content);
    const first = scanTasks("Week.md", content)[0];
    write("A\nB\nC\n" + content);
    await expect(store.delete(first)).rejects.toThrow(/changed in its note/);
    expect(read()).toBe("A\nB\nC\n" + content);
  });

  it("uses the only matching line even when its section changed", () => {
    const task = scanTasks("Week.md", week)[1];
    expect(findLiveLine(["# Renamed", "x", "x", "x", "- [ ] Water plants"], task)).toBe(4);
  });

  it("ignores matches inside frontmatter and fenced code", () => {
    const task = { ...scanTasks("W.md", "- [ ] Water")[0], line: 1 } as Task;
    expect(findLiveLine("```\n- [ ] Water\n```\n- [ ] Water".split("\n"), task)).toBe(3);
    expect(() => findLiveLine("---\n- [ ] Water\n---\n".split("\n"), task)).toThrow(/changed/);
  });
});

describe("fences indented inside list items", () => {
  it("does not index tasks in an indented fence", () => {
    const content = "- [ ] Parent\n    ```md\n    - [ ] example\n    ```\n- [ ] After\n\t~~~\n\t- [ ] tabbed\n\t~~~\n";
    expect(scanTasks("W.md", content).map(task => task.title)).toEqual(["Parent", "After"]);
  });

  it("closes only on the same character with at least the opening length", () => {
    const content = "  ````\n- [ ] in\n  ```\n- [ ] still in\n  ~~~~\n- [ ] also in\n      ````\n- [ ] out";
    expect(bodyLines(content).map(line => line.text)).toEqual(["- [ ] out"]);
  });

  it("does not toggle a fenced example line", () => {
    const content = "- [ ] Parent\n    ```md\n    - [ ] example\n    ```\n";
    const stale = { ...scanTasks("W.md", "- [ ] Parent\n    - [ ] example")[1] } as Task;
    expect(() => toggleTaskInContent(content, stale, true)).toThrow(/changed/);
  });
});
