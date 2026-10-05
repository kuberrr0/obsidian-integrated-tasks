import type { CachedNote, IndexCache } from "../../src/index-cache";

/** An index cache in memory. Stores copies, as IndexedDB does. */
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
