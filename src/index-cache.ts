import type { App } from "obsidian";
import type { NoteHeading } from "./structure";
import type { Task } from "./types";

/** Bump whenever the Task shape or note parsing changes, so older records are parsed again. */
export const CACHE_SCHEMA = 2;

/** A task without its path-derived fields; parent and children are stored as line numbers. */
export type CachedTask = Omit<Task, "id" | "path" | "parentId" | "childIds"> & { parentId?: number; childIds?: number[] };

export interface CachedNote {
  path: string;
  mtime: number;
  size: number;
  schema: number;
  dateFormat: string;
  /** The Tag format the note was read with; a note read with the other must be read again. */
  tagFormat?: string;
  sectionHeadingLevel: number;
  /** Set when a task used a relative date, which only holds on the day it was parsed. */
  day?: string;
  tasks: CachedTask[];
  headings: NoteHeading[];
}

export interface IndexCache {
  load(): Promise<Map<string, CachedNote>>;
  put(notes: CachedNote[]): Promise<void>;
  delete(paths: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface NoteScan {
  mtime: number;
  size: number;
  dateFormat: string;
  /** The Tag format the note was read with; a note read with the other must be read again. */
  tagFormat?: string;
  sectionHeadingLevel: number;
  /** Local ISO date the note was parsed on. */
  day: string;
}

const RELATIVE = /\b(?:today|tomorrow|yesterday|tonight|next|last|this|ago|in\s+\d+|noon|midnight|morning|evening|weekends?|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i;
// Year-less dates such as "Oct 30", "30th" or "10/30" resolve to their next occurrence.
const YEARLESS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}[/.-]\d{1,2}\b(?![/.-]\d)/i;

/** Whether any task's dates depend on the day they were parsed. */
function usesRelativeDates(tasks: readonly Task[], dateFormat: string): boolean {
  const yearlessFormat = dateFormat !== "" && !/[YyGg]/.test(dateFormat);
  for (const task of tasks) {
    if (yearlessFormat && (task.scheduledDate || task.deadline || task.deferDate || task.completedDate)) return true;
    if (!task.deadline && !task.deferDate && !task.completedDate) continue;
    const start = task.raw.search(/[{>✓]/);
    if (start < 0) continue;
    const tokens = task.raw.slice(start);
    if (RELATIVE.test(tokens) || (YEARLESS.test(tokens) && !/\d{4}/.test(tokens))) return true;
  }
  return false;
}

/** Builds a compact record from already-parsed tasks. */
export function noteRecord(path: string, scan: NoteScan, tasks: readonly Task[], headings: NoteHeading[]): CachedNote {
  const line = (id: string): number => Number(id.slice(id.lastIndexOf(":") + 1));
  const compact = tasks.map((task) => {
    const record: Record<string, unknown> = {};
    for (const key in task) {
      const value = task[key as keyof Task];
      if (value === undefined || key === "id" || key === "path") continue;
      if (key === "parentId") record.parentId = line(value as string);
      else if (key === "childIds") { if ((value as string[]).length) record.childIds = (value as string[]).map(line); }
      else record[key] = value;
    }
    return record as CachedTask;
  });
  const { day, ...rest } = scan;
  return { path, ...rest, schema: CACHE_SCHEMA, ...(usesRelativeDates(tasks, scan.dateFormat) ? { day } : {}), tasks: compact, headings };
}

/** Restores tasks exactly as scanTasks returns them, including its explicitly undefined fields. */
export function restoreTasks(note: CachedNote): Task[] {
  const path = note.path;
  return note.tasks.map(({ parentId, childIds, ...task }) => ({
    id: `${path}:${task.line}`,
    path,
    section: undefined,
    sectionLine: undefined,
    childIds: childIds?.map((line) => `${path}:${line}`) ?? [],
    parentId: parentId === undefined ? undefined : `${path}:${parentId}`,
    ...task
  }));
}

/** For tests, and wherever IndexedDB is unavailable. Stores copies, as IndexedDB does. */
export class MemoryIndexCache implements IndexCache {
  readonly notes = new Map<string, CachedNote>();

  async load(): Promise<Map<string, CachedNote>> {
    return new Map([...this.notes].map(([path, note]) => [path, structuredClone(note)]));
  }

  async put(notes: CachedNote[]): Promise<void> {
    for (const note of notes) this.notes.set(note.path, structuredClone(note));
  }

  async delete(paths: string[]): Promise<void> {
    for (const path of paths) this.notes.delete(path);
  }

  async clear(): Promise<void> {
    this.notes.clear();
  }
}

const STORE = "notes";

function defaultFactory(): IDBFactory | undefined {
  // Reading indexedDB throws in some sandboxed and private contexts.
  try { return globalThis.indexedDB ?? undefined; } catch { return undefined; }
}

/** Kept outside the vault so sync services do not copy it or churn on every edit. Any failure means no cache. */
export class IndexedDbCache implements IndexCache {
  readonly name: string;
  private database?: Promise<IDBDatabase | undefined>;
  private warned = false;

  constructor(app: App, private readonly factory: IDBFactory | undefined = defaultFactory()) {
    this.name = `integrated-task-manager-index:${(app as { appId?: string }).appId ?? app.vault?.getName?.() ?? "vault"}`;
  }

  async load(): Promise<Map<string, CachedNote>> {
    const notes = new Map<string, CachedNote>();
    const db = await this.open();
    if (!db) return notes;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = () => {
          for (const note of request.result as CachedNote[]) notes.set(note.path, note);
          resolve(notes);
        };
        request.onerror = () => { this.fail(request.error); resolve(notes); };
      } catch (error) {
        this.fail(error);
        resolve(notes);
      }
    });
  }

  put(notes: CachedNote[]): Promise<void> {
    return this.write((store) => { for (const note of notes) store.put(note); });
  }

  delete(paths: string[]): Promise<void> {
    return this.write((store) => { for (const path of paths) store.delete(path); });
  }

  clear(): Promise<void> {
    return this.write((store) => store.clear());
  }

  private open(): Promise<IDBDatabase | undefined> {
    this.database ??= new Promise((resolve) => {
      let settled = false;
      const settle = (db: IDBDatabase | undefined, error?: unknown): void => {
        if (settled) { db?.close(); return; }
        settled = true;
        if (!db) this.fail(error);
        resolve(db);
      };
      try {
        if (!this.factory) { settle(undefined, new Error("IndexedDB is unavailable")); return; }
        const request = this.factory.open(this.name, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "path" });
        };
        request.onsuccess = () => {
          const db = request.result;
          // Let a newer plugin version upgrade the database; this session then runs without a cache.
          db.onversionchange = () => db.close();
          settle(db);
        };
        request.onerror = () => settle(undefined, request.error);
        request.onblocked = () => settle(undefined, new Error("IndexedDB upgrade is blocked"));
      } catch (error) {
        settle(undefined, error);
      }
    });
    return this.database;
  }

  private async write(run: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      let transaction: IDBTransaction | undefined;
      try {
        transaction = db.transaction(STORE, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => { this.fail(transaction?.error); resolve(); };
        run(transaction.objectStore(STORE));
      } catch (error) {
        try { transaction?.abort(); } catch { /* already finished */ }
        this.fail(error);
        resolve();
      }
    });
  }

  private fail(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn("Task manager could not use its index cache; notes will be read in full.", error);
  }
}
