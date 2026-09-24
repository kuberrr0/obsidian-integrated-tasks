import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { noteTaskPresentation, renderNoteTaskDetails } from "./note-task-presentation";
import { taskTokens, type TaskToken } from "./task-tokens";

export interface InlineTaskToken { from: number; to: number; token?: TaskToken; label?: string; project?: string }

/** Source offsets stay stable even when adjacent metadata is rendered as widgets. */
export function inlineTaskTokens(text: string, dateFormat: string): InlineTaskToken[] {
  const result: InlineTaskToken[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const prefix = offset === 0 ? "- [ ] " : "";
    const source = prefix + line;
    const presentationSource = source.replace(/~\[\[[^\]\n]+\]\]/g, match => " ".repeat(match.length));
    const tokens = noteTaskPresentation(presentationSource, dateFormat)?.tokens ?? taskTokens(source, dateFormat);
    const local = tokens.map(token => ({ from: token.from - prefix.length, to: token.to - prefix.length, token }));
    for (const item of local) result.push({ ...item, from: offset + item.from, to: offset + item.to });
    for (const match of line.matchAll(/(?:~)?\[\[([^\]\n]+)\]\]/g)) {
      const from = match.index!;
      const to = from + match[0].length;
      if (local.some(token => from < token.to && to > token.from)) continue;
      const target = match[1];
      const project = match[0].startsWith("~") ? target : undefined;
      const label = project
        ? target.split("|")[0].split("#")[0].replace(/\.md$/i, "").split("/").pop()!
        : target.includes("|") ? target.slice(target.indexOf("|") + 1) : target.replace(/#/g, " › ");
      result.push({ from: offset + from, to: offset + to, label, ...(project ? { project } : {}) });
    }
    offset += line.length + 1;
  }
  return result.sort((a, b) => a.from - b.from);
}

/** Arrange existing suffix tokens for the task-mode layout without rewriting their values. */
export function taskModeEditorText(text: string, dateFormat: string): string {
  if (text.includes("\n")) return text;
  const tokens = inlineTaskTokens(text, dateFormat).filter(item => item.token || item.project);
  if (!tokens.length) return text;
  let end = tokens[0].from;
  for (const token of tokens) {
    if (text.slice(end, token.from).trim()) return text;
    end = token.to;
  }
  if (text.slice(end).trim()) return text;
  const order = (item: InlineTaskToken): number => item.token?.kind === "deadline" ? 0
    : item.token?.kind === "priority" ? 1 : item.token?.kind === "scheduledDate" ? 2
    : item.token?.kind === "durationMinutes" ? 3 : item.project ? 4 : 5;
  return [text.slice(0, tokens[0].from).trimEnd(), ...[...tokens].sort((a, b) => order(a) - order(b)).map(item => text.slice(item.from, item.to))].filter(Boolean).join(" ");
}

export function taskMetadataStart(tokens: InlineTaskToken[]): number | undefined {
  return tokens.find(item => item.project || (item.token && item.token.kind !== "deadline" && item.token.kind !== "priority"))?.from;
}

class MetadataLineBreak extends WidgetType {
  eq(): boolean { return true; }
  get lineBreaks(): number { return 1; }
  toDOM(view: EditorView): HTMLElement { return view.dom.ownerDocument.createElement("br"); }
  ignoreEvent(): boolean { return false; }
}

export function inactiveTaskTokens(tokens: InlineTaskToken[], selections: readonly { from: number; to: number }[]): InlineTaskToken[] {
  return tokens.filter(token => !selections.some(selection => selection.from <= token.to && selection.to >= token.from));
}

class InlineTokenWidget extends WidgetType {
  constructor(private readonly item: InlineTaskToken) { super(); }
  eq(other: InlineTokenWidget): boolean { return JSON.stringify(this.item) === JSON.stringify(other.item); }
  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createElement("span");
    const token = this.item.token;
    if (token && token.kind !== "priority") {
      // Each token is independent: editing a date never reveals tags or deadlines.
      renderNoteTaskDetails(root, { from: token.from, to: token.to, tokens: [{ ...token, label: token.label || "" }] }, (_token, label) => {
        const link = view.dom.ownerDocument.createElement("span");
        link.className = "internal-link";
        link.textContent = label;
        return link;
      });
      if (token.kind === "scheduledDate") {
        const schedule = root.querySelector(".tm-note-task-scheduledDate");
        if (schedule) {
          schedule.classList.remove("is-overdue");
          const date = view.dom.ownerDocument.createElement("span");
          date.className = token.overdue ? "tm-editor-schedule-date is-overdue" : "tm-editor-schedule-date";
          date.textContent = token.dateLabel ?? token.label;
          schedule.replaceChildren(date);
          if (token.time) schedule.appendChild(view.dom.ownerDocument.createTextNode(`, ${token.time}`));
        }
      }
    } else {
      root.className = token ? "tm-note-task-details" : this.item.project ? "tm-task-source tm-editor-project" : "internal-link";
      if (this.item.project) root.title = this.item.project;
      root.textContent = token?.label ?? this.item.label ?? "";
      if (token?.kind === "priority") {
        root.classList.add("tm-editor-priority", `is-p${token.priority}`);
        root.title = token.description;
      }
    }
    root.classList.add("tm-editor-token");
    root.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Reveal the clicked token in place, with its source selected for editing.
      view.dispatch({ selection: { anchor: this.item.from, head: this.item.to }, scrollIntoView: true });
      view.focus();
    });
    return root;
  }
  ignoreEvent(): boolean { return false; }
}

export class TaskLineEditor {
  readonly view: EditorView;
  private destroyed = false;
  defaultValue: string;
  constructor(parent: HTMLElement, value: string, dateFormat: string, onChange: () => void, prompt = "") {
    value = taskModeEditorText(value, dateFormat);
    this.defaultValue = value;
    const decorate = (view: EditorView): DecorationSet => {
      const tokens = inlineTaskTokens(view.state.doc.toString(), dateFormat);
      const ranges: Range<Decoration>[] = inactiveTaskTokens(tokens, view.hasFocus ? view.state.selection.ranges : [])
        .map(item => Decoration.replace({ widget: new InlineTokenWidget(item) }).range(item.from, item.to));
      const secondary = taskMetadataStart(tokens);
      if (secondary !== undefined) {
        ranges.push(Decoration.widget({ widget: new MetadataLineBreak(), side: -1 }).range(secondary));
        ranges.push(Decoration.mark({ class: "tm-editor-secondary" }).range(secondary, view.state.doc.length));
      }
      return Decoration.set(ranges, true);
    };
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: value, extensions: [
        EditorView.lineWrapping,
        placeholder(prompt),
        EditorView.domEventHandlers({ blur: () => {
          // Reorder only after editing, so typing never moves the caret.
          queueMicrotask(() => {
            if (this.destroyed || this.view.hasFocus) return;
            const ordered = taskModeEditorText(this.value, dateFormat);
            if (ordered !== this.value) this.value = ordered;
          });
        } }),
        history(),
        keymap.of([{ key: "Shift-Enter", run: view => { view.dispatch(view.state.replaceSelection("\n")); return true; } }, ...defaultKeymap.filter(binding => binding.key !== "Mod-Enter"), ...historyKeymap]),
        EditorView.contentAttributes.of({ "aria-label": "Task text", "aria-multiline": "true", role: "textbox" }),
        ViewPlugin.fromClass(class {
          decorations: DecorationSet;
          constructor(view: EditorView) { this.decorations = decorate(view); }
          update(update: import("@codemirror/view").ViewUpdate): void {
            if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = decorate(update.view);
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
  destroy(): void { this.destroyed = true; this.view.destroy(); }
}
