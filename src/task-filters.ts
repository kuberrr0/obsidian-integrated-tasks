import type { SmartList, SmartListScope, TaskFilter } from "./types";

export function cloneTaskFilters(filters: readonly TaskFilter[]): TaskFilter[] {
  return filters.map(filter => ({
    ...filter,
    values: [...filter.values],
    ...(filter.conditions ? {
      conditions: filter.conditions.map(condition => ({ ...condition, values: [...condition.values] }))
    } : {})
  }));
}

/** A smart list's saved values, without its id: its name, filters (copied), sorting and grouping. */
export type SmartListDraft = Omit<SmartList, "id">;
export function smartListDraft(list?: SmartList): SmartListDraft {
  return list ? { name: list.name, filters: cloneTaskFilters(list.filters), sort: list.sort, descending: list.descending, grouping: list.grouping,
    ...(list.showProjects === false ? { showProjects: false } : {}), ...(list.scope ? { scope: list.scope } : {}) }
    : { name: "", filters: [], sort: "date", descending: false, grouping: "default" };
}

/** The view a smart list narrows, by name: "Today", a project's or a tag's. */
export function smartListScopeLabel(scope: SmartListScope): string {
  if (scope.mode === "project") return scope.path.replace(/\.md$/i, "").split("/").pop() ?? scope.path;
  if (scope.mode === "tag") return scope.tag ?? scope.path?.replace(/\.md$/i, "").split("/").pop() ?? "Tag";
  return { inbox: "Inbox", today: "Today", upcoming: "Upcoming" }[scope.mode];
}
