// @vitest-environment happy-dom
import { beforeAll, expect, it, vi } from "vitest";
import { installObsidianDom } from "./helpers/obsidian-dom";

vi.mock("obsidian", async importOriginal => {
  return { ...await importOriginal<typeof import("./obsidian-mock")>(), Notice: class {}, setIcon: vi.fn() };
});

import type { WorkspaceLeaf } from "obsidian";
import { TaskNavigationView } from "../src/navigation-view";
import { DEFAULT_SETTINGS } from "../src/types";
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
