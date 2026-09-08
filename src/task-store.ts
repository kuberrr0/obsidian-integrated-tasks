import { newTaskLines } from "./task-description";
import { planBulkTasks, type BulkTaskPatch, type BulkTaskOptions } from "./bulk-tasks";
import { draftForGroup, type ListDropGroup } from "./list-drag";
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
import type { Task, TaskDraft, TaskManagerSettings } from "./types";

export class TaskStore {
  constructor(
    private readonly app: App,
    private readonly getDateFormat: () => string,
    private readonly getNewTaskPosition: () => TaskManagerSettings["newTaskPosition"] = () => "top",
    private readonly getLinkDates: () => boolean = () => true
  ) {}

  async toggle(task: Task, completed: boolean): Promise<void> {
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => toggleTaskInContent(content, task, completed));
  }

  async delete(task: Task): Promise<void> {
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, content => {
      const block = liveTaskBlock(content, task, this.getDateFormat());
      return removeTaskBlockFromContent(content, task, block.lines.length);
    });
  }

  async create(draft: TaskDraft): Promise<void> {
    const { path, heading } = splitDestination(draft.destination);
    const file = heading ? this.requireFile(path) : await this.ensureFile(path);
    await this.app.vault.process(file, (content) =>
      insertIntoDestination(content, newTaskLines(draft, this.getDateFormat(), this.getLinkDates()), heading, this.getNewTaskPosition())
    );
  }

  async update(task: Task, draft: TaskDraft): Promise<void> {
    if (draft.description !== undefined && draft.description !== (task.description ?? "")) {
      await this.bulkChange([task], () => draft);
      return;
    }
    const destination = splitDestination(draft.destination);
    if (normalizePath(destination.path) !== task.path || destination.heading !== task.section) {
      await this.move(task, draft);
      return;
    }

    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => updateTaskInContent(content, task, draft, this.getDateFormat(), this.getLinkDates()));
  }

  async relocate(task: Task, anchor: Task, placement: ListPlacement, draft: TaskDraft): Promise<void> {
    const source = this.requireFile(task.path);
    const target = this.requireFile(anchor.path);
    if (source.path === target.path) {
      await this.app.vault.process(source, content => {
        const block = liveTaskBlock(content, task, this.getDateFormat());
        const destination = liveTaskBlock(content, anchor, this.getDateFormat());
        const indent = destination.indent + (placement === "child" ? 2 : 0);
        return placeTaskBlock(content, task, anchor, placement, rewriteBlock(block, draft, indent, this.getDateFormat(), this.getLinkDates()), this.getDateFormat());
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
      after = placeTaskBlock(current, undefined, anchor, placement, rewriteBlock(block, draft, destination.indent + (placement === "child" ? 2 : 0), this.getDateFormat(), this.getLinkDates()), this.getDateFormat());
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
          rewriteBlock(block, draft, 0, this.getDateFormat(), this.getLinkDates()), heading, this.getNewTaskPosition());
      });
      return;
    }
    const content = await this.app.vault.read(source);
    const block = liveTaskBlock(content, task, this.getDateFormat());
    let before = "";
    let after = "";
    await this.app.vault.process(target, current => {
      before = current;
      after = insertIntoDestination(current, rewriteBlock(block, draft, 0, this.getDateFormat(), this.getLinkDates()), heading, this.getNewTaskPosition());
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

  async bulkUpdate(tasks: Task[], patch: BulkTaskPatch): Promise<string[]> {
    if (!Object.keys(patch).length) return [];
    return this.bulkChange(tasks, task => ({ ...draftForGroup(task), ...patch }));
  }

  async bulkDelete(tasks: Task[]): Promise<string[]> {
    return this.bulkChange(tasks, () => undefined, { delete: true });
  }

  async bulkDrop(tasks: Task[], group?: ListDropGroup, anchor?: Task, placement?: ListPlacement): Promise<string[]> {
    return this.bulkChange(tasks, task => draftForGroup(task, group), { anchor, placement });
  }

  async bulkChange(tasks: Task[], draft: (task: Task) => TaskDraft | undefined, options: BulkTaskOptions = {}): Promise<string[]> {
    const changes = tasks.map(task => ({ task, draft: draft(task) }));
    const files = new Map<string, TFile>();
    for (const task of tasks) files.set(task.path, this.requireFile(task.path));
    if (options.anchor) files.set(options.anchor.path, this.requireFile(options.anchor.path));
    for (const change of changes) if (change.draft && !options.anchor) {
      const { path, heading } = splitDestination(change.draft.destination);
      if (!files.has(path)) files.set(path, heading ? this.requireFile(path) : await this.ensureFile(path));
    }
    const before = new Map(await Promise.all([...files].map(async ([path, file]) => [path, await this.app.vault.read(file)] as const)));
    const after = planBulkTasks(before, changes, { ...options, dateFormat: this.getDateFormat(), position: this.getNewTaskPosition(), linkDates: this.getLinkDates() });
    const written: string[] = [];
    try {
      for (const [path, content] of after) {
        await this.app.vault.process(files.get(path)!, current => {
          if (current !== before.get(path)) throw new Error("A note changed during the bulk action. Refresh and try again.");
          return content;
        });
        written.push(path);
      }
    } catch (cause) {
      const conflicts: string[] = [];
      for (const path of written.reverse()) {
        try {
          await this.app.vault.process(files.get(path)!, current => {
            if (current !== after.get(path)) throw new Error("Note changed");
            return before.get(path)!;
          });
        } catch { conflicts.push(path); }
      }
      if (conflicts.length) throw new Error(`Bulk action interrupted. Could not restore changed notes: ${conflicts.join(", ")}. Review those notes before retrying.`);
      throw cause;
    }
    return [...after.keys()];
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
