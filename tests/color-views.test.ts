// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  const original = await importOriginal<typeof import("./obsidian-mock")>();
  class ItemView {
    app: unknown;
    containerEl: HTMLElement;
    constructor() {
      this.containerEl = document.createElement("div");
      this.containerEl.append(document.createElement("div"), document.createElement("div"));
      document.body.appendChild(this.containerEl);
    }
    registerEvent(): void {}
  }
  class Modal {
    contentEl = document.createElement("div");
    modalEl = document.createElement("div");
    constructor() { this.modalEl.appendChild(this.contentEl); document.body.appendChild(this.modalEl); }
    close(): void { (this as unknown as { onClose(): void }).onClose(); }
  }
  return { ...original, ItemView, Modal, Notice: class {}, setIcon: vi.fn() };
});

import type { App, WorkspaceLeaf } from "obsidian";
import { ProjectCreatorModal, renderProjectColorPicker, type ProjectDraft } from "../src/project-creator";
import { renderGantt } from "../src/gantt-view";
import { renderProjectProgress } from "../src/project-progress";
import { TaskNavigationView } from "../src/navigation-view";
import type TaskManagerPlugin from "../src/main";
import type { Project } from "../src/types";

beforeAll(() => installObsidianDom());

const radios = (root: HTMLElement): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
const checked = (root: HTMLElement): string[] => radios(root).filter(radio => radio.getAttribute("aria-checked") === "true").map(radio => radio.getAttribute("aria-label")!);
const key = (target: HTMLElement, name: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); };

it("renders colour swatches as a keyboard-navigable radio group with a hex field", () => {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const change = vi.fn();
  const picker = renderProjectColorPicker(parent, "blue", change);
  const group = parent.querySelector<HTMLElement>('[role="radiogroup"]')!;
  expect(group.getAttribute("aria-label")).toBe("Project color");
  expect(radios(group).map(radio => radio.getAttribute("aria-label"))).toEqual(["None", "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Gray"]);
  expect(radios(group).every(radio => radio.getAttribute("type") === "button")).toBe(true);
  expect(radios(group)[1].style.getPropertyValue("--tm-project-color")).toBe("var(--color-red)");
  expect(radios(group)[9].style.getPropertyValue("--tm-project-color")).toBe("var(--color-base-50)");
  expect(checked(group)).toEqual(["Blue"]);
  expect(radios(group).filter(radio => radio.getAttribute("tabindex") === "0").map(radio => radio.getAttribute("aria-label"))).toEqual(["Blue"]);
  picker.focus();
  expect(document.activeElement).toBe(radios(group)[6]);

  key(radios(group)[6], "ArrowRight");
  expect(checked(group)).toEqual(["Purple"]);
  expect(document.activeElement).toBe(radios(group)[7]);
  expect(change).toHaveBeenLastCalledWith("purple");
  key(radios(group)[7], "ArrowUp");
  key(radios(group)[6], "ArrowLeft");
  expect(checked(group)).toEqual(["Cyan"]);
  key(radios(group)[5], "End");
  key(radios(group)[9], "ArrowDown");
  expect(checked(group)).toEqual(["None"]);
  expect(change).toHaveBeenLastCalledWith("");
  key(radios(group)[0], "ArrowLeft");
  expect(checked(group)).toEqual(["Gray"]);
  key(radios(group)[9], "Home");
  expect(document.activeElement).toBe(radios(group)[0]);

  const hex = parent.querySelector<HTMLInputElement>('input[aria-label="Custom color"]')!;
  hex.value = "#A1B2C3";
  hex.dispatchEvent(new Event("input"));
  expect(change).toHaveBeenLastCalledWith("#a1b2c3");
  expect(checked(group)).toEqual([]);
  expect(radios(group).filter(radio => radio.getAttribute("tabindex") === "0")).toHaveLength(1);
  hex.value = "red;x";
  hex.dispatchEvent(new Event("input"));
  expect(change).toHaveBeenLastCalledWith("red;x");
  radios(group)[2].click();
  expect(hex.value).toBe("");
  expect(checked(group)).toEqual(["Orange"]);
  expect(change).toHaveBeenLastCalledWith("orange");

  const custom = document.createElement("div");
  renderProjectColorPicker(custom, "#ABC", vi.fn());
  expect(custom.querySelector<HTMLInputElement>("input")!.value).toBe("#abc");
  expect(checked(custom)).toEqual([]);
});

const blank: ProjectDraft = { name: "Launch", date: "", endDate: "", deadline: "", priority: "", parent: "", tags: "project", archived: false };
const openModal = (initial?: ProjectDraft) => {
  const createProject = vi.fn<(draft: ProjectDraft) => Promise<void>>().mockResolvedValue(undefined);
  const modal = new ProjectCreatorModal({} as App, { projects: [], dateFormat: "YYYY-MM-DD", linkDates: false, createProject, initial });
  modal.onOpen();
  const view = modal as unknown as { contentEl: HTMLElement; modalEl: HTMLElement };
  const save = Array.from(view.modalEl.querySelectorAll("button")).find(button => button.classList.contains("mod-cta"))!;
  return { createProject, content: view.contentEl, save, error: view.contentEl.querySelector(".tm-editor-error")! };
};

it("saves the chosen colour, None, or leaves an unreadable colour unchanged", async () => {
  const created = openModal();
  expect(checked(created.content)).toEqual(["None"]);
  created.content.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!.value = "Launch";
  radios(created.content)[6].click();
  created.save.click();
  await vi.waitFor(() => expect(created.createProject).toHaveBeenCalledWith({ ...blank, color: "blue" }));

  const edited = openModal({ ...blank, color: "red" });
  expect(checked(edited.content)).toEqual(["Red"]);
  radios(edited.content)[0].click();
  edited.save.click();
  await vi.waitFor(() => expect(edited.createProject).toHaveBeenCalledWith({ ...blank, color: "" }));

  const unknown = openModal({ ...blank, color: undefined });
  expect(checked(unknown.content)).toEqual([]);
  unknown.save.click();
  await vi.waitFor(() => expect(unknown.createProject).toHaveBeenCalledOnce());
  expect(unknown.createProject.mock.calls[0][0].color).toBeUndefined();

  const invalid = openModal({ ...blank, color: "" });
  const hex = invalid.content.querySelector<HTMLInputElement>('input[aria-label="Custom color"]')!;
  hex.value = "#12";
  hex.dispatchEvent(new Event("input"));
  invalid.save.click();
  await vi.waitFor(() => expect(invalid.error.textContent).toContain("hex"));
  expect(invalid.createProject).not.toHaveBeenCalled();
});

const project = (patch: Partial<Project> = {}): Project => ({ name: "Launch", path: "Launch.md", archived: false, openTasks: 1, completedTasks: 1, ...patch });

it("colours the progress ring only for coloured projects", () => {
  const parent = document.createElement("div");
  renderProjectProgress(parent, project({ color: "var(--color-green)" }));
  renderProjectProgress(parent, project());
  const [colored, plain] = Array.from(parent.querySelectorAll<HTMLElement>(".tm-project-progress"));
  expect(colored.style.getPropertyValue("--tm-project-color")).toBe("var(--color-green)");
  expect(plain.style.getPropertyValue("--tm-project-color")).toBe("");
});

it("colours Gantt bars and their grips with the project colour", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dates = { scheduledDate: "2026-09-18", endDate: "2026-09-25" };
  renderGantt(container, {
    projects: [project({ ...dates, color: "#a1b2c3" }), project({ ...dates, name: "Plain", path: "Plain.md" })],
    anchor: "2026-09-18", zoom: "month", dateFormat: "YYYY-MM-DD", navigate: vi.fn(), open: vi.fn(), update: vi.fn()
  });
  const [colored, plain] = Array.from(container.querySelectorAll<HTMLElement>(".tm-gantt-bar"));
  expect(colored.style.getPropertyValue("--tm-project-color")).toBe("#a1b2c3");
  expect(colored.classList.contains("tm-project-colored")).toBe(true);
  for (const handle of Array.from(colored.parentElement!.querySelectorAll<HTMLElement>(".tm-gantt-handle"))) expect(handle.style.getPropertyValue("--tm-project-color")).toBe("#a1b2c3");
  expect(colored.closest(".tm-gantt-row")!.querySelector<HTMLElement>(".tm-project-progress")!.style.getPropertyValue("--tm-project-color")).toBe("#a1b2c3");
  expect(plain.style.getPropertyValue("--tm-project-color")).toBe("");
  expect(plain.classList.contains("tm-project-colored")).toBe(false);
});

it("shows a colour dot beside coloured projects in the navigation", () => {
  const plugin = {
    index: { subscribe: () => () => {}, projects: () => [project({ color: "var(--color-blue)" }), project({ name: "Plain", path: "Plain.md" })], tagSummaries: () => [] },
    settings: { smartLists: [], taskMode: false }
  } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({} as WorkspaceLeaf, plugin);
  view.app = { workspace: { getActiveViewOfType: () => null } } as unknown as App;
  view.setActive("projects", undefined, "Launch.md");
  const rows = Array.from(view.containerEl.querySelectorAll<HTMLElement>(".tm-nav-children .tm-nav-item"));
  expect(rows).toHaveLength(2);
  const dots = rows.map(row => row.querySelector<HTMLElement>(".tm-project-dot"));
  expect(dots[0]!.style.getPropertyValue("--tm-project-color")).toBe("var(--color-blue)");
  expect(dots[0]!.getAttribute("aria-hidden")).toBe("true");
  expect(rows[0].firstElementChild).toBe(dots[0]);
  expect(rows[0].querySelector(".tm-nav-label")!.textContent).toBe("Launch");
  expect(dots[1]).toBeNull();
});
