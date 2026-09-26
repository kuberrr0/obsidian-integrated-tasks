import { noteTaskPresentation, renderNoteTaskDetails, type NoteTaskPresentation } from "./note-task-presentation";
import { notePropertyIconStyle } from "./task-property-icons";
import { editorLivePreviewField, editorInfoField, Platform } from "obsidian";
import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import { nonBodyLines } from "./structure";
import { taskTokens, recurringLogTokens, tokenClass, type TaskToken } from "./task-tokens";

export interface NoteTokenSpan { from: number; to: number; token: TaskToken }

/** Display-only date label; opening a link still uses its original note target. */
export class DateLabelWidget extends WidgetType {
  constructor(private readonly label: string, private readonly linkText?: string) { super(); }
  eq(other: DateLabelWidget): boolean { return this.label === other.label && this.linkText === other.linkText; }
  toDOM(view: EditorView): HTMLElement {
    const element: HTMLElement = view.dom.ownerDocument.createDocumentFragment().createEl(this.linkText ? "a" : "span");
    element.textContent = this.label;
    if (this.linkText) {
      element.className = "internal-link";
      element.setAttribute("data-href", this.linkText);
      element.setAttribute("href", this.linkText);
      const open = (event: MouseEvent): void => {
        if (event.button !== 0 && event.button !== 1) return;
        const info = view.state.field(editorInfoField, false);
        if (!info) return;
        event.preventDefault();
        event.stopPropagation();
        void info.app.workspace.openLinkText(this.linkText!, info.file?.path ?? "", event.button === 1 || (Platform.isMacOS ? event.metaKey : event.ctrlKey));
      };
      element.addEventListener("click", open);
      element.addEventListener("auxclick", open);
    }
    return element;
  }
}

export class NoteTaskDetailsWidget extends WidgetType {
  constructor(private readonly presentation: NoteTaskPresentation, private readonly from: number) { super(); }
  eq(other: NoteTaskDetailsWidget): boolean { return this.from === other.from && JSON.stringify(this.presentation) === JSON.stringify(other.presentation); }
  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createDocumentFragment().createSpan();
    renderNoteTaskDetails(root, this.presentation, (token, label) => new DateLabelWidget(label, token.linkText).toDOM(view));
    root.addEventListener("click", event => {
      if ((event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      const property = (event.target as HTMLElement).closest<HTMLElement>("[data-tm-property-offset]");
      const offset = Number(property?.getAttribute("data-tm-property-offset") ?? 0);
      view.dispatch({ selection: { anchor: this.from + offset }, scrollIntoView: true });
      view.focus();
    });
    return root;
  }
}

export interface NoteTaskSpan { from: number; to: number; lineFrom: number; lineTo: number; presentation: NoteTaskPresentation }

export function noteTaskDecorations(tasks: NoteTaskSpan[], selections: readonly { from: number; to: number }[]): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  for (const task of tasks) {
    decorations.push(Decoration.line({ attributes: { class: "tm-note-task-line", "data-tm-priority": String(task.presentation.priority ?? "") } }).range(task.lineFrom));
    if (selections.some(selection => selection.from <= task.lineTo && selection.to >= task.lineFrom)) continue;
    decorations.push(Decoration.replace({ widget: new NoteTaskDetailsWidget(task.presentation, task.from) }).range(task.from, task.to));
  }
  return decorations;
}

/** Retain native text when already formatted; reveal source text while editing. */
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
      attributes: { title: token.description, style: notePropertyIconStyle(token.kind) }
    }).range(from, to));
    if (token.display) {
      syntax.push(Decoration.replace({ widget: new DateLabelWidget(token.display.label, token.display.linkText) })
        .range(from + token.display.from - token.from, from + token.display.to - token.from));
    }
    if (token.kind === "tags") {
      syntax.push(Decoration.mark({ class: "tm-note-token-tag-prefix" }).range(from, from + 1));
    }
    if (token.kind === "deadline") {
      // Keep the deadline prefix outside the date label.
      syntax.push(Decoration.mark({ class: "tm-note-token-brace" }).range(from, from + 1));
      syntax.push(Decoration.mark({ class: "tm-note-token-brace" }).range(to - 1, to));
    }
  }
  return { pills: Decoration.set(pills, true), syntax: Decoration.set(syntax, true) };
}

interface NoteLineTokens { presentation: NoteTaskPresentation | undefined; tokens: TaskToken[] }

export function noteTokenEditor(getDateFormat: () => string): ViewPlugin<{ pills: DecorationSet; syntax: DecorationSet }> {
  return ViewPlugin.fromClass(class {
    pills: DecorationSet = Decoration.none;
    syntax: DecorationSet = Decoration.none;
    // Only visible lines are parsed; results are reused while the line text and date format are unchanged.
    private readonly lines = new Map<string, NoteLineTokens>();
    private nonBody: Set<number>;
    private format = getDateFormat();

    constructor(view: EditorView) {
      this.nonBody = nonBodyLines(view.state.doc.iterLines());
      this.decorate(view);
    }

    update(update: ViewUpdate): void {
      const formatChanged = this.format !== getDateFormat();
      if (formatChanged) { this.format = getDateFormat(); this.lines.clear(); }
      if (update.docChanged) this.nonBody = nonBodyLines(update.state.doc.iterLines());
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || formatChanged || update.transactions.length) this.decorate(update.view);
    }

    private lineTokens(text: string): NoteLineTokens {
      let entry = this.lines.get(text);
      if (!entry) {
        if (this.lines.size > 5000) this.lines.clear();
        const presentation = noteTaskPresentation(text, this.format);
        entry = { presentation, tokens: [...(presentation ? [] : taskTokens(text, this.format)), ...recurringLogTokens(text, this.format)] };
        this.lines.set(text, entry);
      }
      return entry;
    }

    private decorate(view: EditorView): void {
      if (!view.state.field(editorLivePreviewField, false)) {
        this.pills = this.syntax = Decoration.none;
        return;
      }
      const tokens: NoteTokenSpan[] = [];
      const tasks: NoteTaskSpan[] = [];
      const doc = view.state.doc;
      let done = 0;
      for (const range of view.visibleRanges) {
        // Ranges split by a fold may share a line; decorate it once.
        const last = doc.lineAt(range.to).number;
        for (let number = Math.max(doc.lineAt(range.from).number, done + 1); number <= last; number++) {
          done = number;
          if (this.nonBody.has(number - 1)) continue;
          const line = doc.line(number);
          const { presentation, tokens: lineTokens } = this.lineTokens(line.text);
          if (presentation) tasks.push({ from: line.from + presentation.from, to: line.from + presentation.to, lineFrom: line.from, lineTo: line.to, presentation });
          for (const token of lineTokens) tokens.push({ from: line.from + token.from, to: line.from + token.to, token });
        }
      }
      const marks = noteTokenMarks(tokens, view.viewport, view.state.selection.ranges);
      this.pills = marks.pills;
      this.syntax = marks.syntax.update({ add: noteTaskDecorations(tasks, view.state.selection.ranges), sort: true });
    }
  }, {
    decorations: (plugin) => plugin.syntax,
    // Keep one pill wrapper outside Obsidian's link and syntax decorations.
    provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.pills ?? Decoration.none)
  });
}
