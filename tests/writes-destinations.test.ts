import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { parseTaskInput, scanTasks } from "../src/parser";
import { splitDestination } from "../src/structure";
import { TaskStore } from "../src/task-store";
import { rescheduledDraft } from "../src/calendar";
import { draftForGroup } from "../src/list-drag";

function setup(files: Record<string, string>) {
  const records = Object.fromEntries(Object.keys(files).map(path => [path, Object.assign(new TFile(), { path })]));
  const app = { vault: {
    getAbstractFileByPath: (path: string) => records[path],
    read: async (file: TFile) => files[file.path],
    process: async (file: TFile, update: (content: string) => string) => { files[file.path] = update(files[file.path]); }
  } } as unknown as App;
  return new TaskStore(app, () => "YYYY-MM-DD");
}

describe("destination splitting", () => {
  it.each([
    ["~[[Work#Work for [[Project X]]]]", "Work.md", "Work for [[Project X]]"],
    ["Work.md#Work for [[Project X]]", "Work.md", "Work for [[Project X]]"],
    ["Work.md#Q1 | Plan", "Work.md", "Q1 | Plan"],
    ["[[Work|Alias]]", "Work.md", undefined],
    ["[[Work|Alias#Plan]]", "Work.md", "Plan"],
    ["Work#Plan]]", "Work.md", "Plan]]"]
  ])("%s", (value, path, heading) => {
    expect(splitDestination(value)).toEqual({ path, heading });
  });

  it("parses destinations whose heading holds a link, without swallowing later tokens", () => {
    expect(parseTaskInput("Do ~[[Work#Work for [[Project X]]]]", new Date(2026, 8, 26), undefined, false)?.destination).toBe("Work.md#Work for [[Project X]]");
    expect(parseTaskInput("Do ~[[Work#Plan]] [[2026-10-01]]", new Date(2026, 8, 26), undefined, false))
      .toMatchObject({ title: "Do", destination: "Work.md#Plan", scheduledDate: "2026-10-01" });
  });
});

describe("rescheduling tasks under unusual headings", () => {
  it("does not throw for a heading containing a link", async () => {
    const files = { "Work.md": "# Work for [[Project X]]\n- [ ] Task [[2026-09-20]]\n# Other\n" };
    const task = scanTasks("Work.md", files["Work.md"])[0];
    await setup(files).update(task, rescheduledDraft(task, "2026-09-21"));
    expect(files["Work.md"]).toBe("# Work for [[Project X]]\n- [ ] Task [[2026-09-21]]\n# Other\n");
  });

  it("does not silently move a task from '# Q1 | Plan' to '# Q1'", async () => {
    const content = "# Q1\n- [ ] Keep\n# Q1 | Plan\n- [ ] Task [[2026-09-20]]\n";
    const files = { "Work.md": content };
    const store = setup(files);
    const task = scanTasks("Work.md", content)[1];
    await store.update(task, rescheduledDraft(task, "2026-09-21"));
    expect(files["Work.md"]).toBe("# Q1\n- [ ] Keep\n# Q1 | Plan\n- [ ] Task [[2026-09-21]]\n");
    await store.bulkChange(scanTasks("Work.md", files["Work.md"]), original => rescheduledDraft(original, "2026-09-22"));
    expect(files["Work.md"]).toBe("# Q1\n- [ ] Keep [[2026-09-22]]\n# Q1 | Plan\n- [ ] Task [[2026-09-22]]\n");
  });

  it("moves into a heading containing '|' when asked to", async () => {
    const files = { "Work.md": "# Q1\n- [ ] Move me\n# Q1 | Plan\n- [ ] Existing\n" };
    const task = scanTasks("Work.md", files["Work.md"])[0];
    await setup(files).update(task, { ...draftForGroup(task), destination: "Work.md#Q1 | Plan" });
    expect(files["Work.md"]).toBe("# Q1\n# Q1 | Plan\n- [ ] Move me\n- [ ] Existing\n");
  });
});
