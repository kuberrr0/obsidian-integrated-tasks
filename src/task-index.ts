import { parseProjectProperties } from "./project-properties";
import { scanHeadings, splitDestination, type NoteHeading } from "./structure";
import { getAllTags, type App, type EventRef, TFile } from "obsidian";
import { scanTasks } from "./parser";
import { sortTasks, taskMatchesQuery } from "./query";
import type { Project, ProjectProperties, Task, TaskManagerSettings, TaskQuery } from "./types";

export type IndexListener = () => void;

export class TaskIndex {
  private readonly tasksByPath = new Map<string, Task[]>();
  private readonly headingsByPath = new Map<string, NoteHeading[]>();
  private readonly projectProperties = new Map<string, ProjectProperties>();
  private readonly archivedPaths = new Set<string>();
  private readonly projectPaths = new Set<string>();
  private readonly listeners = new Set<IndexListener>();
  private readonly eventRefs: EventRef[] = [];

  constructor(
    private readonly app: App,
    private readonly getSettings: () => TaskManagerSettings,
    private readonly getDateFormat: () => string
  ) {}

  async initialize(): Promise<void> {
    await Promise.all(this.app.vault.getMarkdownFiles().map((file) => this.scanFile(file)));
    this.refreshProjects();
    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.tasksByPath.delete(file.path);
          this.headingsByPath.delete(file.path);
          this.projectPaths.delete(file.path);
          this.projectProperties.delete(file.path);
          this.archivedPaths.delete(file.path);
          this.emit();
        }
      }),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.tasksByPath.delete(oldPath);
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
  }

  destroy(): void {
    for (const eventRef of this.eventRefs) this.app.vault.offref(eventRef);
    this.eventRefs.length = 0;
    this.listeners.clear();
  }

  subscribe(listener: IndexListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  allTasks(): Task[] {
    return sortTasks([...this.tasksByPath.values()].flat());
  }

  tasksForPath(path: string): Task[] {
    return this.tasksByPath.get(path) ?? [];
  }

  taskById(id: string): Task | undefined {
    return this.allTasks().find((task) => task.id === id);
  }

  query(query: TaskQuery, now = new Date()): Task[] {
    return sortTasks(
      this.allTasks().filter((task) => taskMatchesQuery(task, query, this.getSettings().inboxPath, now))
    );
  }

  projects(): Project[] {
    return [...this.projectPaths]
      .map((path) => {
        const tasks = this.tasksForPath(path);
        return {
          ...this.projectProperties.get(path),
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
    const content = await this.app.vault.cachedRead(file);
    this.headingsByPath.set(file.path, scanHeadings(content));
    this.tasksByPath.set(file.path, scanTasks(file.path, content, new Date(), this.getDateFormat()));
  }

  private refreshProjects(): void {
    this.projectPaths.clear();
    this.projectProperties.clear();
    this.archivedPaths.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.updateProjectStatus(file);
  }

  private updateProjectStatus(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    if (tags?.includes("#archived")) this.archivedPaths.add(file.path);
    else this.archivedPaths.delete(file.path);
    if (tags?.some((tag) => tag === "#project" || tag.startsWith("#project/"))) {
      this.projectPaths.add(file.path);
      this.projectProperties.set(file.path, parseProjectProperties(cache?.frontmatter, this.getDateFormat()));
    } else {
      this.projectPaths.delete(file.path);
      this.projectProperties.delete(file.path);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
