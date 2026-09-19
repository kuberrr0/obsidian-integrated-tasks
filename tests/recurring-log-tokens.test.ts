import { expect, it } from "vitest";
import { recurringLogTokens, tokenClass } from "../src/task-tokens";
import { noteTokenMarks } from "../src/note-token-editor";

it.each(["COMPLETED", "SKIPPED", "FAILED"])("renders %s with the shared pill styling and formatted date", outcome => {
    const line = `  ${outcome}: 2026-09-19  `;
    const tokens = recurringLogTokens(line, "MMM D, YYYY");
    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    expect(line.slice(token.from, token.to)).toBe(`${outcome}: 2026-09-19`);
    expect(token.label).toBe(`${outcome}: Sep 19, 2026`);
    expect(tokenClass(token)).toBe(`tm-note-token tm-note-token-${outcome.toLowerCase()}`);
    const spans = [{ from: token.from, to: token.to, token }];
    const visible = noteTokenMarks(spans, { from: 0, to: line.length }, []);
    expect(visible.pills.size).toBe(1);
    expect(visible.syntax.size).toBe(1);
    const editing = noteTokenMarks(spans, { from: 0, to: line.length }, [{ from: 5, to: 5 }]);
    expect(editing.pills.size).toBe(0);
    expect(editing.syntax.size).toBe(0);
});

it.each([
    "COMPLETED: 2026-02-30", "FAILED: tomorrow", "Status COMPLETED: 2026-09-19",
    "`SKIPPED: 2026-09-19`", "- [ ] COMPLETED: 2026-09-19", "COMPLETED: 2026-09-19 extra"
])("leaves non-log text unchanged: %s", line => {
    expect(recurringLogTokens(line)).toEqual([]);
});
