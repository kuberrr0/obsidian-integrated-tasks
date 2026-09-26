import { parseProjectProperties, parseProjectParent } from "./project-properties";
import { scanSections, splitDestination, type NoteHeading } from "./structure";
import { getAllTags, type App, type EventRef, TFile } from "obsidian";
import { scanTasks } from "./parser";
import { sortTasks, taskMatchesQuery } from "./query";
import type { Project, ProjectProperties, Task, TaskManagerSettings, TaskQuery } from "./types";

export type IndexListener = () => void;

const SCAN_BATCH = 50;
const SCAN_SLICE_MS = 30;

export class TaskIndex {
  private readonly tasksByPath = new Map<string, Task[]>();
  private readonly headingsByPath = new Map<string, NoteHeading[]>();
  private readonly projectProperties = new Map<string, ProjectProperties & { parent?: string }>();
  private readonly archivedPaths = new Set<string>();
  private readonly projectPaths = new Set<string>();
  private readonly listeners = new Set<IndexListener>();
  private readonly eventRefs: EventRef[] = [];
  private destroyed = false;
  // The latest scan of each path wins, even if an older read finishes later.
  private readonly scanTokens = new Map<string, number>();
  private scanCount = 0;
  // Derived from tasksByPath; rebuilt lazily after any change.
  private sortedTasks?: Task[];
  private tasksById?: Map<string, Task>;
  // Link resolution can change with any vault or metadata event, so these reset on every emit.
  private readonly tagLinks = new Map<string, TFile | null>();
  private tagsByPath?: Map<string, string>;
  private filesByTag?: Map<string, TFile>;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => TaskManagerSettings,
    private readonly getDateFormat: () => string
  ) {}

  async initialize(): Promise<void> {
    // Listen first so edits made while the vault is scanned are not missed.
    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        this.invalidateTags();
        if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("delete", (file) => {
        this.invalidateTags();
        if (file instanceof TFile && file.extension === "md") {
          this.scanTokens.delete(file.path);
          this.tasksByPath.delete(file.path);
          this.invalidateTasks();
          this.headingsByPath.delete(file.path);
          this.projectPaths.delete(file.path);
          this.projectProperties.delete(file.path);
          this.archivedPaths.delete(file.path);
          this.emit();
        }
      }),
      this.app.vault.on("rename", (file, oldPath) => {
        this.invalidateTags();
        if (file instanceof TFile && file.extension === "md") {
          this.scanTokens.delete(oldPath);
          this.tasksByPath.delete(oldPath);
          this.invalidateTasks();
          this.headingsByPath.delete(oldPath);
          this.projectPaths.delete(oldPath);
          this.projectProperties.delete(oldPath);
          this.archivedPaths.delete(oldPath);
          void this.refreshFile(file);
        }
      }),
      this.app.metadataCache.on("changed", (file) => {
        if (file.extension === "md") {
          this.updateProjectStatus(file);
          this.emit();
        }
      })
    );
    // All Tasks and project/tag discovery require every Markdown note. Scan in batches,
    // yielding between them so a large vault does not freeze the app.
    const files = this.app.vault.getMarkdownFiles();
    let yielded = performance.now();
    for (let start = 0; start < files.length; start += SCAN_BATCH) {
      if (this.destroyed) return;
      // One unreadable note (for example, deleted mid-scan) must not stop the rest.
      await Promise.all(files.slice(start, start + SCAN_BATCH).map((file) => this.scanFile(file)
        .catch((error: unknown) => console.error(`Task manager could not index ${file.path}`, error))));
      if (performance.now() - yielded > SCAN_SLICE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
    if (this.destroyed) return;
    // Update in place: notes created while scanning already have their status from the create event.
    for (const file of files) this.updateProjectStatus(file);
    this.emit();
  }

  destroy(): void {
    this.destroyed = true;
    for (const eventRef of this.eventRefs) this.app.vault.offref(eventRef);
    this.eventRefs.length = 0;
    this.listeners.clear();
  }

  subscribe(listener: IndexListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Returns a copy, so callers may reorder it without affecting the index. */
  allTasks(): Task[] {
    return this.sortedAllTasks().slice();
  }

  private sortedAllTasks(): Task[] {
    this.sortedTasks ??= sortTasks([...this.tasksByPath.values()].flat());
    return this.sortedTasks;
  }

  private invalidateTasks(): void {
    this.sortedTasks = undefined;
    this.tasksById = undefined;
    this.invalidateTags();
  }

  private invalidateTags(): void {
    this.tagLinks.clear();
    this.tagsByPath = undefined;
    this.filesByTag = undefined;
  }

  tasksForPath(path: string): Task[] {
    return this.tasksByPath.get(path) ?? [];
  }

  taskById(id: string): Task | undefined {
    this.tasksById ??= new Map(this.sortedAllTasks().map((task) => [task.id, task]));
    return this.tasksById.get(id);
  }

  query(query: TaskQuery, now = new Date()): Task[] {
    // Filtering keeps the cached sort order, so no re-sort is needed.
    return this.sortedAllTasks().filter((task) => (!query.tagPath || this.taskHasTagPath(task, query.tagPath)) && taskMatchesQuery(task, query, this.getSettings().inboxPath, now));
  }

  taskHasTagPath(task: Task, path: string): boolean {
    return (task.tags ?? []).some(tag => this.resolveTag(tag, task.path)?.path === path);
  }

  /** The first tag, in task order, that links to this note. */
  tagForPath(path: string): string | undefined {
    if (!this.tagsByPath) {
      this.tagsByPath = new Map();
      for (const task of this.sortedAllTasks()) for (const tag of task.tags ?? []) {
        const file = this.resolveTag(tag, task.path);
        if (file && !this.tagsByPath.has(file.path)) this.tagsByPath.set(file.path, tag);
      }
    }
    return this.tagsByPath.get(path);
  }

  /** The note the first task using this tag links to. */
  tagFile(tag: string): TFile | undefined {
    if (!this.filesByTag) {
      this.filesByTag = new Map();
      for (const task of this.sortedAllTasks()) for (const name of task.tags ?? []) {
        if (this.filesByTag.has(name)) continue;
        const file = this.resolveTag(name, task.path);
        if (file?.extension === "md") this.filesByTag.set(name, file);
      }
    }
    return this.filesByTag.get(tag);
  }

  /** Tags resolve like links, so the same tag may point elsewhere from another note. */
  private resolveTag(tag: string, sourcePath: string): TFile | null {
    const key = `${sourcePath}\0${tag}`;
    let file = this.tagLinks.get(key);
    if (file === undefined) {
      file = this.app.metadataCache.getFirstLinkpathDest(tag, sourcePath);
      this.tagLinks.set(key, file);
    }
    return file;
  }

  projects(): Project[] {
    return [...this.projectPaths]
      .map((path) => {
        const tasks = this.tasksForPath(path);
        const properties = this.projectProperties.get(path);
        const parentPath = properties?.parent ? this.app.metadataCache.getFirstLinkpathDest(properties.parent, path)?.path : undefined;
        return {
          ...properties,
          parentPath,
          path,
          name: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
          headings: this.headingsForPath(path),
          archived: this.archivedPaths.has(path),
          openTasks: tasks.filter((task) => !task.completed).length,
          completedTasks: tasks.filter((task) => task.completed).length
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  headingsForPath(path: string): NoteHeading[] {
    return this.headingsByPath.get(path) ?? [];
  }

  isProject(path: string): boolean {
    return this.projectPaths.has(path);
  }

  async refreshPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(splitDestination(path).path);
    if (file instanceof TFile) await this.refreshFile(file);
  }

  private async refreshFile(file: TFile): Promise<void> {
    await this.scanFile(file);
    this.updateProjectStatus(file);
    this.emit();
  }

  private async scanFile(file: TFile): Promise<void> {
    const token = ++this.scanCount;
    this.scanTokens.set(file.path, token);
    const content = await this.app.vault.cachedRead(file);
    if (this.scanTokens.get(file.path) !== token) return;
    this.headingsByPath.set(file.path, scanSections(content, this.getSettings().sectionHeadingLevel));
    this.tasksByPath.set(file.path, scanTasks(file.path, content, new Date(), this.getDateFormat(), this.getSettings().sectionHeadingLevel));
    this.invalidateTasks();
  }

  private updateProjectStatus(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    if (tags?.includes("#archived")) this.archivedPaths.add(file.path);
    else this.archivedPaths.delete(file.path);
    if (tags?.some((tag) => tag === "#project" || tag.startsWith("#project/"))) {
      this.projectPaths.add(file.path);
      this.projectProperties.set(file.path, { ...parseProjectProperties(cache?.frontmatter, this.getDateFormat()), parent: parseProjectParent(cache?.frontmatter) });
    } else {
      this.projectPaths.delete(file.path);
      this.projectProperties.delete(file.path);
    }
  }

  private emit(): void {
    this.invalidateTags();
    for (const listener of this.listeners) listener();
  }
}
