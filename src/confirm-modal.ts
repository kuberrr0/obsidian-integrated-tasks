import { Modal, type App } from "obsidian";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** The confirming button's text, such as "Delete". */
  confirm: string;
  /** Styles the confirming button as destructive. */
  danger?: boolean;
  run: () => void;
}

/** Asks before an action: Cancel (focused, or Escape) does nothing; the confirming button runs it. */
export function openConfirm(app: App, options: ConfirmOptions): Modal {
  const modal = new Modal(app);
  modal.onOpen = () => {
    modal.titleEl.setText(options.title);
    modal.contentEl.createEl("p", { text: options.message });
    const actions = modal.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const confirm = actions.createEl("button", { text: options.confirm, cls: options.danger ? "mod-warning" : "mod-cta" });
    cancel.addEventListener("click", () => modal.close());
    confirm.addEventListener("click", () => { modal.close(); options.run(); });
    cancel.focus();
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
  return modal;
}
