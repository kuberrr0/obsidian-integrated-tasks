import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { TFile, type App } from "obsidian";
import * as parser from "../src/parser";
import * as dates from "../src/date";
import * as query from "../src/query";
import { noteRecurringCompletion } from "../src/note-recurring-completion";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";

// Prose-only tasks used to try natural-language parsing at every word, taking seconds per scan.
const proseNote = (count: number): string =>
  Array.from({ length: count }, (_, i) => `- [ ] Call the vendor about item number ${i} for the open house`).join("\n");

describe("large notes", () => {
  // Counts date-parser calls rather than timing the scan, so slow CI machines cannot make it flaky.
  it("scans 10,000 prose-only tasks without trying to parse their words as dates", () => {
    const parse = vi.spyOn(dates, "parseDateTimeExpression");
    const tasks = parser.scanTasks("Big.md", proseNote(10_000), new Date(2026, 8, 26), "YYYY-MM-DD");
    expect(tasks).toHaveLength(10_000);
    expect(tasks[42].title).toBe("Call the vendor about item number 42 for the open house");
    expect(tasks[42].scheduledDate).toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
    // Control: the spy does see the parser's calls.
    parser.parseTaskLine("- [ ] Pay rent 2026-10-30", new Date(2026, 8, 26));
    expect(parse).toHaveBeenCalled();
    parse.mockRestore();
  });

  it("still reads plain dates in multi-word formats, with a trailing time", () => {
    const format = "dddd, MMMM Do YYYY";
    expect(parser.parseTaskLine("- [ ] Plan the open house Wednesday, September 30th 2026 14:30", new Date(2026, 8, 26), format))
      .toMatchObject({ title: "Plan the open house", scheduledDate: "2026-09-30", scheduledTime: "14:30" });
    const prose = parser.parseTaskLine("- [ ] Plan the open house next friday", new Date(2026, 8, 26), format);
    expect(prose?.title).toBe("Plan the open house next friday");
    expect(prose?.scheduledDate).toBeUndefined();
  });

  it("does not rescan the note while typing, or when a non-recurring box is checked", () => {
    const scan = vi.spyOn(parser, "scanTasks");
    const create = (recurring: boolean) => EditorState.create({ doc: proseNote(10_000), extensions: noteRecurringCompletion(() => "YYYY-MM-DD", () => recurring, vi.fn(), () => "Big.md") });
    const state = create(false);
    const line = state.doc.line(500);
    state.update({ changes: { from: line.to, insert: " more" } });
    state.update({ changes: { from: line.from + 3, to: line.from + 4, insert: "x" } });
    expect(scan).not.toHaveBeenCalled();
    // Only a recurring task needs the full note structure.
    create(true).update({ changes: { from: line.from + 3, to: line.from + 4, insert: "x" } });
    expect(scan).toHaveBeenCalled();
    scan.mockRestore();
  });

  it("looks tasks up by id without re-sorting, and refreshes after the note changes", async () => {
    const file = Object.assign(new TFile(), { path: "Big.md", extension: "md" });
    let content = proseNote(10_000);
    const app = {
      vault: { getMarkdownFiles: () => [file], getAbstractFileByPath: () => file, cachedRead: async () => content, on: () => ({}), offref: () => {} },
      metadataCache: { getFileCache: () => ({}), on: () => ({}) }
    } as unknown as App;
    const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
    await index.initialize();
    const sort = vi.spyOn(query, "sortTasks");
    for (let line = 0; line < 10_000; line++) expect(index.taskById(`Big.md:${line}`)?.line).toBe(line);
    expect(sort.mock.calls.length).toBeLessThanOrEqual(1);
    index.allTasks();
    expect(sort.mock.calls.length).toBeGreaterThanOrEqual(1);
    sort.mockRestore();
    content = "- [ ] Only task";
    await index.refreshPath("Big.md");
    expect(index.taskById("Big.md:42")).toBeUndefined();
    expect(index.allTasks().map(task => task.title)).toEqual(["Only task"]);
  });
});

describe("tag link caching", () => {
  it("resolves each tag once per source note, and again after the vault changes", async () => {
    const work = Object.assign(new TFile(), { path: "Tags/work.md", extension: "md" });
    const big = Object.assign(new TFile(), { path: "Big.md", extension: "md" });
    const content = Array.from({ length: 5000 }, (_, i) => `- [ ] Task ${i} #[[work]]`).join("\n");
    let created: (file: TFile) => void = () => {};
    let target: TFile | null = work;
    const resolve = vi.fn(() => target);
    const app = {
      vault: {
        getMarkdownFiles: () => [big], getAbstractFileByPath: () => big, cachedRead: async () => content, offref: () => {},
        on: (event: string, callback: (file: TFile) => void) => { if (event === "create") created = callback; return {}; }
      },
      metadataCache: { getFileCache: () => ({}), on: () => ({}), getFirstLinkpathDest: resolve }
    } as unknown as App;
    const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
    await index.initialize();
    expect(index.tagForPath(work.path)).toBe("work");
    expect(index.tagFile("work")).toBe(work);
    expect(index.query({ mode: "tags", tagPath: work.path, showCompleted: false })).toHaveLength(5000);
    expect(resolve).toHaveBeenCalledOnce();
    // A new note can change what a link resolves to, even if it is not Markdown.
    target = null;
    created(Object.assign(new TFile(), { path: "work.png", extension: "png" }));
    expect(index.tagForPath(work.path)).toBeUndefined();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe("body line classification", () => {
  it("marks frontmatter and fenced lines as the complement of bodyLines", async () => {
    const { bodyLines, nonBodyLines } = await import("../src/structure");
    const content = "---\ntags: [x]\n---\n- [ ] A\n```\n- [ ] Code\n```\n~~~~\n```\n~~~~\n- [ ] B";
    const body = bodyLines(content).map(line => line.line);
    const nonBody = [...nonBodyLines(content.split("\n"))];
    expect(body).toEqual([3, 10]);
    expect(nonBody.sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  });
});

describe("plain date pre-filter and parse cache", () => {
  const reference = new Date(2026, 8, 26);
  // Year-less formats resolve against the current year; pin it so these do not depend on today's date.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(reference); });
  afterEach(() => { vi.useRealTimers(); });
  it.each([
    ["MMM D, YYYY", "Oct 30, 2026"], ["DD.MM.YYYY", "30.10.2026"], ["dddd, MMMM Do YYYY", "Friday, October 30th 2026"],
    ["D MMMM", "30 October"], ["YYYY-MM-DD", "2026-10-30"]
  ])("reads plain %s dates, with and without a time", (format, label) => {
    expect(parser.parseTaskLine(`- [ ] Plan 3 things ${label}`, reference, format)).toMatchObject({ title: "Plan 3 things", scheduledDate: "2026-10-30" });
    expect(parser.parseTaskLine(`- [ ] Plan 3 things ${label} 09:15 p2`, reference, format)).toMatchObject({ title: "Plan 3 things", scheduledDate: "2026-10-30", scheduledTime: "09:15", priority: 2 });
    // ISO dates are always accepted alongside the configured format.
    expect(parser.parseTaskLine("- [ ] Plan 2026-10-30", reference, format)).toMatchObject({ scheduledDate: "2026-10-30" });
  });

  it("gives identical lines their own tag arrays and re-resolves relative dates on a new day", () => {
    const [first, second] = parser.scanTasks("A.md", "- [ ] Same #[[x]]\n- [ ] Same #[[x]]", reference);
    expect(first.tags).toEqual(["x"]);
    expect(first.tags).not.toBe(second.tags);
    const line = "- [ ] Relative {tomorrow}";
    expect(parser.scanTasks("A.md", line, reference)[0].deadline).toBe("2026-09-27");
    expect(parser.scanTasks("A.md", line, new Date(2026, 8, 27))[0].deadline).toBe("2026-09-28");
  });
});

describe("startup indexing", () => {
  it("scans in batches, skips unreadable notes, and notifies listeners when done", async () => {
    const files = Array.from({ length: 120 }, (_, i) => Object.assign(new TFile(), { path: `N${i}.md`, extension: "md" }));
    const app = {
      vault: {
        getMarkdownFiles: () => files, getAbstractFileByPath: () => undefined, on: () => ({}), offref: () => {},
        cachedRead: async (file: TFile) => { if (file.path === "N7.md") throw new Error("deleted"); return `- [ ] Task in ${file.path}`; }
      },
      metadataCache: { getFileCache: () => ({}), on: () => ({}) }
    } as unknown as App;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
    const listener = vi.fn();
    index.subscribe(listener);
    await index.initialize();
    expect(index.allTasks()).toHaveLength(119);
    expect(listener).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
