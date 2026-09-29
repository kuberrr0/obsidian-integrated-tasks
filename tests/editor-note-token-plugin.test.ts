import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
vi.mock("../src/note-highlights", async importOriginal => {
  const original = await importOriginal<typeof import("../src/note-highlights")>();
  return { ...original, noteLineHighlights: vi.fn(original.noteLineHighlights) };
});
import { noteLineHighlights } from "../src/note-highlights";
import { noteTokenEditor } from "../src/note-token-editor";

interface Plugin { marks: DecorationSet; lines: DecorationSet; update(update: unknown): void }

beforeEach(() => { vi.mocked(noteLineHighlights).mockClear(); });

function fakeView(doc: string, ranges?: (state: EditorState) => { from: number; to: number }[]) {
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
const markedLines = (plugin: Plugin, view: ReturnType<typeof fakeView>) => [...new Set(decorations(plugin.marks).map(range => view.state.doc.lineAt(range.from).number))];
const parsedLines = () => vi.mocked(noteLineHighlights).mock.calls.map(call => call[0]);

describe("noteTokenEditor view plugin", () => {
  it("parses and highlights only the visible ranges, colouring a priority's checkbox", () => {
    const doc = Array.from({ length: 200 }, (_, index) => `- [ ] Task ${index} 2026-09-${String(1 + index % 28).padStart(2, "0")} p2`).join("\n");
    const view = fakeView(doc, state => [{ from: state.doc.line(50).from, to: state.doc.line(52).to }]);
    const plugin = create(view);
    expect(parsedLines()).toEqual([50, 51, 52].map(number => view.state.doc.line(number).text));
    expect(markedLines(plugin, view)).toEqual([50, 51, 52]);
    expect(decorations(plugin.lines).map(range => view.state.doc.lineAt(range.from).number)).toEqual([50, 51, 52]);
  });

  it("highlights a line shared by two fold-split ranges once, and reuses parsed lines", () => {
    const doc = Array.from({ length: 10 }, (_, index) => `- [ ] Task ${index} 2026-09-2${index % 10}`).join("\n") + "\nend";
    const view = fakeView(doc, state => [
      { from: state.doc.line(3).from, to: state.doc.line(5).from + 4 },
      { from: state.doc.line(5).from + 8, to: state.doc.line(7).to }
    ]);
    const plugin = create(view);
    expect(decorations(plugin.marks)).toHaveLength(5);
    plugin.update(idle(view));
    expect(parsedLines()).toHaveLength(5);
  });

  it("skips frontmatter and fenced code lines", () => {
    const doc = "---\nnote: - [ ] Fake 2026-09-27\n---\n```\n- [ ] Example 2026-09-27\n```\n- [ ] Real 2026-09-27";
    const view = fakeView(doc);
    const plugin = create(view);
    expect(parsedLines()).not.toContain("- [ ] Example 2026-09-27");
    expect(markedLines(plugin, view)).toEqual([7]);
  });

  it("keeps highlighting the line the caret is on, since nothing is hidden", () => {
    const doc = "- [ ] Pay 2026-09-27";
    const view = fakeView(doc);
    const plugin = create(view);
    expect(decorations(plugin.marks).map(range => doc.slice(range.from, range.to))).toEqual(["2026-09-27"]);
  });
});
