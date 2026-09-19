import { notePropertyIconStyle } from "./task-property-icons";
import { taskTokens, recurringLogTokens, tokenClass } from "./task-tokens";

interface Segment { node: Node; from: number; to: number; atomic: boolean }

/** Wrap only recognized trailing metadata and retain Obsidian's existing link elements. */
export function renderNoteTokens(root: HTMLElement, dateFormat?: string): void {
  renderRecurringLogTokens(root, dateFormat);
  const items = Array.from(root.querySelectorAll<HTMLElement>("li.task-list-item"));
  if (root.matches("li.task-list-item")) items.unshift(root);
  for (const item of items) {
    const content = Array.from(item.children).find((child) => child.tagName === "P") ?? item;
    if (Array.from(content.querySelectorAll(".tm-note-token")).some((pill) => pill.closest("li") === item)) continue;
    const completed = item.getAttribute("data-task")?.toLowerCase() === "x" || item.classList.contains("is-checked");
    let source = completed ? "- [x] " : "- [ ] ";
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
      } else if (element?.matches("code, strong, em, del, s, mark, a, .internal-embed")) {
        // Protect formatted prose, literal code, external links and embeds from metadata parsing.
        source += `\`${element.textContent}\``;
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(content.childNodes)) walk(child);
    for (const token of taskTokens(source, dateFormat).reverse()) {
      const first = segments.find((segment) => segment.from <= token.from && segment.to > token.from);
      const last = segments.find((segment) => segment.from < token.to && segment.to >= token.to);
      if (!first || !last) continue;
      const document = item.ownerDocument;
      const range = document.createRange();
      if (first.atomic) range.setStartBefore(first.node);
      else range.setStart(first.node, token.from - first.from);
      if (last.atomic) range.setEndAfter(last.node);
      else range.setEnd(last.node, token.to - last.from);
      const fragment = range.extractContents();
      // A detached parent keeps the pill in this window's document until insertion.
      const win = document.win as Window & { createFragment: typeof createFragment };
      const pill = win.createFragment().createSpan({
        cls: tokenClass(token),
        title: token.description,
        attr: { "aria-label": token.description, style: notePropertyIconStyle(token.kind) }
      });
      const link = fragment.querySelector("a.internal-link");
      if (link) {
        link.textContent = token.dateLabel ?? link.textContent;
        pill.appendChild(link);
        if (token.time) pill.appendChild(document.createTextNode(` ${token.time}`));
      } else pill.textContent = token.kind === "deadline" ? token.label.replace(/^Due /, "") : token.label;
      range.insertNode(pill);
    }
  }
}

/** Generated logs are plain text lines, which Markdown may combine in one paragraph. */
export function renderRecurringLogTokens(root: HTMLElement, dateFormat?: string): void {
  const document = root.ownerDocument;
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p"));
  if (root.matches("p")) paragraphs.unshift(root);
  for (const paragraph of paragraphs) {
    if (paragraph.closest("pre, li") || paragraph.querySelector("code, strong, em, .tm-note-token")) continue;
    const walker = document.createTreeWalker(paragraph, 4 /* SHOW_TEXT */);
    const segments: Array<{ node: Text; from: number; to: number }> = [];
    let source = "";
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const value = node.textContent ?? "";
      segments.push({ node, from: source.length, to: source.length + value.length });
      source += value;
    }
    let offset = 0;
    const tokens = [];
    for (const part of source.split(/(\r?\n)/)) {
      for (const token of recurringLogTokens(part, dateFormat)) tokens.push({ ...token, from: token.from + offset, to: token.to + offset });
      offset += part.length;
    }
    for (const token of tokens.reverse()) {
      const first = segments.find(segment => segment.from <= token.from && segment.to > token.from);
      const last = segments.find(segment => segment.from < token.to && segment.to >= token.to);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, token.from - first.from);
      // Include the anchor itself to retain its native link behavior.
      const anchor = last.node.parentElement?.closest("a.internal-link");
      if (anchor && token.to === last.to) range.setEndAfter(anchor);
      else range.setEnd(last.node, token.to - last.from);
      const content = range.extractContents();
      const pill = document.createElement("span");
      pill.className = tokenClass(token);
      pill.setAttribute("title", token.description);
      pill.setAttribute("aria-label", token.description);
      pill.setAttribute("style", notePropertyIconStyle(token.kind));
      const link = content.querySelector("a.internal-link");
      if (link) { link.textContent = token.dateLabel!; pill.appendChild(content); }
      else pill.textContent = token.label;
      range.insertNode(pill);
    }
  }
}
