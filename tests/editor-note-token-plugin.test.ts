import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
vi.mock("../src/note-task-presentation", async importOriginal => {
  const original = await importOriginal<typeof import("../src/note-task-presentation")>();
  return { ...original, noteTaskPresentation: vi.fn(original.noteTaskPresentation) };
});
import { noteTaskPresentation, type NoteTaskPresentation } from "../src/note-task-presentation";
import { noteTokenEditor } from "../src/note-token-editor";

interface Plugin { syntax: DecorationSet; pills: DecorationSet; update(update: unknown): void }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12, 29));
  vi.mocked(noteTaskPresentation).mockClear();
});
afterEach(() => vi.useRealTimers());

function fakeView(doc: string, ranges?: (state: EditorState) => { from: number; to: number }[]) {
  // The caret rests on the last line, which each test keeps free of tasks.
  const state = EditorState.create({ doc, selection: { anchor: doc.length } });
  const visibleRanges = ranges?.(state) ?? [{ from: 0, to: state.doc.length }];
  return {
    state: { doc: state.doc, selection: state.selection, field: () => true },
    visibleRanges,
    viewport: { from: visibleRanges[0].from, to: visibleRanges[visibleRanges.length - 1].to },
    dom: {}
  };
}
function create(view: ReturnType<typeof fakeView>): Plugin {
  const plugin = noteTokenEditor(() => "YYYY-MM-DD") as unknown as { create(view: unknown): Plugin };
  return plugin.create(view);
}
const idle = (view: ReturnType<typeof fakeView>) => ({ view, state: view.state, docChanged: false, viewportChanged: false, selectionSet: false, focusChanged: false, transactions: [] });
function decorations(set: DecorationSet) {
  const result: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) result.push({ from: cursor.from, to: cursor.to, spec: cursor.value.spec });
  return result;
}
const lineDecorations = (plugin: Plugin) => decorations(plugin.syntax).filter(range => (range.spec.attributes as Record<string, string> | undefined)?.class === "tm-note-task-line");
function presentations(plugin: Plugin): NoteTaskPresentation[] {
  return decorations(plugin.syntax).flatMap(range => {
    const widget = range.spec.widget as { presentation?: NoteTaskPresentation } | undefined;
    return widget?.presentation ? [widget.presentation] : [];
  });
}
const parsedLines = () => vi.mocked(noteTaskPresentation).mock.calls.map(call => call[0]);

describe("noteTokenEditor view plugin", () => {
  it("parses and decorates only the visible ranges", () => {
    const doc = Array.from({ length: 200 }, (_, index) => `- [ ] Task ${index} 2026-09-${String(1 + index % 28).padStart(2, "0")} p2`).join("\n");
    const view = fakeView(doc, state => [{ from: state.doc.line(50).from, to: state.doc.line(52).to }]);
    const plugin = create(view);
    expect(parsedLines()).toEqual([50, 51, 52].map(number => view.state.doc.line(number).text));
    const lines = lineDecorations(plugin).map(range => view.state.doc.lineAt(range.from).number);
    expect(lines).toEqual([50, 51, 52]);
  });

  it("decorates a line shared by two fold-split ranges once", () => {
    const doc = Array.from({ length: 10 }, (_, index) => `- [ ] Task ${index} 2026-09-2${index % 10}`).join("\n") + "\nend";
    const view = fakeView(doc, state => [
      { from: state.doc.line(3).from, to: state.doc.line(5).from + 4 },
      { from: state.doc.line(5).from + 8, to: state.doc.line(7).to }
    ]);
    const plugin = create(view);
    expect(lineDecorations(plugin).map(range => view.state.doc.lineAt(range.from).number)).toEqual([3, 4, 5, 6, 7]);
    expect(presentations(plugin)).toHaveLength(5);
  });

  it("skips frontmatter and fenced code lines", () => {
    const doc = "---\nnote: - [ ] Fake 2026-09-27\n---\n```\n- [ ] Example 2026-09-27\n```\n- [ ] Real 2026-09-27";
    const view = fakeView(doc);
    const plugin = create(view);
    expect(parsedLines()).not.toContain("- [ ] Example 2026-09-27");
    expect(lineDecorations(plugin).map(range => view.state.doc.lineAt(range.from).number)).toEqual([7]);
  });

  it("drops cached date labels when the day changes", () => {
    const view = fakeView("- [ ] Pay 2026-09-27\n- [ ] Call 2026-09-25\nend");
    const plugin = create(view);
    expect(presentations(plugin).map(presentation => presentation.tokens[0].dateLabel)).toEqual(["Tomorrow", "1d ago"]);
    plugin.update(idle(view));
    expect(parsedLines()).toHaveLength(3);
    vi.setSystemTime(new Date(2026, 8, 27, 0, 1));
    plugin.update(idle(view));
    expect(presentations(plugin).map(presentation => presentation.tokens[0].dateLabel)).toEqual(["Today", "2d ago"]);
  });

  it("re-derives deadline-time overdue flags on a new minute, reusing untimed lines", () => {
    const view = fakeView("- [ ] Report {2026-09-26 12:30}\n- [ ] Pay 2026-09-27\nend");
    const plugin = create(view);
    expect(presentations(plugin)[0].tokens[0].overdue).toBe(false);
    vi.mocked(noteTaskPresentation).mockClear();
    vi.setSystemTime(new Date(2026, 8, 26, 12, 31));
    plugin.update({ ...idle(view), transactions: [{}] });
    expect(presentations(plugin)[0].tokens[0].overdue).toBe(true);
    expect(parsedLines()).toEqual(["- [ ] Report {2026-09-26 12:30}"]);
  });
});
