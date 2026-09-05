import type { Project } from "./types";

/** Stable parent-first ordering; missing parents and cycles remain visible as roots. */
export function projectHierarchy(projects: Project[]): { project: Project; depth: number }[] {
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const visible = new Set(ordered.map(project => project.path));
  const parents = new Map(ordered.map(project => [project.path, project.parentPath && visible.has(project.parentPath) ? project.parentPath : undefined]));
  const checked = new Set<string>();
  for (const project of ordered) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let path: string | undefined = project.path;
    while (path && !checked.has(path)) {
      const cycle = positions.get(path);
      if (cycle !== undefined) {
        for (const member of chain.slice(cycle)) parents.set(member, undefined);
        break;
      }
      positions.set(path, chain.length);
      chain.push(path);
      path = parents.get(path);
    }
    for (const member of chain) checked.add(member);
  }
  const children = new Map<string | undefined, Project[]>();
  for (const project of ordered) {
    const parent = parents.get(project.path);
    const group = children.get(parent) ?? [];
    group.push(project);
    children.set(parent, group);
  }
  const result: { project: Project; depth: number }[] = [];
  const pending = (children.get(undefined) ?? []).map(project => ({ project, depth: 0 })).reverse();
  while (pending.length) {
    const entry = pending.pop()!;
    result.push(entry);
    for (const child of [...(children.get(entry.project.path) ?? [])].reverse()) pending.push({ project: child, depth: entry.depth + 1 });
  }
  return result;
}
