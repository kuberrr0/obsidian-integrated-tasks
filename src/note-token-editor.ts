import { editorLivePreviewField } from "obsidian";
import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { nonBodyLines } from "./structure";
import { noteLineHighlights, type NoteLineHighlights } from "./note-highlights";

/** A line's highlights, placed in the document: its tokens, and its start for the priority colouring its checkbox. */
export function noteLineDecorations(lineFrom: number, line: NoteLineHighlights): { marks: Range<Decoration>[]; lines: Range<Decoration>[] } {
  return {
    marks: line.highlights.map(highlight => Decoration.mark({ class: highlight.cls }).range(lineFrom + highlight.from, lineFrom + highlight.to)),
    lines: line.priority ? [Decoration.line({ attributes: { class: "tm-note-task-line", "data-tm-priority": String(line.priority) } }).range(lineFrom)] : []
  };
}

/**
 * Live Preview: a task line's tokens are highlighted in place, as in a task card's title, and its checkbox takes its
 * priority's colour. Nothing is replaced or hidden, so the line reads as written.
 */
export function noteTokenEditor(getDateFormat: () => string): ViewPlugin<{ marks: DecorationSet; lines: DecorationSet }> {
  return ViewPlugin.fromClass(class {
    marks: DecorationSet = Decoration.none;
    lines: DecorationSet = Decoration.none;
    // Only visible lines are parsed; results are reused while the line text and date format are unchanged.
    private readonly cache = new Map<string, NoteLineHighlights | undefined>();
    /** Frontmatter and code lines; worked out when Live Preview next draws, not on every keystroke in Source mode. */
    private nonBody?: Set<number>;
    private format = getDateFormat();

    constructor(view: EditorView) {
      this.decorate(view);
    }

    update(update: ViewUpdate): void {
      const formatChanged = this.format !== getDateFormat();
      if (formatChanged) { this.format = getDateFormat(); this.cache.clear(); }
      if (update.docChanged) this.nonBody = undefined;
      if (update.docChanged || update.viewportChanged || formatChanged || update.transactions.length) this.decorate(update.view);
    }

    private highlights(text: string): NoteLineHighlights | undefined {
      if (this.cache.has(text)) return this.cache.get(text);
      if (this.cache.size > 5000) this.cache.clear();
      const found = noteLineHighlights(text, this.format);
      this.cache.set(text, found);
      return found;
    }

    private decorate(view: EditorView): void {
      if (!view.state.field(editorLivePreviewField, false)) {
        this.marks = this.lines = Decoration.none;
        return;
      }
      const marks: Range<Decoration>[] = [];
      const lines: Range<Decoration>[] = [];
      const doc = view.state.doc;
      const nonBody = this.nonBody ??= nonBodyLines(doc.iterLines());
      let done = 0;
      for (const range of view.visibleRanges) {
        // Ranges split by a fold may share a line; decorate it once.
        const last = doc.lineAt(range.to).number;
        for (let number = Math.max(doc.lineAt(range.from).number, done + 1); number <= last; number++) {
          done = number;
          if (nonBody.has(number - 1)) continue;
          const line = doc.line(number);
          const found = this.highlights(line.text);
          if (!found) continue;
          const placed = noteLineDecorations(line.from, found);
          marks.push(...placed.marks);
          lines.push(...placed.lines);
        }
      }
      this.marks = Decoration.set(marks, true);
      this.lines = Decoration.set(lines, true);
    }
  }, {
    decorations: plugin => plugin.lines,
    // The highlight wraps Obsidian's own link and syntax decorations, so a linked date is coloured whole.
    provide: plugin => EditorView.outerDecorations.of(view => view.plugin(plugin)?.marks ?? Decoration.none)
  });
}
