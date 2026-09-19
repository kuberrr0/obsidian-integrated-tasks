import { expect, it } from "vitest";
import { noteTaskPresentation } from "../src/note-task-presentation";
import { noteTaskDecorations, NoteTaskDetailsWidget } from "../src/note-token-editor";

const now = new Date(2026, 8, 19, 12);
it("presents compact schedules and deadlines without changing source ranges or link targets", () => {
    const source = "    - [ ] **Prepare** [[2026-09-20]] 21:00 30m {[[2026-09-23]] 17:00} p2 #[[Deep Work]]";
    const result = noteTaskPresentation(source, "YYYY-MM-DD", now)!;
    expect(source.slice(result.from, result.to)).toBe("[[2026-09-20]] 21:00 30m {[[2026-09-23]] 17:00} p2 #[[Deep Work]]");
    expect(result.priority).toBe(2);
    expect(result.tokens.find(token => token.kind === "scheduledDate")).toMatchObject({ label: "Tomorrow, 9:00 PM", linkText: "2026-09-20" });
    expect(result.tokens.find(token => token.kind === "deadline")).toMatchObject({ label: "4d, 5:00 PM", linkText: "2026-09-23", overdue: false });
});
it("uses red overdue labels only for open tasks", () => {
    for (const completed of [false, true]) {
        const result = noteTaskPresentation(`- [${completed ? "x" : " "}] Task 2026-09-10 {2026-09-19 11:00}`, "YYYY-MM-DD", now)!;
        expect(result.tokens.find(token => token.kind === "scheduledDate")).toMatchObject({ label: "9d ago", overdue: !completed });
        expect(result.tokens.find(token => token.kind === "deadline")?.overdue).toBe(!completed);
    }
});
it("leaves raw task metadata visible while the caret or selection touches its line", () => {
    const source = "- [ ] Task 2026-09-20 30m p1";
    const presentation = noteTaskPresentation(source, "YYYY-MM-DD", now)!;
    const task = { from: 100 + presentation.from, to: 100 + presentation.to, lineFrom: 100, lineTo: 100 + source.length, presentation };
    const rendered = noteTaskDecorations([task], []);
    expect(rendered).toHaveLength(2);
    expect(rendered[0].value.spec.attributes["data-tm-priority"]).toBe("1");
    expect(rendered[1].value.spec.widget).toBeInstanceOf(NoteTaskDetailsWidget);
    expect(rendered[1].from).toBe(task.from);
    for (const selection of [{ from: 105, to: 105 }, { from: 0, to: 200 }]) {
        expect(noteTaskDecorations([task], [selection])).toHaveLength(1);
    }
});
it("never replaces task destinations or non-checklist prose", () => {
    expect(noteTaskPresentation("Text 2026-09-20", "YYYY-MM-DD", now)).toBeUndefined();
    expect(noteTaskPresentation("- [ ] Task 2026-09-20 ~[[Elsewhere]] p1", "YYYY-MM-DD", now)).toBeUndefined();
    expect(noteTaskPresentation("- [ ] Task without properties", "YYYY-MM-DD", now)).toBeUndefined();
});
