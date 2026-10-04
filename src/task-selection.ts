import type { Task } from "./types";

/** Selection follows visible order, while snapshots prevent stale IDs selecting other tasks. */
export class TaskSelection {
  private selected = new Map<string, Task>();
  private anchor?: string;
  clear(): void { this.selected.clear(); this.anchor = undefined; }
  /** Selects exactly these tasks, the last one as the anchor for Shift ranges. */
  select(tasks: Task[]): void {
    this.selected = new Map(tasks.map(task => [task.id, task]));
    this.anchor = tasks[tasks.length - 1]?.id;
  }
  has(task: Task): boolean { return this.selected.get(task.id)?.raw === task.raw; }
  tasks(visible: Task[]): Task[] { return visible.filter(task => this.has(task)); }
  /** The selected tasks among `visible` (matched by id), as they were selected or last replaced. */
  chosen(visible: Task[]): Task[] { return visible.flatMap(task => this.selected.get(task.id) ?? []); }
  /** Puts `next`, the same task rewritten, in the place of `task` when it is selected. */
  replace(task: Task, next: Task): void {
    if (!this.has(task)) return;
    this.selected.delete(task.id);
    this.selected.set(next.id, next);
    if (this.anchor === task.id) this.anchor = next.id;
  }
  retain(visible: Task[]): void {
    const current = new Map(visible.map(task => [task.id, task]));
    for (const [id, task] of this.selected) if (current.get(id)?.raw !== task.raw) this.selected.delete(id);
    if (!this.selected.has(this.anchor ?? "")) this.anchor = undefined;
  }
  click(task: Task, visible: Task[], shift = false, additive = false): void {
    const start = visible.findIndex(item => item.id === this.anchor);
    const end = visible.findIndex(item => item.id === task.id);
    if (shift && start >= 0 && end >= 0) {
      if (!additive) this.selected.clear();
      for (const item of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) this.selected.set(item.id, item);
    } else {
      if (!additive) this.selected.clear();
      if (additive && this.has(task)) {
        this.selected.delete(task.id);
        if (this.anchor === task.id) this.anchor = undefined;
      } else {
        this.selected.set(task.id, task);
        this.anchor = task.id;
      }
    }
  }
}
