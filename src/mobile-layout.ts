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
