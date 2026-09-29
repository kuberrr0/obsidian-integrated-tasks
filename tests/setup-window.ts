// Obsidian always runs with a window, and the plugin schedules its timers on it (for popout windows).
// Tests in the node environment get the global object in its place, so fake timers still apply.
const scope = globalThis as unknown as Record<string, unknown>;
scope.window ??= globalThis;

export {};
