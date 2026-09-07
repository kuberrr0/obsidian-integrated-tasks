import { describe, expect, it, vi } from "vitest";
import { RangeSet } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { DateLabelWidget, noteTokenMarks } from "../src/note-token-editor";
import { taskTokens } from "../src/task-tokens";

const scheduledTask = "   - [ ] Pay for AirBnb [[Sep 5, 2026]]";
const deadline = " {[[Sep 6, 2026]]}";
const format = "MMM D, YYYY";

function marks(line: string, caret = line.length) {
  return noteTokenMarks(taskTokens(line, format).map((token) => ({ from: token.from, to: token.to, token })),
    { from: 0, to: line.length }, [{ from: caret, to: caret }]);
}
function ranges(set: DecorationSet) {
  const result: Array<{ from: number; to: number; spec: Record<string, unknown> }> = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) result.push({ from: cursor.from, to: cursor.to, spec: cursor.value.spec });
  return result;
}

describe("native-text note pills", () => {
  it("never replaces scheduled-date text while a deadline is typed character by character", () => {
    for (let length = 0; length <= deadline.length; length++) {
      const text = scheduledTask + deadline.slice(0, length);
      const decorations = marks(text);
      const points: number[] = [];
      RangeSet.spans([decorations.pills, decorations.syntax], 0, text.length, {
        span: () => {}, point: (from) => { points.push(from); }
      });
      expect(points, `at input ${JSON.stringify(text)}`).toEqual([]);
      for (const range of ranges(decorations.syntax)) expect(text.slice(range.from, range.to)).toMatch(/^[{}]$/);
    }
  });

  it("keeps the scheduled pill after the complete deadline is entered at the caret", () => {
    const text = scheduledTask + deadline;
    const decorations = ranges(marks(text).pills);
    expect(decorations).toHaveLength(1);
    expect(text.slice(decorations[0].from, decorations[0].to)).toBe("[[Sep 5, 2026]]");
  });

  it("restores both pills when the caret moves away and exposes syntax on selection", () => {
    const text = scheduledTask + deadline;
    expect(ranges(marks(text, 0).pills)).toHaveLength(2);
    const tokens = taskTokens(text, format);
    const selected = noteTokenMarks(tokens.map((token) => ({ ...token, token })), { from: 0, to: text.length },
      [{ from: tokens[0].from, to: tokens[0].to }]);
    expect(ranges(selected.pills)).toHaveLength(1);
    expect(ranges(selected.pills)[0].from).toBe(tokens[1].from);
  });

  it("retains date content when native Live Preview hides only wiki-link delimiters", () => {
    const text = scheduledTask + deadline;
    const nativeBrackets = Array.from(text.matchAll(/\[\[|\]\]/g), (match) =>
      Decoration.mark({ class: "native-hidden-bracket" }).range(match.index!, match.index! + 2));
    const decorations = marks(text, 0);
    let visible = "";
    RangeSet.spans([Decoration.set(nativeBrackets, true), decorations.syntax, decorations.pills], 0, text.length, {
      span: (from, to, active) => {
        if (!active.some((mark) => /native-hidden-bracket|tm-note-token-brace/.test(mark.spec.class ?? ""))) visible += text.slice(from, to);
      }, point: () => {}
    });
    expect(visible).toContain("Sep 5, 2026");
    expect(visible).toContain("Sep 6, 2026");
  });
});


it("replaces only mismatched date labels and restores original syntax on selection", () => {
  const text = "- [ ] Call [[2026-09-09]] 9pm {[[2026-09-10]]}";
  const tokens = taskTokens(text, "MMM D, YYYY");
  const spans = tokens.map(token => ({ from: token.from + 100, to: token.to + 100, token }));
  const formatted = noteTokenMarks(spans, { from: 100, to: 100 + text.length }, []);
  const replacements = ranges(formatted.syntax).filter(range => range.spec.widget);
  expect(replacements.map(range => text.slice(range.from - 100, range.to - 100))).toEqual(["[[2026-09-09]]", "[[2026-09-10]]"]);
  const editing = noteTokenMarks(spans, { from: 100, to: 100 + text.length }, [{ from: spans[0].from + 3, to: spans[0].from + 3 }]);
  expect(ranges(editing.syntax).filter(range => range.spec.widget)).toHaveLength(1);
});

it("opens the original linked note from a formatted label, including Cmd-click", () => {
  const openLinkText = vi.fn();
  const events = new Map<string, (event: unknown) => void>();
  const attrs = new Map<string, string>();
  const element = { textContent: "", setAttribute: (key: string, value: string) => attrs.set(key, value), addEventListener: (name: string, callback: (event: unknown) => void) => events.set(name, callback) };
  const view = { dom: { ownerDocument: { createElement: () => element } }, state: { field: () => ({ app: { workspace: { openLinkText } }, file: { path: "Projects/Work.md" } }) } };
  new DateLabelWidget("Sep 9, 2026", "2026-09-09").toDOM(view as never);
  expect(element.textContent).toBe("Sep 9, 2026");
  expect(attrs.get("data-href")).toBe("2026-09-09");
  for (const metaKey of [false, true]) {
    const event = { button: 0, metaKey, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    events.get("click")!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openLinkText).toHaveBeenLastCalledWith("2026-09-09", "Projects/Work.md", metaKey);
  }
});
