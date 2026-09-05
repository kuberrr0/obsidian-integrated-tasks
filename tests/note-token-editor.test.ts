import { describe, expect, it } from "vitest";
import { RangeSet } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { noteTokenMarks } from "../src/note-token-editor";
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
