import { parseProjectProperties, parseProjectParent } from "./project-properties";
import { scanSections, splitDestination, type NoteHeading } from "./structure";
import { getAllTags, type App, type EventRef, type Events, TFile } from "obsidian";
import { scanTasks } from "./parser";
import { sortTasks, taskMatchesQuery } from "./query";
import { taskTagSummaries, type TaskTagSummary } from "./task-tags";
import type { Project, ProjectProperties, Task, TaskManagerSettings, TaskQuery } from "./types";

export type IndexListener = () => void;

export interface RefreshOptions {
  /** Parse again even if the note is unchanged, for settings that change how notes are read. */
  force?: boolean;
}

const SCAN_BATCH = 50;
const SCAN_SLICE_MS = 30;

type ProjectEntry = ProjectProperties & { parent?: string };

export class TaskIndex {
  private readonly tasksByPath = new Map<string, Task[]>();
  private readonly headingsByPath = new Map<string, NoteHeading[]>();
  private readonly projectProperties = new Map<string, ProjectEntry>();
  private readonly archivedPaths = new Set<string>();
  private readonly projectPaths = new Set<string>();
  private readonly listeners = new Set<IndexListener>();
  // Obsidian's offref only removes listeners from the emitter it is called on.
  private readonly eventRefs: Array<[Events, EventRef]> = [];
  private destroyed = false;
  // The latest scan of each path wins, even if an older read finishes later.
  private readonly scanTokens = new Map<string, number>();
  private scanCount = 0;
  // cachedRead can still serve a note deleted before its startup batch runs.
  private readonly deletedPaths = new Set<string>();
  // The content each note was last parsed from. cachedRead returns Obsidian's cached
  // string, so this mostly shares memory with the vault cache rather than copying it.
  private readonly indexedContent = new Map<string, { content: string; day: string }>();
  // Refreshes of one path requested in the same microtask share a single scan.
  private readonly pendingRefreshes = new Map<string, { file: TFile; force: boolean; promise: Promise<void> }>();
  // Derived from tasksByPath; rebuilt lazily after any change.
  private sortedTasks?: Task[];
  private tasksById?: Map<string, Task>;
  private tagSummaryCache?: TaskTagSummary[];
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
    // A plugin unloaded before layout-ready must not register listeners nothing will remove.
    if (this.destroyed) return;
    const { vault, metadataCache } = this.app;
    // Listen first so edits made while the vault is scanned are not missed.
    this.listen(vault, vault.on("create", (file) => {
      this.invalidateTags();
      this.deletedPaths.delete(file.path);
      if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
    }));
    this.listen(vault, vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
    }));
    this.listen(vault, vault.on("delete", (file) => {
      this.invalidateTags();
      if (file instanceof TFile && file.extension === "md") {
        this.deletedPaths.add(file.path);
        this.forget(file.path);
        this.emit();
      }
    }));
    this.listen(vault, vault.on("rename", (file, oldPath) => {
      this.invalidateTags();
      if (file instanceof TFile && file.extension === "md") {
        this.deletedPaths.delete(file.path);
        this.forget(oldPath);
        void this.refreshFile(file);
      }
    }));
    this.listen(metadataCache, metadataCache.on("changed", (file) => {
      // Every save reaches here; only project membership and properties come from metadata.
      if (file.extension === "md" && !this.isDeleted(file, file.path) && this.updateProjectStatus(file)) this.emit();
    }));
    // All Tasks and project/tag discovery require every Markdown note.
    if (await this.scanAll(vault.getMarkdownFiles(), false)) this.emit();
  }

  /** Scan every Markdown note again in yielding batches, and notify listeners once. */
  async rescanAll(options: RefreshOptions = {}): Promise<void> {
    if (await this.scanAll(this.app.vault.getMarkdownFiles(), options.force ?? true)) this.emit();
  }

  destroy(): void {
    this.destroyed = true;
    for (const [emitter, eventRef] of this.eventRefs) emitter.offref(eventRef);
    this.eventRefs.length = 0;
    this.pendingRefreshes.clear();
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

  /** Tag names with open and completed counts, cached until tasks change. Do not modify. */
  tagSummaries(): readonly TaskTagSummary[] {
    this.tagSummaryCache ??= taskTagSummaries(this.sortedAllTasks());
    return this.tagSummaryCache;
  }

  private sortedAllTasks(): Task[] {
    this.sortedTasks ??= sortTasks([...this.tasksByPath.values()].flat());
    return this.sortedTasks;
  }

  private listen(emitter: Events, eventRef: EventRef): void {
    this.eventRefs.push([emitter, eventRef]);
  }

  private invalidateTasks(): void {
    this.sortedTasks = undefined;
    this.tasksById = undefined;
    this.tagSummaryCache = undefined;
    this.invalidateTags();
  }

  private invalidateTags(): void {
    this.tagLinks.clear();
    this.tagsByPath = undefined;
    this.filesByTag = undefined;
  }

  private forget(path: string): void {
    this.scanTokens.delete(path);
    this.indexedContent.delete(path);
    this.tasksByPath.delete(path);
    this.invalidateTasks();
    this.headingsByPath.delete(path);
    this.projectPaths.delete(path);
    this.projectProperties.delete(path);
    this.archivedPaths.delete(path);
  }

  private isDeleted(file: TFile, path: string): boolean {
    return this.deletedPaths.has(path) || (file as TFile & { deleted?: boolean }).deleted === true;
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

  /** Accepts a note, a note path, or a destination such as "Work.md#Section". */
  async refreshPath(target: string | TFile, options: RefreshOptions = {}): Promise<void> {
    const file = target instanceof TFile ? target : this.resolveDestination(target);
    if (file) await this.refreshFile(file, options.force);
  }

  /** Prefer an exact note path, so "C# notes.md" is not read as note "C" with heading " notes.md". */
  private resolveDestination(destination: string): TFile | undefined {
    const vault = this.app.vault;
    const exact = vault.getAbstractFileByPath(destination);
    if (exact instanceof TFile) return exact;
    for (let separator = destination.lastIndexOf("#"); separator > 0; separator = destination.lastIndexOf("#", separator - 1)) {
      const path = destination.slice(0, separator).trim();
      const file = vault.getAbstractFileByPath(/\.md$/i.test(path) ? path : `${path}.md`);
      if (file instanceof TFile) return file;
    }
    const file = vault.getAbstractFileByPath(splitDestination(destination).path);
    return file instanceof TFile ? file : undefined;
  }

  private refreshFile(file: TFile, force = false): Promise<void> {
    const path = file.path;
    const pending = this.pendingRefreshes.get(path);
    if (pending?.file === file) {
      pending.force ||= force;
      return pending.promise;
    }
    const entry = { file, force, promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(async () => {
      if (this.pendingRefreshes.get(path) === entry) this.pendingRefreshes.delete(path);
      if (this.destroyed) return;
      const scanned = await this.scanFile(file, entry.force);
      if (this.destroyed || this.isDeleted(file, file.path)) return;
      const statusChanged = this.updateProjectStatus(file);
      if (scanned || statusChanged) this.emit();
    });
    this.pendingRefreshes.set(path, entry);
    return entry.promise;
  }

  /** Scan notes in batches, yielding between them so a large vault does not freeze the app. */
  private async scanAll(files: TFile[], force: boolean): Promise<boolean> {
    let yielded = performance.now();
    for (let start = 0; start < files.length; start += SCAN_BATCH) {
      if (this.destroyed) return false;
      // One unreadable note (for example, deleted mid-scan) must not stop the rest.
      await Promise.all(files.slice(start, start + SCAN_BATCH).map((file) => this.scanFile(file, force)
        .catch((error: unknown) => console.error(`Task manager could not index ${file.path}`, error))));
      if (performance.now() - yielded > SCAN_SLICE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
    if (this.destroyed) return false;
    // Update in place: notes created while scanning already have their status from the create event.
    for (const file of files) if (!this.isDeleted(file, file.path)) this.updateProjectStatus(file);
    return true;
  }

  /** Returns whether the note was parsed; unchanged content is skipped unless forced. */
  private async scanFile(file: TFile, force = false): Promise<boolean> {
    const path = file.path;
    const token = ++this.scanCount;
    this.scanTokens.set(path, token);
    const content = await this.app.vault.cachedRead(file);
    if (this.scanTokens.get(path) !== token) return false;
    if (file.path !== path || this.isDeleted(file, path)) {
      this.scanTokens.delete(path);
      return false;
    }
    // Relative dates such as "tomorrow" resolve against the scan day, so a new day parses again.
    const day = new Date().toDateString();
    const previous = this.indexedContent.get(path);
    if (!force && previous?.content === content && previous.day === day) return false;
    const level = this.getSettings().sectionHeadingLevel;
    const headings = scanSections(content, level);
    const tasks = scanTasks(path, content, new Date(), this.getDateFormat(), level);
    this.indexedContent.set(path, { content, day });
    this.headingsByPath.set(path, headings);
    this.tasksByPath.set(path, tasks);
    this.invalidateTasks();
    return true;
  }

  /** Returns whether project membership, archive status, or project properties changed. */
  private updateProjectStatus(file: TFile): boolean {
    const path = file.path;
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    const wasArchived = this.archivedPaths.has(path);
    const archived = Boolean(tags?.includes("#archived"));
    if (archived) this.archivedPaths.add(path);
    else this.archivedPaths.delete(path);
    const previous = this.projectProperties.get(path);
    if (tags?.some((tag) => tag === "#project" || tag.startsWith("#project/"))) {
      const wasProject = this.projectPaths.has(path);
      const properties: ProjectEntry = { ...parseProjectProperties(cache?.frontmatter, this.getDateFormat()), parent: parseProjectParent(cache?.frontmatter) };
      this.projectPaths.add(path);
      this.projectProperties.set(path, properties);
      return wasArchived !== archived || !wasProject || JSON.stringify(previous) !== JSON.stringify(properties);
    }
    const wasProject = this.projectPaths.delete(path);
    this.projectProperties.delete(path);
    return wasArchived !== archived || wasProject;
  }

  private emit(): void {
    this.invalidateTags();
    for (const listener of this.listeners) listener();
  }
}
