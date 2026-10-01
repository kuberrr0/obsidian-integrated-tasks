import { describe, expect, it } from "vitest";
import { noteLineDecorations } from "../src/note-token-editor";
import { noteLineHighlights } from "../src/note-highlights";

const highlighted = (line: string, format = "YYYY-MM-DD") =>
  (noteLineHighlights(line, format)?.highlights ?? []).map(highlight => [line.slice(highlight.from, highlight.to), highlight.cls]);

describe("note highlights", () => {
  it("highlights each token but its tags as written, in the colour of what it sets, as a task card's title does", () => {
    expect(highlighted("- [ ] Pay rent [[2026-10-01]] 09:00 30m {2026-10-05} p1 every month #[[home]] ~[[Budget]]")).toEqual([
      ["[[2026-10-01]] 09:00", "tm-nlp-token is-date"],
      ["30m", "tm-nlp-token is-date"],
      ["{2026-10-05}", "tm-nlp-token is-deadline"],
      ["p1", "tm-nlp-token is-priority is-p1"],
      ["every month", "tm-nlp-token is-other"],
      ["~[[Budget]]", "tm-nlp-token is-project"]
    ]);
  });

  it("highlights a time written apart from its date as part of the schedule", () => {
    expect(highlighted("- [ ] do this [[2026-10-01]] every monday 21:30 5m p2")).toEqual([
      ["[[2026-10-01]]", "tm-nlp-token is-date"],
      ["every monday", "tm-nlp-token is-other"],
      ["21:30", "tm-nlp-token is-date"],
      ["5m", "tm-nlp-token is-date"],
      ["p2", "tm-nlp-token is-priority is-p2"]
    ]);
  });

  it("highlights a date still in words, which leaving the line converts, and the properties before it", () => {
    expect(highlighted("- [ ] Water p1 every week 30m tomorrow")).toEqual([
      ["p1", "tm-nlp-token is-priority is-p1"], ["every week", "tm-nlp-token is-other"], ["30m", "tm-nlp-token is-date"], ["tomorrow", "tm-nlp-token is-date"]
    ]);
    expect(highlighted("- [ ] do this tomorrow {sunday} 5m 9:30pm p2").map(([text]) => text)).toEqual(["tomorrow", "{sunday}", "5m", "9:30pm", "p2"]);
    // Not in the middle of the title, and not on a completed task, which leaving the line never changes.
    expect(highlighted("- [ ] Call mom tomorrow about dinner")).toEqual([]);
    expect(highlighted("- [x] Call mom tomorrow")).toEqual([]);
  });

  it("leaves tags unhighlighted, as Obsidian shows them", () => {
    expect(highlighted("- [ ] Call Sam p2 #[[home]] #[[calls]]")).toEqual([["p2", "tm-nlp-token is-priority is-p2"]]);
  });

  it("keeps the line's text, and reads dates in the note's format", () => {
    const line = "   - [x] Pay for AirBnb [[Sep 5, 2026]] {[[Sep 6, 2026]]}";
    expect(highlighted(line, "MMM D, YYYY").map(([text]) => text)).toEqual(["[[Sep 5, 2026]]", "{[[Sep 6, 2026]]}"]);
  });

  it("gives a task line's priority for its checkbox, and leaves prose and plain lists alone", () => {
    expect(noteLineHighlights("- [ ] Call Sam p2", "YYYY-MM-DD")?.priority).toBe(2);
    expect(noteLineHighlights("- [ ] Call Sam 2026-10-01", "YYYY-MM-DD")?.priority).toBeUndefined();
    expect(noteLineHighlights("- [ ] Call Sam", "YYYY-MM-DD")).toBeUndefined();
    expect(noteLineHighlights("Meet on 2026-10-01 p1", "YYYY-MM-DD")).toBeUndefined();
    expect(noteLineHighlights("- Buy 2026-10-01", "YYYY-MM-DD")).toBeUndefined();
  });

  it("highlights a recurring task's log entries as dates", () => {
    expect(highlighted("COMPLETED: [[2026-09-20]]")).toEqual([["COMPLETED: [[2026-09-20]]", "tm-nlp-token is-log-completed"]]);
    expect(highlighted("CANCELED: 2026-09-21")).toEqual([["CANCELED: 2026-09-21", "tm-nlp-token is-log-canceled"]]);
    // Entries older versions wrote still read, as cancelled ones.
    expect(highlighted("SKIPPED: 2026-09-13")).toEqual([["SKIPPED: 2026-09-13", "tm-nlp-token is-log-canceled"]]);
  });

  it("places marks on the line, and a priority class on its start", () => {
    const line = noteLineHighlights("- [ ] Call p1", "YYYY-MM-DD")!;
    const placed = noteLineDecorations(100, line);
    expect(placed.marks.map(mark => [mark.from, mark.to, mark.value.spec.class])).toEqual([[111, 113, "tm-nlp-token is-priority is-p1"]]);
    expect(placed.lines.map(mark => [mark.from, mark.value.spec.attributes])).toEqual([[100, { class: "tm-note-task-line", "data-tm-priority": "1" }]]);
    // Nothing replaces text: no widgets.
    expect(placed.marks.every(mark => !mark.value.spec.widget)).toBe(true);
  });
});
