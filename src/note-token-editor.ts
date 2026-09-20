import { noteTaskPresentation, renderNoteTaskDetails, type NoteTaskPresentation } from "./note-task-presentation";
import { notePropertyIconStyle } from "./task-property-icons";
import { editorLivePreviewField, editorInfoField, Platform } from "obsidian";
import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import { bodyLines } from "./structure";
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
  get lineBreaks(): number { return this.presentation.tokens.some(token => token.kind === "scheduledDate" || token.kind === "tags") ? 1 : 0; }
  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createDocumentFragment().createSpan();
    renderNoteTaskDetails(root, this.presentation, (token, label) => new DateLabelWidget(label, token.linkText).toDOM(view));
    root.addEventListener("click", event => {
      if ((event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
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

export function noteTokenEditor(getDateFormat: () => string): ViewPlugin<{ pills: DecorationSet; syntax: DecorationSet }> {
  return ViewPlugin.fromClass(class {
    pills: DecorationSet = Decoration.none;
    syntax: DecorationSet = Decoration.none;
    private tokens: NoteTokenSpan[] = [];
    private tasks: NoteTaskSpan[] = [];
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
      this.tasks = [];
      for (const { text, line } of bodyLines(view.state.doc.toString())) {
        const offset = view.state.doc.line(line + 1).from;
        const presentation = noteTaskPresentation(text, this.format);
        if (presentation) this.tasks.push({ from: offset + presentation.from, to: offset + presentation.to, lineFrom: offset, lineTo: offset + text.length, presentation });
        for (const token of [...(presentation ? [] : taskTokens(text, this.format)), ...recurringLogTokens(text, this.format)]) this.tokens.push({ from: offset + token.from, to: offset + token.to, token });
      }
    }

    private decorate(view: EditorView): void {
      if (!view.state.field(editorLivePreviewField, false)) {
        this.pills = this.syntax = Decoration.none;
        return;
      }
      const marks = noteTokenMarks(this.tokens, view.viewport, view.state.selection.ranges);
      this.pills = marks.pills;
      this.syntax = marks.syntax.update({ add: noteTaskDecorations(this.tasks, view.state.selection.ranges), sort: true });
    }
  }, {
    decorations: (plugin) => plugin.syntax,
    // Keep one pill wrapper outside Obsidian's link and syntax decorations.
    provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.pills ?? Decoration.none)
  });
}
