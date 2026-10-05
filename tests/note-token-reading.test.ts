// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";
import { renderNoteTokens } from "../src/note-token-reading";

beforeAll(() => installObsidianDom());

function item(html: string, status = " "): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `<ul><li class="task-list-item" data-task="${status}"><input type="checkbox" class="task-list-item-checkbox">${html}</li></ul>`;
  renderNoteTokens(root, "YYYY-MM-DD");
  return root.querySelector("li")!;
}
const tokens = (li: HTMLElement) => Array.from(li.querySelectorAll(".tm-nlp-token")).map(token => [token.textContent, token.className]);

describe("Reading view highlights", () => {
  it("highlights each token in place, keeping the text and Obsidian's links", () => {
    const li = item(`Pay rent <a class="internal-link" data-href="2026-10-01" href="2026-10-01">2026-10-01</a> {2026-10-05} p1 #[[home]]`);
    expect(li.textContent).toBe("Pay rent 2026-10-01 {2026-10-05} p1 #[[home]]");
    expect(tokens(li)).toEqual([
      ["2026-10-01", "tm-nlp-token is-date"],
      ["{2026-10-05}", "tm-nlp-token is-deadline"],
      ["p1", "tm-nlp-token is-priority is-p1"]
    ]);
    // The link is still Obsidian's own, inside the highlight.
    expect(li.querySelector(".tm-nlp-token.is-date > a.internal-link")).not.toBeNull();
    expect(li.classList.contains("tm-note-task-item")).toBe(true);
    expect(li.getAttribute("data-tm-priority")).toBe("1");
  });

  it("leaves a task without tokens as it is, and highlights only once", () => {
    const plain = item("Call Sam");
    expect(plain.querySelector(".tm-nlp-token")).toBeNull();
    const root = item("Water every week").parentElement!.parentElement!;
    renderNoteTokens(root, "YYYY-MM-DD");
    expect(root.querySelectorAll(".tm-nlp-token")).toHaveLength(1);
  });

  it("highlights a recurring task's log entries: completed green, cancelled red", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>COMPLETED: 2026-09-20<br>CANCELED: 2026-09-13<br>SKIPPED: 2026-09-06</p>";
    renderNoteTokens(root, "YYYY-MM-DD");
    expect(Array.from(root.querySelectorAll(".tm-nlp-token")).map(token => [token.textContent, token.className])).toEqual([
      ["COMPLETED: 2026-09-20", "tm-nlp-token is-log-completed"], ["CANCELED: 2026-09-13", "tm-nlp-token is-log-canceled"]
    ]);
  });
});
