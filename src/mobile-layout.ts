import { Platform } from "obsidian";

/** Track the visible viewport as mobile keyboards resize or pan the webview. */
export function trackModalViewport(modal: HTMLElement, content: HTMLElement): () => void {
  const win = modal.ownerDocument.defaultView;
  const container = modal.parentElement;
  if (!win || !container) return () => {};
  container.classList.add("tm-editor-container");
  const viewport = win.visualViewport;
  let frame = 0;
  const update = (): void => {
    container.style.setProperty("--tm-viewport-height", `${viewport?.height ?? win.innerHeight}px`);
    container.style.setProperty("--tm-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      if (!modal.ownerDocument.body.classList.contains("is-mobile") && !win.matchMedia("(max-width: 700px)").matches) return;
      const focused = modal.ownerDocument.activeElement;
      if (!focused || !content.contains(focused)) return;
      const field = focused.getBoundingClientRect();
      const area = content.getBoundingClientRect();
      if (field.bottom > area.bottom - 12) content.scrollTop += field.bottom - area.bottom + 12;
      else if (field.top < area.top + 12) content.scrollTop -= area.top + 12 - field.top;
    });
  };
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  win.addEventListener("resize", update);
  content.addEventListener("focusin", update);
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    win.removeEventListener("resize", update);
    content.removeEventListener("focusin", update);
    container.classList.remove("tm-editor-container");
    container.style.removeProperty("--tm-viewport-height");
    container.style.removeProperty("--tm-viewport-top");
  };
}

const SHEET_HANDLE_HEIGHT = 32;
const SHEET_DISMISS_DISTANCE = 80;

/**
 * On phones and narrow windows, show an editor modal as a bottom sheet that a downward swipe on its handle closes;
 * or, `atTop`, as a sheet hanging from the top of the screen that an upward swipe on its bottom handle closes.
 */
export function presentAsBottomSheet(modal: HTMLElement, close: () => void, atTop = false): () => void {
  const win = modal.ownerDocument?.defaultView;
  if (!win || !(Platform.isMobile || win.matchMedia?.("(max-width: 600px)").matches)) return () => {};
  const container = modal.parentElement;
  modal.classList.add("tm-bottom-sheet");
  modal.classList.toggle("is-top", atTop);
  container?.classList.add("tm-bottom-sheet-container");
  container?.classList.toggle("is-top", atTop);
  let drag: { pointer: number; startY: number } | undefined;
  // How far the sheet is dragged toward the edge it closes over.
  const distance = (event: PointerEvent): number => Math.max(0, (event.clientY - (drag?.startY ?? event.clientY)) * (atTop ? -1 : 1));
  const start = (event: PointerEvent): void => {
    if (drag || event.button !== 0) return;
    // Text fields keep their own touch gestures, such as selecting and scrolling text.
    if ((event.target as Element | null)?.closest?.("input, textarea, select, button, [contenteditable], .cm-editor")) return;
    const rect = modal.getBoundingClientRect();
    if ((atTop ? rect.bottom - event.clientY : event.clientY - rect.top) > SHEET_HANDLE_HEIGHT) return;
    drag = { pointer: event.pointerId, startY: event.clientY };
  };
  const move = (event: PointerEvent): void => {
    if (drag?.pointer === event.pointerId) modal.style.transform = `translateY(${atTop ? -distance(event) : distance(event)}px)`;
  };
  const end = (event: PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    const dismissed = event.type === "pointerup" && distance(event) > SHEET_DISMISS_DISTANCE;
    drag = undefined;
    modal.style.removeProperty("transform");
    if (dismissed) close();
  };
  modal.addEventListener("pointerdown", start);
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", end);
  win.addEventListener("pointercancel", end);
  return () => {
    modal.removeEventListener("pointerdown", start);
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", end);
    win.removeEventListener("pointercancel", end);
    modal.classList.remove("tm-bottom-sheet", "is-top");
    container?.classList.remove("tm-bottom-sheet-container", "is-top");
  };
}
