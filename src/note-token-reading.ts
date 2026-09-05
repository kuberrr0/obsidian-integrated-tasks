import { taskTokens, tokenClass } from "./task-tokens";

interface Segment { node: Node; from: number; to: number; atomic: boolean }

/** Wrap only recognized trailing metadata and retain Obsidian's existing link elements. */
export function renderNoteTokens(root: HTMLElement, dateFormat?: string): void {
  const items = Array.from(root.querySelectorAll<HTMLElement>("li.task-list-item"));
  if (root.matches("li.task-list-item")) items.unshift(root);
  for (const item of items) {
    const content = Array.from(item.children).find((child) => child.tagName === "P") ?? item;
    if (Array.from(content.querySelectorAll(".tm-note-token")).some((pill) => pill.closest("li") === item)) continue;
    let source = "- [ ] ";
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
        attr: { "aria-label": token.description }
      });
      const link = fragment.querySelector("a.internal-link");
      if (link) {
        if (token.kind === "deadline") pill.appendChild(document.createTextNode("Due "));
        pill.appendChild(link);
      } else pill.textContent = token.label;
      range.insertNode(pill);
    }
  }
}
