import type { SmartList, TaskFilter } from "./types";

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
  return list ? { name: list.name, filters: cloneTaskFilters(list.filters), sort: list.sort, descending: list.descending, grouping: list.grouping, ...(list.showProjects === false ? { showProjects: false } : {}) }
    : { name: "", filters: [], sort: "date", descending: false, grouping: "default" };
}
