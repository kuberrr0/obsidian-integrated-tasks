// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() };
});

import type { WorkspaceLeaf } from "obsidian";
import { TaskNavigationView } from "../src/navigation-view";
import { DEFAULT_SETTINGS, type TaskManagerSettings } from "../src/types";
import type TaskManagerPlugin from "../src/main";

beforeAll(() => installObsidianDom());

it("marks the navigation container compact only in compact density", () => {
  const settings = { ...DEFAULT_SETTINGS };
  const plugin = { settings, index: { projects: () => [], tagSummaries: () => [], query: () => [] } } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({} as WorkspaceLeaf, plugin);
  const container = view.containerEl.children[1] as HTMLElement;
  view.refresh();
  expect(container.classList.contains("tm-navigation")).toBe(true);
  expect(container.classList.contains("tm-density-compact")).toBe(false);
  settings.density = "compact";
  view.refresh();
  expect(container.classList.contains("tm-density-compact")).toBe(true);
  settings.density = "comfortable";
  view.refresh();
  expect(container.classList.contains("tm-density-compact")).toBe(false);
});

it("shows Today with calendar-x in the Griply style, and a star in the Things style", async () => {
  const { setIcon } = await import("obsidian");
  const settings: TaskManagerSettings = { ...DEFAULT_SETTINGS, style: "griply" };
  const plugin = { settings, index: { projects: () => [], tagSummaries: () => [], query: () => [] } } as unknown as TaskManagerPlugin;
  const view = new TaskNavigationView({} as WorkspaceLeaf, plugin);
  const todayIcon = (): string | undefined => {
    const row = view.containerEl.querySelector<HTMLElement>("[data-nav-key='mode:today'], [data-key='mode:today']")
      ?? Array.from(view.containerEl.querySelectorAll<HTMLElement>(".tm-nav-item")).find(item => item.textContent?.includes("Today"));
    const call = vi.mocked(setIcon).mock.calls.find(([element]) => row?.contains(element));
    return call?.[1];
  };
  view.refresh();
  expect(todayIcon()).toBe("calendar-x");
  // Only the Things style fills it (see styles.css).
  expect(view.containerEl.querySelector(".tm-navigation")!.classList.contains("tm-style-things")).toBe(false);
  vi.mocked(setIcon).mockClear();
  settings.style = "things";
  view.refresh();
  expect(todayIcon()).toBe("star");
  expect(view.containerEl.querySelector(".tm-navigation")!.classList.contains("tm-style-things")).toBe(true);
});

it("keeps the list as it is while a row is pressed, so one tap opens it", async () => {
  const openTaskView = vi.fn().mockResolvedValue(undefined);
  let emit = (): void => {};
  const plugin = {
    settings: { ...DEFAULT_SETTINGS }, openTaskView,
    index: { projects: () => [], tagSummaries: () => [], query: () => [], subscribe: (listener: () => void) => { emit = listener; return () => {}; } }
  } as unknown as TaskManagerPlugin;
  const app = { workspace: { on: () => ({}), getActiveViewOfType: () => null, rootSplit: {} } };
  const view = new TaskNavigationView({ app } as unknown as WorkspaceLeaf, plugin);
  await view.onOpen();
  const inbox = () => Array.from(view.containerEl.querySelectorAll<HTMLElement>("button.tm-nav-label")).find(label => label.textContent === "Inbox")!;
  const pressed = inbox();
  pressed.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  // A change arriving mid-tap (on a phone, the sidebar becoming active) does not rebuild the list under the finger.
  emit();
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(inbox()).toBe(pressed);
  window.dispatchEvent(new Event("pointerup"));
  pressed.click();
  expect(openTaskView).toHaveBeenCalledExactlyOnceWith({ mode: "inbox" });
  await view.onClose();
});
