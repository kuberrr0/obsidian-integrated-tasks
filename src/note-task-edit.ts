import { Platform, editorInfoField, MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { scanTasks } from "./parser";
import type { Task } from "./types";

type OpenTask = (task: Task) => void;

/** Capture before Obsidian's checkbox handler can toggle the task. */
export function handleTaskEditClick(event: MouseEvent, resolve: (checkbox: HTMLElement) => Task | undefined, open: OpenTask): void {
  if (!(Platform.isMacOS ? event.metaKey : event.ctrlKey) || event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  const checkbox = target?.closest?.<HTMLElement>('input[type="checkbox"]');
  if (!checkbox) return;
  const task = resolve(checkbox);
  if (!task) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  open(task);
}

/** Share gesture handling between Live Preview and Reading view. */
export function bindNoteTaskEdit(root: HTMLElement, resolve: (checkbox: HTMLElement) => Task | undefined, open: OpenTask): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let press: { checkbox: HTMLElement; id: number; x: number; y: number } | undefined;
  let held: HTMLElement | undefined;
  let suppressUntil = 0;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    press = undefined;
  };
  const block = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const start = (event: TouchEvent): void => {
    cancel();
    held = undefined;
    if (event.touches.length !== 1) return;
    const checkbox = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('input[type="checkbox"]');
    if (!checkbox || !resolve(checkbox)) return;
    const touch = event.touches[0];
    press = { checkbox, id: touch.identifier, x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => {
      if (!press || !checkbox.isConnected) return;
      const task = resolve(checkbox);
      if (!task) return;
      held = checkbox;
      suppressUntil = Date.now() + 1500;
      cancel();
      open(task);
    }, 500);
  };
  const move = (event: TouchEvent): void => {
    if (!press) return;
    const touch = Array.from(event.touches).find(touch => touch.identifier === press!.id);
    if (event.touches.length !== 1 || !touch || Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) cancel();
  };
  const end = (event: TouchEvent): void => {
    cancel();
    if (held && event.target === held) {
      suppressUntil = Date.now() + 1500;
      block(event);
    }
  };
  const click = (event: MouseEvent): void => {
    if (held && Date.now() <= suppressUntil && event.target === held) {
      block(event);
      held = undefined;
      return;
    }
    handleTaskEditClick(event, resolve, open);
  };
  const contextMenu = (event: MouseEvent): void => {
    if (event.target === press?.checkbox || (event.target === held && Date.now() <= suppressUntil)) block(event);
  };
  const document = root.ownerDocument;
  root.addEventListener("click", click, true);
  root.addEventListener("touchstart", start, { capture: true, passive: true });
  root.addEventListener("contextmenu", contextMenu, true);
  document.addEventListener("touchmove", move, { capture: true, passive: true });
  document.addEventListener("touchend", end, { capture: true, passive: false });
  document.addEventListener("touchcancel", cancel, true);
  return () => {
    cancel();
    held = undefined;
    root.removeEventListener("click", click, true);
    root.removeEventListener("touchstart", start, true);
    root.removeEventListener("contextmenu", contextMenu, true);
    document.removeEventListener("touchmove", move, true);
    document.removeEventListener("touchend", end, true);
    document.removeEventListener("touchcancel", cancel, true);
  };
}

export function noteTaskEditEditor(getDateFormat: () => string, open: OpenTask) {
  return ViewPlugin.fromClass(class {
    private resolve = (checkbox: HTMLElement): Task | undefined => {
      const path = this.view.state.field(editorInfoField, false)?.file?.path;
      if (!path) return;
      const line = this.view.state.doc.lineAt(this.view.posAtDOM(checkbox)).number - 1;
      return scanTasks(path, this.view.state.doc.toString(), new Date(), getDateFormat()).find(task => task.line === line);
    };
    private dispose: () => void;

    constructor(private view: EditorView) {
      this.dispose = bindNoteTaskEdit(view.dom, this.resolve, open);
    }

    destroy(): void { this.dispose(); }
  });
}

export function registerNoteTaskEdit(root: HTMLElement, context: MarkdownPostProcessorContext, getDateFormat: () => string, open: OpenTask): void {
  const child = new MarkdownRenderChild(root);
  context.addChild(child);
  child.register(bindNoteTaskEdit(root, checkbox => {
    const item = checkbox.closest<HTMLElement>("li.task-list-item");
    if (!item) return;
    const section = context.getSectionInfo(item);
    if (!section) return;
    // Obsidian's rendered task line is relative to the containing section.
    const relativeLine = item.getAttribute("data-line");
    if (relativeLine === null || !/^\d+$/.test(relativeLine)) return;
    const line = section.lineStart + Number(relativeLine);
    return scanTasks(context.sourcePath, section.text, new Date(), getDateFormat()).find(task => task.line === line);
  }, open));
}
