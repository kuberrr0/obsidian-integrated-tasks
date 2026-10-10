import type { CalendarScope } from "./calendar";
import { parseDateExpression, parseTimeExpression, todayIso } from "./date";
import { durationToMinutes } from "./parser";
import { TASK_PROPERTIES } from "./task-properties";
import { STATUS_LABELS, statusFromLabel } from "./task-status";
import type { FilterOperator, SmartList, TaskFilter, TaskGrouping, TaskProperty, TaskQuery, TaskSort } from "./types";

/** How a block lays its tasks out: rows, a board's columns (one per group), or a calendar. */
export type TaskQueryLayout = "list" | "board" | "calendar";

/**
 * A ```task-query block: one `key: value` per line, such as `view: today`, `tags: work`,
 * `deadline: before next friday`, `sort: priority`, `limit: 10`. `#` starts a comment.
 */
export interface ParsedTaskQuery {
  query: TaskQuery;
  sort: TaskSort;
  descending: boolean;
  grouping: TaskGrouping;
  limit: number;
  layout: TaskQueryLayout;
  /** The period a calendar opens on (its toolbar changes it). */
  calendarScope: CalendarScope;
  /** The date whose period a calendar opens on, when not today's (an ISO date). */
  calendarAnchor?: string;
  title?: string;
  /** The view or smart list to open for "Show all". */
  opens?: { mode: TaskQuery["mode"]; smartListId?: string };
  errors: string[];
}

export interface TaskQueryContext {
  /** The note containing the block, for `this`. */
  sourcePath: string;
  dateFormat: string;
  smartLists: SmartList[];
  /** Resolve a `[[link]]` or note name to a note path. */
  resolveNote: (name: string) => string | undefined;
  now?: Date;
}

export const DEFAULT_QUERY_LIMIT = 50;
const VIEWS = ["today", "upcoming", "inbox", "all", "overdue"] as const;
const ALIASES: Record<string, TaskProperty> = {
  scheduled: "scheduledDate", "scheduled date": "scheduledDate", "scheduled time": "scheduledTime", due: "deadline", "due date": "deadline",
  "deadline time": "deadlineTime", tag: "tags", note: "source", source: "source", "hidden until": "defer", snoozed: "defer", defer: "defer",
  done: "completed", "completed date": "completed", "done date": "completed", heading: "section", "task title": "title"
};
const CALENDAR_SCOPES: Record<string, CalendarScope> = { day: "day", "4 days": "four-day", "four days": "four-day", week: "week", month: "month" };
// A calendar's period, before its date ("month 2026-11-01") or after it ("2026-11-01 month").
const CALENDAR_SCOPE = [/^(day|4 days|four days|week|month)(?:\s+|$)/i, /(?:^|\s+)(day|4 days|four days|week|month)$/i];
// `title:` names the block; filter on task titles with `task title:` (or `search:`).
export const QUERY_KEYS = ["view", "smart list", "project", "search", "show completed", "sort", "group", "layout", "limit", "title",
  ...TASK_PROPERTIES.map(property => property.key === "title" ? "task title" : property.label.toLowerCase())];

function propertyFor(key: string): typeof TASK_PROPERTIES[number] | undefined {
  const alias = ALIASES[key];
  return TASK_PROPERTIES.find(property => property.key === (alias ?? key) || property.label.toLowerCase() === key || property.key.toLowerCase() === key);
}

function splitValues(text: string): string[] {
  return text.split(/\s*,\s*|\s+or\s+/i).map(value => value.trim()).filter(Boolean);
}

/** Parse one property condition, e.g. `before next friday`, `is not 3`, `has`. */
function condition(property: typeof TASK_PROPERTIES[number], text: string, context: TaskQueryContext): TaskFilter | string {
  const value = text.trim();
  if (!value) return `Write a value after "${property.label.toLowerCase()}:", or "has" or "missing".`;
  const lower = value.toLowerCase();
  let operator: FilterOperator = "is";
  let values: string[];
  let match: RegExpExecArray | null;
  if (/^(has|has a value|any|yes)$/.test(lower)) return { property: property.key, operator: "has", values: [] };
  if (/^(missing|none|empty|no|no value)$/.test(lower)) return { property: property.key, operator: "missing", values: [] };
  if ((match = /^between\s+(.+?)\s+and\s+(.+)$/i.exec(value))) { operator = "between"; values = [match[1], match[2]]; }
  else if ((match = /^(is not|isn't|not)\s+(.+)$/i.exec(value))) { operator = "isNot"; values = splitValues(match[2]); }
  else if ((match = /^(before|after|contains|is)\s+(.+)$/i.exec(value))) {
    operator = match[1].toLowerCase() as FilterOperator;
    values = operator === "before" || operator === "after" ? [match[2]] : operator === "contains" ? [match[2].trim()] : splitValues(match[2]);
  } else values = splitValues(value);
  if ((operator === "before" || operator === "after" || operator === "between") && !["date", "time", "number"].includes(property.kind)) {
    return `${property.label} can't be compared with "${operator}".`;
  }
  const converted: string[] = [];
  for (const raw of values) {
    const item = raw.replace(/^#\[\[|^\[\[|\]\]$/g, "").replace(/^#/, "").trim();
    if (property.kind === "date") {
      if (property.key === "defer" && /^someday$/i.test(item)) { converted.push("Someday"); continue; }
      const date = parseDateExpression(item, context.now, context.dateFormat);
      if (!date) return `"${raw}" isn't a date I understand. Try a date such as ${todayIso(context.now)}, today, or next friday.`;
      converted.push(date);
    } else if (property.kind === "time") {
      // Times compare as HH:mm text, so "9:00" or "9am" becomes "09:00".
      const time = parseTimeExpression(item, context.now);
      if (!time) return `"${raw}" isn't a time. Use a time such as 09:30 or 2pm.`;
      converted.push(time);
    } else if (property.key === "status") {
      const status = statusFromLabel(item);
      if (status) converted.push(STATUS_LABELS[status]);
      else if (/^(open|not done|incomplete)$/i.test(item)) converted.push("Open");
      else if (/^closed$/i.test(item)) converted.push(STATUS_LABELS.done, STATUS_LABELS.cancelled);
      else return `Status is open, to do, in progress, waiting, done or cancelled, not "${raw}".`;
    } else if (property.key === "priority") {
      const priority = /^p?([123])$/i.exec(item)?.[1];
      if (!priority) return `Priority is 1, 2, or 3, not "${raw}".`;
      converted.push(priority);
    } else if (property.key === "duration") {
      const minutes = /^\d+$/.test(item) ? Number(item) : durationToMinutes(item);
      if (!minutes) return `"${raw}" isn't a duration. Use minutes or a value such as 1h30m.`;
      converted.push(String(minutes));
    } else if (property.key === "source") {
      const path = item.toLowerCase() === "this" ? context.sourcePath : context.resolveNote(item);
      if (!path) return `Can't find the note "${raw}".`;
      converted.push(path);
    } else converted.push(item);
  }
  return { property: property.key, operator, values: converted };
}

export function parseTaskQuery(source: string, context: TaskQueryContext): ParsedTaskQuery {
  const result: ParsedTaskQuery = { query: { mode: "all", showCompleted: false, filters: [] }, sort: "date", descending: false, grouping: "none", limit: DEFAULT_QUERY_LIMIT, layout: "list", calendarScope: "week", errors: [] };
  const filters = result.query.filters!;
  let explicitCompleted: boolean | undefined;
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    // "# note" lines and " # note" endings are comments; "#work" is a tag.
    const line = rawLine.replace(/\s+#\s.*$/, "").trim();
    if (!line || /^#(\s|$)/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator < 0) { result.errors.push(`Line ${index + 1}: write each option as "name: value", for example "view: today".`); continue; }
    const key = line.slice(0, separator).trim().toLowerCase().replace(/\s+/g, " ");
    const value = line.slice(separator + 1).trim();
    const fail = (message: string): void => { result.errors.push(`Line ${index + 1}: ${message}`); };
    switch (key) {
      case "view": {
        const view = value.toLowerCase() as typeof VIEWS[number];
        if (!VIEWS.includes(view)) { fail(`"${value}" isn't a view. Use ${VIEWS.join(", ")}.`); break; }
        result.query.mode = view === "overdue" ? "all" : view;
        if (view === "overdue") result.query.dateFilter = "overdue";
        result.opens = { mode: view === "overdue" ? "today" : view };
        break;
      }
      case "smart list": {
        const list = context.smartLists.find(item => item.name.toLowerCase() === value.toLowerCase());
        if (!list) { fail(`There's no smart list named "${value}".`); break; }
        filters.push(...list.filters);
        // A list made from a view filters that view's tasks.
        const scope = list.scope;
        if (scope?.mode === "project") { result.query.mode = "project"; result.query.projectPath = scope.path; }
        else if (scope?.mode === "tag") { result.query.mode = "tags"; result.query.tag = scope.tag; result.query.tagPath = scope.path; }
        else if (scope) result.query.mode = scope.mode;
        result.sort = list.sort; result.descending = list.descending;
        result.grouping = list.grouping === "default" ? "none" : list.grouping;
        result.opens = { mode: "smartLists", smartListId: list.id };
        break;
      }
      case "project": {
        const path = value.toLowerCase() === "this" ? context.sourcePath : context.resolveNote(value.replace(/^\[\[|\]\]$/g, ""));
        if (!path) { fail(`Can't find the project "${value}".`); break; }
        result.query.mode = "project";
        result.query.projectPath = path;
        break;
      }
      case "search": result.query.search = value; break;
      case "show completed": explicitCompleted = /^(yes|true|on|1)$/i.test(value); break;
      case "title": result.title = value; break;
      case "limit": {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) fail(`Limit is a whole number, such as 10.`);
        else result.limit = limit;
        break;
      }
      case "sort": {
        const [name, direction] = value.toLowerCase().split(/\s+(?=(?:asc|ascending|desc|descending|reverse)$)/);
        const property = name === "date" ? undefined : propertyFor(name);
        if (name !== "date" && !property) { fail(`Can't sort by "${value}".`); break; }
        result.sort = property?.key ?? "date";
        result.descending = /^(desc|descending|reverse)$/.test(direction ?? "");
        break;
      }
      case "layout": {
        // "calendar" opens on this week; "calendar month" (or day, 4 days) on another period, and "calendar month
        // 2026-11-01" (or "calendar next monday") on the period with that date.
        const [, name = "", after = ""] = /^(\S+)\s*(.*)$/.exec(value) ?? [];
        if (!name) { fail(`Write a layout after "layout:": list, board, or calendar.`); break; }
        const layout = name.toLowerCase() === "kanban" ? "board" : name.toLowerCase();
        let rest = after.trim();
        if (layout !== "list" && layout !== "board" && layout !== "calendar" || (rest && layout !== "calendar")) {
          fail(`"${value}" isn't a layout. Use list, board, calendar, or calendar with day, 4 days, week or month and a date.`);
          break;
        }
        const scope = CALENDAR_SCOPE[0].exec(rest) ?? CALENDAR_SCOPE[1].exec(rest);
        if (scope) rest = rest.replace(scope[0], "");
        rest = rest.replace(/^(?:on|of|from|at)\s+/i, "").trim();
        const anchor = rest ? parseDateExpression(rest, context.now, context.dateFormat) : undefined;
        if (rest && !anchor) { fail(`"${rest}" isn't a date I understand. Try a date such as ${todayIso(context.now)}, today, or next friday.`); break; }
        result.layout = layout as TaskQueryLayout;
        if (scope) result.calendarScope = CALENDAR_SCOPES[scope[1].toLowerCase()];
        if (anchor) result.calendarAnchor = anchor;
        break;
      }
      case "group": {
        const name = value.toLowerCase();
        const property = name === "date" || name === "none" ? undefined : propertyFor(name);
        if (name !== "date" && name !== "none" && !property) { fail(`Can't group by "${value}".`); break; }
        result.grouping = property?.key ?? (name as "date" | "none");
        break;
      }
      default: {
        const property = propertyFor(key);
        if (!property) { fail(`Unknown option "${key}". Options: ${QUERY_KEYS.join(", ")}.`); break; }
        const filter = condition(property, value, context);
        if (typeof filter === "string") fail(filter); else filters.push(filter);
      }
    }
  }
  // A status or completed-date filter asks for completed tasks; otherwise they're hidden unless requested.
  result.query.showCompleted = explicitCompleted ?? filters.some(filter => filter.property === "completed" && filter.operator !== "missing");
  return result;
}
