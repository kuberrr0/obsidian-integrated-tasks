import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import { scanTasks } from "../src/parser";
import { TaskStore } from "../src/task-store";
import type { Task } from "../src/types";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 27, 12)); });
afterEach(() => { vi.useRealTimers(); });

function setup(source: string, options: { enabled?: boolean; format?: string; linkDates?: boolean } = {}) {
  const file = Object.assign(new TFile(), { path: "Project.md" });
  const texts = new Map([[file.path, source]]);
  const app = {
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => ({}) },
    vault: {
      getAbstractFileByPath: (path: string) => path === file.path ? file : undefined,
      read: async (target: TFile) => texts.get(target.path)!,
      process: async (target: TFile, update: (text: string) => string) => { texts.set(target.path, update(texts.get(target.path)!)); }
    }
  } as unknown as App;
  const format = options.format ?? "YYYY-MM-DD";
  const store = new TaskStore(app, () => format, () => "top", () => options.linkDates ?? false, () => 1, () => options.enabled ?? true);
  return { store, text: () => texts.get(file.path)!, tasks: (): Task[] => scanTasks(file.path, texts.get(file.path)!, new Date(), format) };
}

describe("recording completion dates from the store", () => {
  it("stamps today on toggle and removes it on reopen, undoably", async () => {
    const { store, text, tasks } = setup("- [ ] Pay rent p1 #[[home]] ^r1\n");
    await store.toggle(tasks()[0], true);
    expect(text()).toBe("- [x] Pay rent p1 #[[home]] ✓2026-09-27 ^r1\n");
    expect(tasks()[0].completedDate).toBe("2026-09-27");
    await store.toggle(tasks()[0], false);
    expect(text()).toBe("- [ ] Pay rent p1 #[[home]] ^r1\n");
    await store.undo();
    expect(text()).toBe("- [x] Pay rent p1 #[[home]] ✓2026-09-27 ^r1\n");
  });

  it("writes the configured format or a link", async () => {
    const formatted = setup("- [ ] Pay\n", { format: "MMM D, YYYY" });
    await formatted.store.toggle(formatted.tasks()[0], true);
    expect(formatted.text()).toBe("- [x] Pay ✓Sep 27, 2026\n");
    const linked = setup("- [ ] Pay\n", { linkDates: true });
    await linked.store.toggle(linked.tasks()[0], true);
    expect(linked.text()).toBe("- [x] Pay ✓[[2026-09-27]]\n");
  });

  it("adds and removes nothing when the setting is off", async () => {
    const { store, text, tasks } = setup("- [ ] Pay\n- [x] Paid ✓2026-09-20\n", { enabled: false });
    await store.toggle(tasks()[0], true);
    await store.toggle(tasks()[1], false);
    expect(text()).toBe("- [x] Pay\n- [ ] Paid ✓2026-09-20\n");
  });

  it("stamps status drops and bulk completions, and unstamps reopening drops", async () => {
    const { store, text, tasks } = setup("- [ ] A\n- [ ] B 2026-09-28\n- [x] C ✓2026-09-01\n");
    await store.bulkDrop(tasks().slice(0, 2), { property: "status", value: "Completed" });
    expect(text()).toBe("- [x] A ✓2026-09-27\n- [x] B 2026-09-28 ✓2026-09-27\n- [x] C ✓2026-09-01\n");
    await store.bulkDrop([tasks()[0], tasks()[2]], { property: "status", value: "Open" });
    expect(text()).toBe("- [ ] A\n- [x] B 2026-09-28 ✓2026-09-27\n- [ ] C\n");
    await store.bulkUpdate([tasks()[0]], { completed: true });
    expect(text()).toContain("- [x] A ✓2026-09-27\n");
  });

  it("stamps editor saves that complete a task, but keeps a date the user typed", async () => {
    const { store, text, tasks } = setup("- [ ] A\n- [ ] B\n");
    const [a, b] = tasks();
    await store.update(a, { ...a, completed: true, destination: "Project.md" });
    await store.update(b, { ...b, completed: true, completedDate: "2026-09-25", destination: "Project.md" });
    expect(text()).toBe("- [x] A ✓2026-09-27\n- [x] B ✓2026-09-25\n");
    // Saving an already completed task leaves its date alone.
    const [done] = tasks();
    await store.update(done, { ...done, priority: 2, destination: "Project.md" });
    expect(text()).toBe("- [x] A p2 ✓2026-09-27\n- [x] B ✓2026-09-25\n");
  });
});
