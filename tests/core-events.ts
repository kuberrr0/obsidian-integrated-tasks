/** Mimics Obsidian's Events: offref only removes listeners registered on the same emitter. */
export class FakeEvents {
  private readonly handlers = new Map<string, Array<{ callback: (...args: never[]) => unknown; ref: object }>>();

  on(name: string, callback: (...args: never[]) => unknown): object {
    const ref = { e: this, name };
    const list = this.handlers.get(name) ?? [];
    list.push({ callback, ref });
    this.handlers.set(name, list);
    return ref;
  }

  offref(ref: object): void {
    for (const [name, list] of this.handlers) this.handlers.set(name, list.filter(entry => entry.ref !== ref));
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const { callback } of [...this.handlers.get(name) ?? []]) (callback as (...values: unknown[]) => unknown)(...args);
  }

  listenerCount(name?: string): number {
    if (name) return this.handlers.get(name)?.length ?? 0;
    return [...this.handlers.values()].reduce((total, list) => total + list.length, 0);
  }
}

/** Let queued microtasks and zero-delay timers run. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
