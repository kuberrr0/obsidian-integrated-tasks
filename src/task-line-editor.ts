import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { taskInputRanges, tokenHighlightClass } from "./task-input";

/**
 * The task editor's text field: plain text, where what saving reads as a property (a date written in words,
 * `p1`, `#[[tag]]`, `~[[Project]]`…) is highlighted in that property's colour.
 */
export class TaskLineEditor {
  readonly view: EditorView;
  defaultValue: string;
  /** `value`: the task's title as it starts (empty for a new task); dates written in words count only where newly typed. */
  constructor(parent: HTMLElement, value: string, dateFormat: string, onChange: () => void, prompt = "") {
    this.defaultValue = value;
    const decorate = (view: EditorView): DecorationSet => {
      const firstLine = view.state.doc.line(1).text;
      const ranges: Range<Decoration>[] = taskInputRanges(firstLine, this.defaultValue.split("\n")[0], new Date(), dateFormat)
        .filter(range => range.to > range.from)
        .map(range => Decoration.mark({ class: tokenHighlightClass(range.kind, firstLine.slice(range.from, range.to)) }).range(range.from, range.to));
      return Decoration.set(ranges, true);
    };
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: value, extensions: [
        EditorView.lineWrapping,
        placeholder(prompt),
        history(),
        keymap.of([{ key: "Shift-Enter", run: view => { view.dispatch(view.state.replaceSelection("\n")); return true; } }, ...defaultKeymap.filter(binding => binding.key !== "Mod-Enter"), ...historyKeymap]),
        EditorView.contentAttributes.of({ "aria-label": "Task text", "aria-multiline": "true", role: "textbox" }),
        ViewPlugin.fromClass(class {
          decorations: DecorationSet;
          constructor(view: EditorView) { this.decorations = decorate(view); }
          update(update: import("@codemirror/view").ViewUpdate): void {
            if (update.docChanged) this.decorations = decorate(update.view);
          }
        }, { decorations: plugin => plugin.decorations }),
        EditorView.updateListener.of(update => { if (update.docChanged) onChange(); })
      ] })
    });
  }
  get value(): string { return this.view.state.doc.toString(); }
  set value(value: string) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } }); }
  get selectionStart(): number { return this.view.state.selection.main.from; }
  get selectionEnd(): number { return this.view.state.selection.main.to; }
  setSelectionRange(from: number, to: number): void { this.view.dispatch({ selection: { anchor: from, head: to } }); }
  focus(): void { this.view.focus(); }
  destroy(): void { this.view.destroy(); }
}
