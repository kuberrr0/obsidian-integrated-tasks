import { logHighlights, noteLineHighlights, type NoteHighlight } from "./note-highlights";

interface Segment { node: Node; from: number; to: number; atomic: boolean }

/**
 * Wraps each highlighted range of the rendered text in a span with its class, keeping what is inside (Obsidian's
 * links included). `segments` map the rendered nodes to the source; a range that no segment covers is left alone.
 */
function wrapHighlights(document: Document, segments: Segment[], highlights: NoteHighlight[]): void {
  for (const highlight of [...highlights].reverse()) {
    const first = segments.find(segment => segment.from <= highlight.from && segment.to > highlight.from);
    const last = segments.find(segment => segment.from < highlight.to && segment.to >= highlight.to);
    if (!first || !last) continue;
    const range = document.createRange();
    if (first.atomic) range.setStartBefore(first.node); else range.setStart(first.node, highlight.from - first.from);
    if (last.atomic) range.setEndAfter(last.node); else range.setEnd(last.node, highlight.to - last.from);
    const span = createSpan({ cls: highlight.cls });
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
}

/** Reading view: a task's tokens are highlighted in place, as in a task card's title; its checkbox takes its priority's colour. */
export function renderNoteTokens(root: HTMLElement, dateFormat?: string): void {
  renderRecurringLogTokens(root, dateFormat);
  const items = Array.from(root.querySelectorAll<HTMLElement>("li.task-list-item"));
  if (root.matches("li.task-list-item")) items.unshift(root);
  for (const item of items) {
    const content = Array.from(item.children).find(child => child.tagName === "P") ?? item;
    if (Array.from(content.querySelectorAll(".tm-nlp-token")).some(token => token.closest("li") === item)) continue;
    const status = item.getAttribute("data-task") ?? "";
    // The rendered item, read back as the task line it came from.
    let source = /^[ xX/?-]$/.test(status) ? `- [${status}] ` : item.classList.contains("is-checked") ? "- [x] " : "- [ ] ";
    const segments: Segment[] = [];
    const walk = (node: Node): void => {
      const element = node.nodeType === 1 ? node as HTMLElement : undefined;
      if (element?.matches("ul, ol, input, button")) return;
      if (node.nodeType === 3) {
        const text = node.textContent ?? "";
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: false });
        source += text;
      } else if (element?.matches("a.internal-link")) {
        const text = `[[${element.getAttribute("data-href") ?? element.getAttribute("href") ?? element.textContent}]]`;
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: true });
        source += text;
      } else if (element?.matches("a.tag")) {
        // A `#tag` reads as itself, as the source has it, so the tokens before it are still found.
        const text = element.textContent ?? "";
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: true });
        source += text;
      } else if (element?.matches("code, strong, em, del, s, mark, a, .internal-embed")) {
        // Protect formatted prose, literal code, external links and embeds from metadata parsing.
        source += `\`${element.textContent}\``;
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(content.childNodes)) walk(child);
    const found = noteLineHighlights(source, dateFormat);
    if (!found) continue;
    if (found.priority) {
      item.classList.add("tm-note-task-item");
      item.setAttribute("data-tm-priority", String(found.priority));
    }
    wrapHighlights(item.ownerDocument, segments, found.highlights);
  }
}

/** A recurring task's log entries: plain text lines, which Markdown may combine in one paragraph. */
export function renderRecurringLogTokens(root: HTMLElement, dateFormat?: string): void {
  const document = root.ownerDocument;
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p"));
  if (root.matches("p")) paragraphs.unshift(root);
  for (const paragraph of paragraphs) {
    if (paragraph.closest("pre, li") || paragraph.querySelector("code, strong, em, .tm-nlp-token")) continue;
    // Linked dates count as their [[link]] text, as the source has them.
    const segments: Segment[] = [];
    let source = "";
    const walk = (node: Node): void => {
      const element = node.nodeType === 1 ? node as HTMLElement : undefined;
      if (node.nodeType === 3) {
        const text = node.textContent ?? "";
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: false });
        source += text;
      } else if (element?.matches("a.internal-link")) {
        const text = `[[${element.getAttribute("data-href") ?? element.getAttribute("href") ?? element.textContent}]]`;
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: true });
        source += text;
      } else if (element?.tagName === "BR") {
        source += "\n";
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(paragraph.childNodes)) walk(child);
    const highlights: NoteHighlight[] = [];
    let offset = 0;
    for (const part of source.split(/(\r?\n)/)) {
      for (const highlight of logHighlights(part, dateFormat)) highlights.push({ ...highlight, from: highlight.from + offset, to: highlight.to + offset });
      offset += part.length;
    }
    wrapHighlights(document, segments, highlights);
  }
}
