// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async original => ({ ...await original<typeof import("./obsidian-mock")>(), setIcon: vi.fn() }));
import { installObsidianDom } from "./helpers/obsidian-dom";
import { TaskLineEditor } from "../src/task-line-editor";
import { paintTokens } from "../src/things-task-card";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.innerHTML = ""; });

const marked = (root: HTMLElement) => Array.from(root.querySelectorAll(".tm-nlp-token")).map(mark => mark.textContent);

describe("highlighting what typed text sets", () => {
  it("shows the task editor's text as typed, highlighting what it sets in that property's colour", () => {
    const host = document.body.createDiv();
    const editor = new TaskLineEditor(host, "", "YYYY-MM-DD", vi.fn(), "", true);
    editor.value = "Call mom about dinner tomorrow at 3pm {2026-10-09} p1 #[[home]] ~[[Work]]";
    expect(host.querySelector(".cm-line")!.textContent).toBe(editor.value);
    const marks = Array.from(host.querySelectorAll(".tm-nlp-token")).map(mark => [mark.textContent, mark.className.replace("tm-nlp-token ", "")]);
    expect(marks).toEqual([["tomorrow at 3pm", "is-date"], ["{2026-10-09}", "is-deadline"], ["p1", "is-priority is-p1"], ["#[[home]]", "is-tag"], ["~[[Work]]", "is-project"]]);
    editor.destroy();
  });

  it("leaves an existing title's words alone when editing", () => {
    const host = document.body.createDiv();
    const editor = new TaskLineEditor(host, "Plan for tomorrow", "YYYY-MM-DD", vi.fn());
    expect(marked(host)).toEqual([]);
    editor.value = "Plan for tomorrow friday";
    expect(marked(host)).toEqual(["friday"]);
    editor.destroy();
  });

  it("paints a card title's highlight layer with the same text", () => {
    const layer = document.body.createDiv();
    paintTokens(layer, "Call mom p1 #[[home]]", [{ kind: "priority", from: 9, to: 11 }, { kind: "tags", from: 12, to: 21 }]);
    expect(layer.textContent).toBe("Call mom p1 #[[home]] ");
    expect(marked(layer)).toEqual(["p1", "#[[home]]"]);
    expect(layer.querySelector(".tm-nlp-token")!.className).toBe("tm-nlp-token is-priority is-p1");
  });
});
