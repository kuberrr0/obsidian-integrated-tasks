import { splitDestination } from "./structure";
import { normalizePath, type App, TFile, TFolder } from "obsidian";
import {
  insertIntoDestination,
  findLiveLine,
  removeTaskBlockFromContent,
  toggleTaskInContent,
  updateTaskInContent
} from "./markdown";
import { serializeTask } from "./parser";
import type { Task, TaskDraft, TaskManagerSettings } from "./types";

export class TaskStore {
  constructor(
    private readonly app: App,
    private readonly getDateFormat: () => string,
    private readonly getNewTaskPosition: () => TaskManagerSettings["newTaskPosition"] = () => "top"
  ) {}

  async toggle(task: Task, completed: boolean): Promise<void> {
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => toggleTaskInContent(content, task, completed));
  }

  async create(draft: TaskDraft): Promise<void> {
    const { path, heading } = splitDestination(draft.destination);
    const file = heading ? this.requireFile(path) : await this.ensureFile(path);
    const rootDraft = { ...draft, indent: 0 };
    await this.app.vault.process(file, (content) =>
      insertIntoDestination(content, [serializeTask(rootDraft, this.getDateFormat())], heading, this.getNewTaskPosition())
    );
  }

  async update(task: Task, draft: TaskDraft): Promise<void> {
    const destination = splitDestination(draft.destination);
    if (normalizePath(destination.path) !== task.path || destination.heading !== task.section) {
      await this.move(task, draft);
      return;
    }

    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => updateTaskInContent(content, task, draft, this.getDateFormat()));
  }

  private async move(task: Task, draft: TaskDraft): Promise<void> {
    const source = this.requireFile(task.path);
    const { path, heading } = splitDestination(draft.destination);
    const target = heading ? this.requireFile(path) : await this.ensureFile(path);
    const sourceContent = await this.app.vault.read(source);
    const sourceLines = sourceContent.split(/\r?\n/);
    const liveLine = findLiveLine(sourceLines, task);
    const lineOffset = liveLine - task.line;
    const liveEnd = Math.min(sourceLines.length - 1, task.endLine + lineOffset);
    const descendants = sourceLines.slice(liveLine + 1, liveEnd + 1).map((line) => {
      let remaining = task.indent;
      let cursor = 0;
      while (remaining > 0 && cursor < line.length && line[cursor] === " ") {
        remaining -= 1;
        cursor += 1;
      }
      return line.slice(cursor);
    });
    const block = [serializeTask({ ...draft, indent: 0 }, this.getDateFormat()), ...descendants];

    if (source.path === target.path) {
      await this.app.vault.process(source, (content) =>
        insertIntoDestination(removeTaskBlockFromContent(content, task, block.length), block, heading, this.getNewTaskPosition())
      );
      return;
    }
    await this.app.vault.process(target, (content) => insertIntoDestination(content, block, heading, this.getNewTaskPosition()));
    await this.app.vault.process(source, (content) => removeTaskBlockFromContent(content, task, block.length));
  }

  private requireFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Cannot find note: ${path}`);
    return file;
  }

  private async ensureFile(path: string): Promise<TFile> {
    const normalized = normalizePath(path.endsWith(".md") ? path : `${path}.md`);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error(`${normalized} is not a Markdown file.`);

    const parts = normalized.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(current);
      if (!folder) await this.app.vault.createFolder(current);
      else if (!(folder instanceof TFolder)) throw new Error(`${current} is not a folder.`);
    }
    return this.app.vault.create(normalized, "");
  }
}
