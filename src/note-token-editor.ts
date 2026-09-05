import { editorLivePreviewField } from "obsidian";
import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { bodyLines } from "./structure";
import { taskTokens, tokenClass, type TaskToken } from "./task-tokens";

export interface NoteTokenSpan { from: number; to: number; token: TaskToken }

/** Marks retain the actual link text, so Obsidian alone owns link rendering/editing. */
export function noteTokenMarks(
  tokens: NoteTokenSpan[],
  viewport: { from: number; to: number },
  selections: readonly { from: number; to: number }[]
): { pills: DecorationSet; syntax: DecorationSet } {
  const pills: Range<Decoration>[] = [];
  const syntax: Range<Decoration>[] = [];
  for (const { from, to, token } of tokens) {
    if (from >= viewport.to || to <= viewport.from) continue;
    if (selections.some((range) => range.from <= to && range.to >= from)) continue;
    pills.push(Decoration.mark({
      class: `${tokenClass(token)} tm-note-token-editor`,
      attributes: { title: token.description }
    }).range(from, to));
    if (token.kind === "deadline") {
      // Only hide the outer braces. Native Live Preview handles the wiki-link
      // brackets inside them; never replace or conceal the date/link text.
      syntax.push(Decoration.mark({ class: "tm-note-token-brace" }).range(from, from + 1));
      syntax.push(Decoration.mark({ class: "tm-note-token-brace" }).range(to - 1, to));
    }
  }
  return { pills: Decoration.set(pills, true), syntax: Decoration.set(syntax, true) };
}

export function noteTokenEditor(getDateFormat: () => string): ViewPlugin<{ pills: DecorationSet; syntax: DecorationSet }> {
  return ViewPlugin.fromClass(class {
    pills: DecorationSet = Decoration.none;
    syntax: DecorationSet = Decoration.none;
    private tokens: NoteTokenSpan[] = [];
    private format = "";

    constructor(view: EditorView) { this.rebuildTokens(view); this.decorate(view); }

    update(update: ViewUpdate): void {
      const formatChanged = this.format !== getDateFormat();
      if (update.docChanged || formatChanged) this.rebuildTokens(update.view);
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || formatChanged || update.transactions.length) this.decorate(update.view);
    }

    private rebuildTokens(view: EditorView): void {
      this.format = getDateFormat();
      this.tokens = [];
      for (const { text, line } of bodyLines(view.state.doc.toString())) {
        if (!/^\s*-\s+\[[ xX]\]/.test(text)) continue;
        const offset = view.state.doc.line(line + 1).from;
        for (const token of taskTokens(text, this.format)) this.tokens.push({ from: offset + token.from, to: offset + token.to, token });
      }
    }

    private decorate(view: EditorView): void {
      if (!view.state.field(editorLivePreviewField, false)) {
        this.pills = this.syntax = Decoration.none;
        return;
      }
      const marks = noteTokenMarks(this.tokens, view.viewport, view.state.selection.ranges);
      this.pills = marks.pills;
      this.syntax = marks.syntax;
    }
  }, {
    decorations: (plugin) => plugin.syntax,
    // Keep one pill wrapper outside Obsidian's link and syntax decorations.
    provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.pills ?? Decoration.none)
  });
}
