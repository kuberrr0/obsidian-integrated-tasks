import type { TaskFilter } from "./types";

export function cloneTaskFilters(filters: readonly TaskFilter[]): TaskFilter[] {
  return filters.map(filter => ({
    ...filter,
    values: [...filter.values],
    ...(filter.conditions ? {
      conditions: filter.conditions.map(condition => ({ ...condition, values: [...condition.values] }))
    } : {})
  }));
}
