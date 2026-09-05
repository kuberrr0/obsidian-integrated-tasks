import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("./obsidian-mock")>(), Modal: class {}, Notice: class {}
}));
import { TaskEditorModal } from "../src/task-editor";
import { DEFAULT_SETTINGS, type TaskDraft } from "../src/types";

function editor() {
  return new TaskEditorModal({} as App, { mode: "inbox", projects: [], settings: { ...DEFAULT_SETTINGS, inboxPath: "Tasks/Inbox.md" }, dateFormat: "DD/MM/YYYY", onSave: async () => {} }) as unknown as {
    serializeDraft(draft: TaskDraft): string;
    readRaw(): TaskDraft;
    rawInput: { value: string };
    destinationInput: { value: string };
  };
}
const draft: TaskDraft = { title: "Write report", completed: false, destination: "Tasks/Inbox.md", indent: 0 };
describe("implicit Inbox destination", () => {
  it("omits the Inbox token while retaining explicit project and section tokens", () => {
    const modal = editor();
    expect(modal.serializeDraft(draft)).toBe("- [ ] Write report");
    expect(modal.serializeDraft({ ...draft, destination: "Project.md" })).toContain("~[[Project]]");
    expect(modal.serializeDraft({ ...draft, destination: "Tasks/Inbox.md#Later" })).toContain("~[[Tasks/Inbox#Later]]");
  });
  it("routes raw input without a token to configured Inbox even after selecting a project", () => {
    const modal = editor();
    modal.rawInput = { value: "- [ ] Write report" };
    modal.destinationInput = { value: "Project.md" };
    expect(modal.readRaw().destination).toBe("Tasks/Inbox.md");
    modal.rawInput.value = "- [ ] Write report ~[[Project]]";
    expect(modal.readRaw().destination).toBe("Project.md");
  });
});
