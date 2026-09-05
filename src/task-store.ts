import { liveTaskBlock, rewriteBlock, placeTaskBlock } from "./task-block";
import type { ListPlacement } from "./list-drag";
import { splitDestination } from "./structure";
import { normalizePath, type App, TFile, TFolder } from "obsidian";
import {
  insertIntoDestination,
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

  async relocate(task: Task, anchor: Task, placement: ListPlacement, draft: TaskDraft): Promise<void> {
    const source = this.requireFile(task.path);
    const target = this.requireFile(anchor.path);
    if (source.path === target.path) {
      await this.app.vault.process(source, content => {
        const block = liveTaskBlock(content, task, this.getDateFormat());
        const destination = liveTaskBlock(content, anchor, this.getDateFormat());
        const indent = destination.indent + (placement === "child" ? 2 : 0);
        return placeTaskBlock(content, task, anchor, placement, rewriteBlock(block, draft, indent, this.getDateFormat()), this.getDateFormat());
      });
      return;
    }
    const content = await this.app.vault.read(source);
    const block = liveTaskBlock(content, task, this.getDateFormat());
    let before = "";
    let after = "";
    await this.app.vault.process(target, current => {
      before = current;
      const destination = liveTaskBlock(current, anchor, this.getDateFormat());
      after = placeTaskBlock(current, undefined, anchor, placement, rewriteBlock(block, draft, destination.indent + (placement === "child" ? 2 : 0), this.getDateFormat()), this.getDateFormat());
      return after;
    });
    try {
      await this.app.vault.process(source, current => {
        const latest = liveTaskBlock(current, task, this.getDateFormat());
        if (latest.lines.join("\n") !== block.lines.join("\n")) throw new Error("Task changed while moving. Try again.");
        return removeTaskBlockFromContent(current, task, latest.lines.length);
      });
    } catch (cause) {
      await this.app.vault.process(target, current => {
        if (current !== after) throw new Error("Source task was kept, but the destination changed during the move. Check the destination for a duplicate.");
        return before;
      });
      throw cause;
    }
  }

  private async move(task: Task, draft: TaskDraft): Promise<void> {
    const source = this.requireFile(task.path);
    const { path, heading } = splitDestination(draft.destination);
    const target = heading ? this.requireFile(path) : await this.ensureFile(path);
    if (source.path === target.path) {
      await this.app.vault.process(source, content => {
        const block = liveTaskBlock(content, task, this.getDateFormat());
        return insertIntoDestination(removeTaskBlockFromContent(content, task, block.lines.length),
          rewriteBlock(block, draft, 0, this.getDateFormat()), heading, this.getNewTaskPosition());
      });
      return;
    }
    const content = await this.app.vault.read(source);
    const block = liveTaskBlock(content, task, this.getDateFormat());
    let before = "";
    let after = "";
    await this.app.vault.process(target, current => {
      before = current;
      after = insertIntoDestination(current, rewriteBlock(block, draft, 0, this.getDateFormat()), heading, this.getNewTaskPosition());
      return after;
    });
    try {
      await this.app.vault.process(source, current => {
        const latest = liveTaskBlock(current, task, this.getDateFormat());
        if (latest.lines.join("\n") !== block.lines.join("\n")) throw new Error("Task changed while moving. Try again.");
        return removeTaskBlockFromContent(current, task, latest.lines.length);
      });
    } catch (cause) {
      await this.app.vault.process(target, current => {
        if (current !== after) throw new Error("Source task was kept, but the destination changed during the move. Check the destination for a duplicate.");
        return before;
      });
      throw cause;
    }
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
