// Obsidian adds helpers to DOM prototypes at runtime; recreate the ones the views use
// so view code can run under happy-dom (`// @vitest-environment happy-dom`).
type Info = string | {
  cls?: string | string[]; text?: string; title?: string; type?: string; value?: string; placeholder?: string; href?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
};

function apply(element: HTMLElement, info?: Info): void {
  if (!info) return;
  if (typeof info === "string") { element.className = info; return; }
  const classes = Array.isArray(info.cls) ? info.cls : info.cls?.split(/\s+/) ?? [];
  for (const name of classes) if (name) element.classList.add(name);
  if (info.text !== undefined) element.textContent = info.text;
  for (const key of ["title", "type", "value", "placeholder", "href"] as const) {
    if (info[key] !== undefined) element.setAttribute(key, String(info[key]));
  }
  if (info.value !== undefined && "value" in element) (element as HTMLInputElement).value = info.value;
  for (const [key, value] of Object.entries(info.attr ?? {})) {
    if (value !== null && value !== undefined && value !== false) element.setAttribute(key, String(value));
  }
}

export function installObsidianDom(): void {
  // happy-dom's fragments may not inherit from the global DocumentFragment.
  const targets = [...new Set([HTMLElement.prototype, DocumentFragment.prototype, Object.getPrototypeOf(document.createDocumentFragment()) as object])] as unknown as Array<Record<string, unknown>>;
  for (const proto of targets) {
    proto.createEl = function (this: Node, tag: string, info?: Info, callback?: (element: HTMLElement) => void) {
      const element = document.createElement(tag);
      apply(element, info);
      this.appendChild(element);
      callback?.(element);
      return element;
    };
    proto.createDiv = function (this: { createEl: (tag: string, info?: Info) => HTMLElement }, info?: Info) { return this.createEl("div", info); };
    proto.createSpan = function (this: { createEl: (tag: string, info?: Info) => HTMLElement }, info?: Info) { return this.createEl("span", info); };
    proto.empty = function (this: Node) { while (this.firstChild) this.removeChild(this.firstChild); };
    proto.setText = function (this: Node, text: string) { this.textContent = text; };
    proto.appendText = function (this: Node, text: string) { this.appendChild(document.createTextNode(text)); };
  }
  (Node.prototype as unknown as Record<string, unknown>).instanceOf = function (this: Node, type: new () => unknown) { return this instanceof type; };
  // Obsidian's global helpers make detached elements and fragments.
  const global = globalThis as unknown as Record<string, unknown>;
  global.createFragment = (callback?: (fragment: DocumentFragment) => void) => { const fragment = document.createDocumentFragment(); callback?.(fragment); return fragment; };
  for (const [name, tag] of [["createDiv", "div"], ["createSpan", "span"]] as const) {
    global[name] = (info?: Info) => (document.createDocumentFragment() as unknown as { createEl: (tag: string, info?: Info) => HTMLElement }).createEl(tag, info);
  }
  global.createEl = (tag: string, info?: Info) => (document.createDocumentFragment() as unknown as { createEl: (tag: string, info?: Info) => HTMLElement }).createEl(tag, info);
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  element.addClass = function (this: HTMLElement, ...names: string[]) { this.classList.add(...names); };
  element.removeClass = function (this: HTMLElement, ...names: string[]) { this.classList.remove(...names); };
  element.toggleClass = function (this: HTMLElement, name: string, value: boolean) { this.classList.toggle(name, value); };
  element.hasClass = function (this: HTMLElement, name: string) { return this.classList.contains(name); };
  element.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) { Object.assign(this.style, styles); };
  element.setCssProps = function (this: HTMLElement, props: Record<string, string>) { for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value); };
  element.setAttr = function (this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); };
  for (const proto of [HTMLElement.prototype, Document.prototype] as unknown as object[]) {
    Object.defineProperty(proto, "win", { configurable: true, get(this: Node) { return (this as Document).defaultView ?? this.ownerDocument?.defaultView ?? window; } });
    Object.defineProperty(proto, "doc", { configurable: true, get(this: Node) { return (this as Document).defaultView ? this : this.ownerDocument; } });
  }
}
