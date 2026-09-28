import { expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { TaskIndex } from "../src/task-index";
import { DEFAULT_SETTINGS } from "../src/types";

it("resolves project colours with subproject inheritance, parent cycles and live changes", async () => {
  const notes: Record<string, Record<string, unknown>> = {
    "Root.md": { tags: ["project"], color: "blue" },
    "Child.md": { tags: ["project"], parent: "[[Root]]" },
    "Grandchild.md": { tags: ["project"], parent: "[[Child]]" },
    "Own.md": { tags: ["project"], parent: "[[Root]]", color: "#F00" },
    "CycleA.md": { tags: ["project"], parent: "[[CycleB]]" },
    "CycleB.md": { tags: ["project"], parent: "[[CycleA]]" },
    "ColoredCycle.md": { tags: ["project"], parent: "[[CycleC]]", color: "pink" },
    "CycleC.md": { tags: ["project"], parent: "[[ColoredCycle]]" },
    "Self.md": { tags: ["project"], parent: "[[Self]]" },
    "Orphan.md": { tags: ["project"], parent: "[[Plain]]" },
    "Plain.md": { color: "red" },
    "Invalid.md": { tags: ["project"], color: "red;background:url(x)" }
  };
  const files = Object.keys(notes).map(path => Object.assign(new TFile(), { path, extension: "md" }));
  let changed: (file: TFile) => void = () => {};
  const app = {
    vault: { getMarkdownFiles: () => files, cachedRead: async () => "", on: () => ({}), offref: () => {} },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: notes[file.path] }),
      getFirstLinkpathDest: (link: string) => files.find(file => file.path === `${link}.md`) ?? null,
      on: (_event: string, callback: (file: TFile) => void) => { changed = callback; return {}; }
    }
  } as unknown as App;
  const index = new TaskIndex(app, () => DEFAULT_SETTINGS, () => "YYYY-MM-DD");
  await index.initialize();
  const expected: Record<string, string | undefined> = {
    "Root.md": "var(--color-blue)", "Child.md": "var(--color-blue)", "Grandchild.md": "var(--color-blue)", "Own.md": "#f00",
    "CycleA.md": undefined, "CycleB.md": undefined, "ColoredCycle.md": "var(--color-pink)", "CycleC.md": "var(--color-pink)",
    "Self.md": undefined, "Orphan.md": undefined, "Plain.md": undefined, "Invalid.md": undefined, "Missing.md": undefined
  };
  for (const [path, color] of Object.entries(expected)) expect(index.projectColor(path), path).toBe(color);
  // Order-independent: start from a cycle member first after the cache resets.
  changed(files[4]);
  expect(index.projectColor("CycleC.md")).toBe("var(--color-pink)");
  expect(Object.fromEntries(index.projects().map(project => [project.path, project.color])))
    .toEqual(Object.fromEntries(Object.entries(expected).filter(([path]) => path !== "Plain.md" && path !== "Missing.md")));

  notes["Root.md"] = { tags: ["project"], color: "green" };
  changed(files[0]);
  expect(index.projectColor("Grandchild.md")).toBe("var(--color-green)");
  notes["Child.md"] = { tags: ["project"], parent: "[[Root]]", color: "yellow" };
  changed(files[1]);
  expect(index.projectColor("Grandchild.md")).toBe("var(--color-yellow)");
  notes["Root.md"] = { tags: ["project"] };
  changed(files[0]);
  expect(index.projectColor("Root.md")).toBeUndefined();
  expect(index.projectColor("Own.md")).toBe("#f00");
});
