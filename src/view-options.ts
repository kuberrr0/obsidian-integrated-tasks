import { setIcon } from "obsidian";
import { renderPropertyFilter } from "./filter-editor";
import { PRIORITY_FILTER_VALUES, propertyLabel, propertyValue, resolveDateToken, TASK_PROPERTIES } from "./task-properties";
import { OPEN_STATUSES, STATUS_LABELS, TASK_STATUSES } from "./task-status";
import type { Task, TaskFilter, TaskGrouping, TaskProperty, TaskSort } from "./types";

/** Sort, group and filter state the task view keeps; the panel reads and changes it through the host. */
export interface ViewOptionsState {
  sort: TaskSort; descending: boolean; grouping: TaskGrouping; filters: TaskFilter[];
  /** Without a status filter the view leaves completed (done and cancelled) tasks out, showing only open statuses. */
  openOnly?: boolean;
  /** What View default groups by in this view, such as "Note" or "Action date". */
  defaultGroup?: string;
  /** Whether the view lists the projects it matches among its tasks; undefined where it cannot (the calendar). */
  showProjects?: boolean;
}
export interface ViewOptionsHost {
  state(): ViewOptionsState;
  update(change: Partial<ViewOptionsState>): void;
  clear(): void;
  tasks(): Task[];
  expanded(): boolean;
  setExpanded(open: boolean): void;
  /** Makes a smart list of the view as its options now show it, named in a popover beside `anchor`; the panel's footer offers it. */
  convert?: (anchor: HTMLElement) => void;
  /** In a smart list: saves the options it now shows into the list; the panel's footer offers it while they differ from the list's. */
  updateSmartList?: { changed(): boolean; save(): void };
}

type Property = typeof TASK_PROPERTIES[number];
type Condition = Omit<TaskFilter, "property">;
interface Preset { label: string; condition?: Condition; custom?: true }
interface Option { value: string; label: string; selected: boolean; action?: true }
interface DropdownSpec {
  label: string;
  multi: boolean;
  options(): Option[];
  choose(value: string): void;
  input?: { placeholder: string; value: () => string; change: (value: string) => void };
}

const SORTS: Array<[TaskSort, string]> = [
  ["date", "Action date"], ["scheduledDate", "Scheduled date"], ["deadline", "Deadline"], ["priority", "Priority"], ["title", "Title"],
  ["status", "Status"], ["duration", "Duration"], ["tags", "Tags"], ["source", "Note"], ["section", "Heading"], ["completed", "Completed date"], ["defer", "Hidden until"]
];
const GROUPS: Array<[TaskGrouping, string]> = [
  ["default", "View default"], ["none", "None"], ["date", "Action date"], ["scheduledDate", "Scheduled date"], ["deadline", "Deadline"], ["priority", "Priority"],
  ["status", "Status"], ["tags", "Tags"], ["source", "Note"], ["section", "Heading"], ["duration", "Duration"], ["repeat", "Repeat"], ["defer", "Hidden until"], ["completed", "Completed date"]
];
/** A grouping's name, as View options › Group lists it. */
export const groupingLabel = (grouping: TaskGrouping): string => GROUPS.find(([value]) => value === grouping)?.[1] ?? grouping;
const SECTIONS: Array<[string, Array<[TaskProperty, string, string]>]> = [
  ["Status & priority", [["status", "Status", "circle-dot"], ["priority", "Priority", "flag"]]],
  ["Dates", [["scheduledDate", "Scheduled", "calendar"], ["scheduledTime", "Scheduled time", "clock"], ["deadline", "Deadline", "calendar-clock"],
    ["deadlineTime", "Deadline time", "alarm-clock"], ["defer", "Hidden until", "eye-off"], ["completed", "Completed", "check-check"]]],
  ["Details", [["tags", "Tags", "tag"], ["duration", "Duration", "timer"], ["repeat", "Repeat", "repeat"], ["title", "Title", "text"]]],
  ["Location", [["source", "Note", "file-text"], ["section", "Heading", "heading"]]]
];
// Values filtered by picking from a list (multi-select "is").
const CHOICE_PROPERTIES = new Set<TaskProperty>(["status", "priority", "tags", "source", "section"]);

function presets(property: Property): Preset[] {
  const key = property.key;
  if (property.kind === "date") return [
    { label: "Any" },
    { label: key === "completed" ? "Before today" : "Overdue", condition: { operator: "before", values: ["today"] } },
    { label: "Today", condition: { operator: "is", values: ["today"] } },
    ...(key === "completed" ? [{ label: "Yesterday", condition: { operator: "is" as const, values: ["today-1"] } }, { label: "Past 7 days", condition: { operator: "between" as const, values: ["today-7", "today"] } }]
      : [{ label: "Tomorrow", condition: { operator: "is" as const, values: ["today+1"] } }, { label: "Next 7 days", condition: { operator: "between" as const, values: ["today", "today+7"] } }]),
    ...(key === "defer" ? [{ label: "Someday", condition: { operator: "is" as const, values: ["Someday"] } }] : []),
    { label: "Has a date", condition: { operator: "has", values: [] } },
    { label: "No date", condition: { operator: "missing", values: [] } },
    { label: "Custom…", custom: true }
  ];
  if (property.kind === "time") return [
    { label: "Any" },
    { label: "Morning", condition: { operator: "before", values: ["12:00"] } },
    { label: "Afternoon", condition: { operator: "between", values: ["12:00", "17:00"] } },
    { label: "Evening", condition: { operator: "after", values: ["17:00"] } },
    { label: "Has a time", condition: { operator: "has", values: [] } },
    { label: "No time", condition: { operator: "missing", values: [] } },
    { label: "Custom…", custom: true }
  ];
  if (key === "duration") return [
    { label: "Any" },
    { label: "Under 15m", condition: { operator: "before", values: ["15"] } },
    { label: "Under 30m", condition: { operator: "before", values: ["30"] } },
    { label: "Under 1h", condition: { operator: "before", values: ["60"] } },
    { label: "1h or more", condition: { operator: "after", values: ["59"] } },
    { label: "Has a duration", condition: { operator: "has", values: [] } },
    { label: "No duration", condition: { operator: "missing", values: [] } },
    { label: "Custom…", custom: true }
  ];
  if (key === "repeat") return [
    { label: "Any" },
    { label: "Repeats", condition: { operator: "has", values: [] } },
    { label: "Doesn't repeat", condition: { operator: "missing", values: [] } },
    { label: "Custom…", custom: true }
  ];
  return [{ label: "Any" }, { label: "Custom…", custom: true }];
}

const same = (filter: TaskFilter | undefined, condition: Condition | undefined): boolean =>
  !filter ? !condition : Boolean(condition) && !filter.conditions?.length && filter.operator === condition!.operator
    && filter.values.length === condition!.values.length && filter.values.every((value, index) => value === condition!.values[index]);

function dateText(value: string): string {
  const token = /^today(?:([+-])(\d+))?$/i.exec(value);
  if (!token) return value;
  const days = token[2] ? Number(token[2]) * (token[1] === "-" ? -1 : 1) : 0;
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function choiceLabel(property: TaskProperty, value: string): string {
  if (property === "priority") return propertyLabel(property, value);
  if (property === "source") return value.replace(/\.md$/i, "").split("/").pop() ?? value;
  return value;
}

/** Short text for a row's select button, such as "P1, P2", "Next 7 days" or "3 conditions". */
export function filterSummary(property: Property, filter: TaskFilter | undefined): string {
  if (!filter) return "Any";
  const preset = presets(property).find(item => item.condition && same(filter, item.condition));
  if (preset) return preset.label;
  if (filter.conditions?.length) return `${filter.conditions.length + 1} conditions`;
  const values = filter.values.map(value => property.kind === "date" ? dateText(value) : choiceLabel(property.key, value));
  const list = values.length > 2 ? `${values.length} ${property.key === "status" ? "statuses" : property.key === "source" ? "notes" : property.key === "tags" ? "tags" : "values"}` : values.join(", ");
  switch (filter.operator) {
    case "has": return "Has a value";
    case "missing": return "None";
    case "is": return list;
    case "isNot": return `Not ${list}`;
    case "contains": return `Contains “${filter.values[0]}”`;
    case "before": return property.key === "duration" ? `Under ${values[0]} min` : `Before ${values[0]}`;
    case "after": return property.key === "duration" ? `Over ${values[0]} min` : `After ${values[0]}`;
    case "between": return `${values[0]} – ${values[1]}`;
  }
}

/** A popover with sort, group and filter controls, anchored to the view header's options button. */
export class ViewOptionsPanel {
  readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  /** Update smart list, in a smart list's panel; enabled while the view's options differ from the list's. */
  private updateButton?: HTMLButtonElement;
  private readonly directionButton: HTMLButtonElement;
  /** The Show section's Projects switch, and the section (hidden where the view cannot show projects). */
  private readonly projectsSwitch: HTMLElement;
  private readonly showSection: HTMLElement;
  private readonly summaries = new Map<string, HTMLButtonElement>();
  private readonly editors = new Map<TaskProperty, HTMLElement>();
  private readonly badge: HTMLElement;
  private dropdown?: { element: HTMLElement; button: HTMLElement; spec: DropdownSpec; render(): void };

  constructor(anchor: HTMLElement, private readonly toggle: HTMLButtonElement, private readonly host: ViewOptionsHost) {
    toggle.empty();
    setIcon(toggle.createSpan({ cls: "tm-options-toggle-icon" }), "list-filter");
    this.badge = toggle.createSpan({ cls: "tm-options-badge", attr: { "aria-hidden": "true" } });
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.addEventListener("click", () => this.setOpen(!this.host.expanded()));

    this.panel = anchor.createDiv({ cls: "tm-options-panel", attr: { role: "dialog", "aria-label": "View options" } });
    const header = this.panel.createDiv({ cls: "tm-options-header" });
    header.createEl("h2", { text: "View options" });
    this.clearButton = header.createEl("button", { cls: "tm-options-clear", text: "Clear all", attr: { type: "button", "data-tm-focus-key": "clear-filters" } });
    this.clearButton.addEventListener("click", () => { this.closeDropdown(false); this.host.clear(); this.sync(); });
    this.body = this.panel.createDiv({ cls: "tm-options-body" });
    this.panel.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
      this.toggle.focus();
    });

    const sorting = this.section("Sort & group");
    const sortRow = this.row(sorting, "arrow-up-down", "Sort");
    this.selectButton(sortRow, "sort", "Sort", () => ({
      label: "Sort", multi: false,
      options: () => SORTS.map(([value, label]) => ({ value, label, selected: this.host.state().sort === value })),
      choose: value => { this.host.update({ sort: value as TaskSort }); this.sync(); this.closeDropdown(true); }
    }));
    sortRow.addClass("has-direction");
    this.directionButton = sortRow.createEl("button", { cls: "tm-options-direction clickable-icon", attr: { type: "button", "data-tm-focus-key": "option-direction" } });
    this.directionButton.addEventListener("click", () => { this.host.update({ descending: !this.host.state().descending }); this.sync(); });
    const groupRow = this.row(sorting, "layers", "Group");
    this.selectButton(groupRow, "group", "Group", () => ({
      label: "Group", multi: false,
      options: () => GROUPS.map(([value, label]) => {
        const shown = value === "default" && this.host.state().defaultGroup ? `${label} (${this.host.state().defaultGroup})` : label;
        return { value, label: shown, selected: this.host.state().grouping === value };
      }),
      choose: value => { this.host.update({ grouping: value as TaskGrouping }); this.sync(); this.closeDropdown(true); }
    }));

    // Show: projects among the tasks, each with its progress in place of a checkbox.
    this.showSection = this.section("Show");
    const projectsRow = this.row(this.showSection, "square-chart-gantt", "Projects");
    this.projectsSwitch = projectsRow.createDiv({ cls: "checkbox-container tm-options-switch", attr: { role: "switch", tabindex: "0", "aria-label": "Show projects", "data-tm-focus-key": "option-projects" } });
    this.projectsSwitch.createEl("input", { type: "checkbox", attr: { tabindex: "-1", "aria-hidden": "true" } });
    const switchProjects = (): void => { this.host.update({ showProjects: !this.host.state().showProjects }); this.sync(); };
    this.projectsSwitch.addEventListener("click", event => { event.preventDefault(); switchProjects(); });
    this.projectsSwitch.addEventListener("keydown", event => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault(); switchProjects();
    });

    for (const [title, rows] of SECTIONS) {
      const section = this.section(title);
      for (const [key, label, icon] of rows) {
        const property = TASK_PROPERTIES.find(item => item.key === key);
        if (property) this.filterRow(section, property, label, icon);
      }
    }
    const convert = host.convert;
    if (convert) {
      const footer = this.panel.createDiv({ cls: "tm-options-footer" });
      const button = footer.createEl("button", { cls: "tm-options-convert", attr: { type: "button", "data-tm-focus-key": "option-convert" } });
      setIcon(button.createSpan({ cls: "tm-options-icon", attr: { "aria-hidden": "true" } }), "list-plus");
      button.createSpan({ text: "Convert to smart list" });
      button.addEventListener("click", () => { this.setOpen(false); convert.call(host, this.toggle); });
    }
    const update = host.updateSmartList;
    if (update) {
      const footer = this.panel.createDiv({ cls: "tm-options-footer" });
      const button = this.updateButton = footer.createEl("button", { cls: "tm-options-update", attr: { type: "button", "data-tm-focus-key": "option-update" } });
      setIcon(button.createSpan({ cls: "tm-options-icon", attr: { "aria-hidden": "true" } }), "refresh-cw");
      button.createSpan({ text: "Update smart list" });
      button.addEventListener("click", () => { this.setOpen(false); this.toggle.focus(); update.save(); });
    }
    this.sync();
  }

  get isOpen(): boolean { return this.host.expanded(); }

  setOpen(open: boolean): void {
    this.host.setExpanded(open);
    if (!open) this.closeDropdown(false);
    this.sync();
    if (open) (this.panel.querySelector<HTMLElement>(".tm-options-select") ?? this.panel).focus({ preventScroll: true });
  }

  /** A click outside an open list (sort, group or a property's choices) closes it; outside the panel and its button, the panel closes too. */
  handleOutside(event: Event): void {
    const target = event.target as Node | null;
    if (!this.isOpen || !target) return;
    const dropdown = this.dropdown;
    if (dropdown && !dropdown.element.contains(target) && !dropdown.button.contains(target)) this.closeDropdown(false);
    if (this.panel.contains(target) || this.toggle.contains(target)) return;
    this.setOpen(false);
  }

  /** Bring every summary, the badge and an open dropdown up to date with the view's state. */
  sync(): void {
    const { filters, descending } = this.host.state();
    const open = this.host.expanded();
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.toggle.toggleClass("is-active", open);
    const label = `View options: filter, sort, and group${filters.length ? ` (${filters.length} active ${filters.length === 1 ? "filter" : "filters"})` : ""}`;
    this.toggle.setAttribute("aria-label", label);
    this.toggle.setAttribute("title", label);
    this.badge.setText(filters.length ? String(filters.length) : "");
    this.badge.hidden = !filters.length;
    const state = this.host.state();
    this.clearButton.disabled = !filters.length && state.sort === "date" && !state.descending && state.grouping === "default" && state.showProjects !== false;
    if (this.updateButton) this.updateButton.disabled = !this.host.updateSmartList?.changed();
    this.showSection.hidden = state.showProjects === undefined;
    this.projectsSwitch.toggleClass("is-enabled", state.showProjects === true);
    this.projectsSwitch.setAttribute("aria-checked", String(state.showProjects === true));
    this.directionButton.empty();
    setIcon(this.directionButton, descending ? "arrow-down-wide-narrow" : "arrow-up-narrow-wide");
    this.directionButton.setAttribute("aria-label", descending ? "Descending" : "Ascending");
    this.directionButton.setAttribute("title", descending ? "Descending — click for ascending" : "Ascending — click for descending");
    this.directionButton.setAttribute("aria-pressed", String(descending));
    this.summary("sort", SORTS.find(([value]) => value === state.sort)?.[1] ?? "Action date", false);
    // View default names what it groups by here; its option in the list is the one checked.
    this.summary("group", state.grouping === "default" ? state.defaultGroup ?? "View default" : GROUPS.find(([value]) => value === state.grouping)?.[1] ?? "View default", false);
    for (const property of TASK_PROPERTIES) {
      const filter = filters.find(item => item.property === property.key);
      // Without a status filter, a view hiding completed tasks shows the open statuses, not any.
      const summary = !filter && property.key === "status" && state.openOnly ? OPEN_STATUSES.map(status => STATUS_LABELS[status]).join(", ") : filterSummary(property, filter);
      this.summary(property.key, summary, !filter);
    }
    this.dropdown?.render();
  }

  private summary(key: string, text: string, placeholder: boolean): void {
    const button = this.summaries.get(key);
    if (!button) return;
    button.querySelector(".tm-options-select-text")?.setText(text);
    button.toggleClass("is-placeholder", placeholder);
  }

  private section(title: string): HTMLElement {
    const section = this.body.createDiv({ cls: "tm-options-section" });
    section.createEl("h3", { text: title });
    return section;
  }

  private row(section: HTMLElement, icon: string, label: string): HTMLElement {
    const row = section.createDiv({ cls: "tm-options-row" });
    const name = row.createDiv({ cls: "tm-options-label" });
    setIcon(name.createSpan({ cls: "tm-options-icon", attr: { "aria-hidden": "true" } }), icon);
    name.createSpan({ text: label });
    return row;
  }

  private selectButton(row: HTMLElement, key: string, label: string, spec: () => DropdownSpec | undefined): HTMLButtonElement {
    const button = row.createEl("button", { cls: "tm-options-select", attr: { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": label, "data-tm-focus-key": `option-${key}` } });
    button.createSpan({ cls: "tm-options-select-text" });
    setIcon(button.createSpan({ cls: "tm-options-chevron", attr: { "aria-hidden": "true" } }), "chevron-down");
    this.summaries.set(key, button);
    button.addEventListener("click", () => {
      if (this.dropdown?.button === button) { this.closeDropdown(true); return; }
      const next = spec();
      if (next) this.openDropdown(button, next);
    });
    button.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const next = spec();
      if (next && this.dropdown?.button !== button) this.openDropdown(button, next);
    });
    return button;
  }

  private filterRow(section: HTMLElement, property: Property, label: string, icon: string): void {
    const row = this.row(section, icon, label);
    const current = (): TaskFilter | undefined => this.host.state().filters.find(filter => filter.property === property.key);
    const setFilter = (condition: Condition | undefined): void => {
      const others = this.host.state().filters.filter(filter => filter.property !== property.key);
      this.host.update({ filters: condition ? [...others, { property: property.key, ...condition }] : others });
      if (this.editors.has(property.key)) this.showEditor(property, row);
      this.sync();
    };
    const choices = (): string[] => {
      if (property.key === "status") {
        // Older smart lists may hold "Open" or "Completed"; keep them listed so they can be cleared.
        const labels = TASK_STATUSES.map(status => STATUS_LABELS[status]);
        return [...labels, ...(current()?.values ?? []).filter(value => !labels.includes(value))];
      }
      if (property.key === "priority") return PRIORITY_FILTER_VALUES;
      if (property.key === "tags") return [...new Set(this.host.tasks().flatMap(task => task.tags ?? []))].sort((a, b) => a.localeCompare(b));
      return [...new Set(this.host.tasks().map(task => propertyValue(task, property.key)).filter(value => value !== undefined && value !== "").map(String))]
        .sort((a, b) => choiceLabel(property.key, a).localeCompare(choiceLabel(property.key, b)));
    };
    const more = (): Option => ({ value: "\u0000more", label: this.editors.has(property.key) ? "Hide conditions" : "More conditions…", selected: false, action: true });
    this.selectButton(row, property.key, `${label} filter`, () => {
      const filter = current();
      // Filters the quick choices can't show (other operators, several conditions) open the detailed editor.
      const simpleChoice = !filter || (filter.operator === "is" && !filter.conditions?.length);
      if (CHOICE_PROPERTIES.has(property.key) && !simpleChoice) { this.showEditor(property, row); return undefined; }
      if (!CHOICE_PROPERTIES.has(property.key) && property.key !== "title" && filter && !presets(property).some(preset => preset.condition && same(filter, preset.condition))) {
        this.showEditor(property, row);
        return undefined;
      }
      if (CHOICE_PROPERTIES.has(property.key)) {
        // A view that hides completed tasks already shows only the open statuses: they start checked, and its
        // first option is the view's default rather than any status.
        const implicit = (): string[] => property.key === "status" && this.host.state().openOnly ? OPEN_STATUSES.map(status => STATUS_LABELS[status]) : [];
        const selection = (): Set<string> => new Set(current()?.values ?? implicit());
        return {
          label, multi: true,
          options: () => {
            const selected = selection();
            const byDefault = implicit().length > 0;
            return [{ value: "\u0000any", label: byDefault ? "View default" : "Any", selected: !current() },
              ...choices().map(value => ({ value, label: choiceLabel(property.key, value), selected: selected.has(value) })), more()];
          },
          choose: value => {
            if (value === "\u0000more") { this.showEditor(property, row); this.closeDropdown(true); return; }
            if (value === "\u0000any") { setFilter(undefined); return; }
            const selected = selection();
            if (selected.has(value)) selected.delete(value); else selected.add(value);
            // Back at exactly the view's own choice, there is no filter to keep.
            const byDefault = implicit();
            const unchanged = byDefault.length > 0 && selected.size === byDefault.length && byDefault.every(item => selected.has(item));
            setFilter(selected.size && !unchanged ? { operator: "is", values: [...selected] } : undefined);
          }
        };
      }
      if (property.key === "title") return {
        label, multi: false,
        input: {
          placeholder: "Contains…",
          value: () => current()?.operator === "contains" ? current()!.values[0] ?? "" : "",
          change: value => setFilter(value.trim() ? { operator: "contains", values: [value.trim()] } : undefined)
        },
        options: () => [{ value: "\u0000any", label: "Any", selected: !current() }, more()],
        choose: value => {
          if (value === "\u0000more") { this.showEditor(property, row); this.closeDropdown(true); return; }
          setFilter(undefined);
          this.closeDropdown(true);
        }
      };
      const list = presets(property);
      return {
        label, multi: false,
        options: () => [...list.map((preset, index) => ({ value: String(index), label: preset.label, selected: !preset.custom && same(current(), preset.condition), action: preset.custom })), more()],
        choose: value => {
          if (value === "\u0000more") { this.showEditor(property, row); this.closeDropdown(true); return; }
          const preset = list[Number(value)];
          if (preset.custom) { this.showEditor(property, row); this.closeDropdown(true); return; }
          setFilter(preset.condition);
          this.closeDropdown(true);
        }
      };
    });
  }

  /** The detailed editor (is not, between, AND/OR) for one property, shown under its row. */
  private showEditor(property: Property, row: HTMLElement): void {
    let editor = this.editors.get(property.key);
    if (editor && !editor.isConnected) editor = undefined;
    if (!editor) {
      editor = createDiv({ cls: "tm-options-conditions" });
      row.after(editor);
      this.editors.set(property.key, editor);
    }
    editor.empty();
    const filter = this.host.state().filters.find(item => item.property === property.key);
    // Date inputs can't show relative values such as "today+7"; edit them as the dates they mean today.
    const shown = filter && property.kind === "date" ? { ...filter, values: filter.values.map(value => resolveDateToken(value)),
      conditions: filter.conditions?.map(condition => ({ ...condition, values: condition.values.map(value => resolveDateToken(value)) })) } : filter;
    const header = editor.createDiv({ cls: "tm-options-conditions-header" });
    header.createSpan({ text: `${property.label} conditions` });
    const close = header.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": `Hide ${property.label} conditions` } });
    setIcon(close, "x");
    close.addEventListener("click", () => {
      editor.remove();
      this.editors.delete(property.key);
      this.summaries.get(property.key)?.focus();
    });
    editor.createDiv({ cls: "tm-filter-hint", text: "Within a property, AND is evaluated before OR." });
    renderPropertyFilter(editor.createDiv({ cls: "tm-options-conditions-body" }), property, shown, () => this.host.tasks(), next => {
      const others = this.host.state().filters.filter(item => item.property !== property.key);
      this.host.update({ filters: next ? [...others, next] : others });
      // Keep the editor as it is while typing; only the summaries change.
      const { filters } = this.host.state();
      this.summary(property.key, filterSummary(property, filters.find(item => item.property === property.key)), !next);
      this.badge.setText(filters.length ? String(filters.length) : "");
      this.badge.hidden = !filters.length;
    });
  }

  private openDropdown(button: HTMLElement, spec: DropdownSpec): void {
    this.closeDropdown(false);
    const element = this.body.createDiv({ cls: "tm-options-dropdown" });
    let input: HTMLInputElement | undefined;
    if (spec.input) {
      input = element.createEl("input", { type: "text", cls: "tm-options-input", attr: { placeholder: spec.input.placeholder, "aria-label": `${spec.label} contains` } });
      input.value = spec.input.value();
      const change = spec.input.change;
      input.addEventListener("input", () => change(input!.value));
      input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); this.closeDropdown(true); } });
    }
    const list = element.createDiv({ cls: "tm-options-list", attr: { role: "listbox", "aria-label": spec.label, ...(spec.multi ? { "aria-multiselectable": "true" } : {}) } });
    let focused = -1;
    const items = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>("[role=option]"));
    const render = (): void => {
      const active = element.ownerDocument.activeElement;
      const index = items().findIndex(item => item === active);
      list.empty();
      let separated = false;
      for (const option of spec.options()) {
        if (option.action && !separated) { list.createDiv({ cls: "tm-options-separator", attr: { role: "presentation" } }); separated = true; }
        const item = list.createDiv({ cls: `tm-options-option${option.action ? " is-action" : ""}`, attr: { role: "option", tabindex: "-1", "aria-selected": String(option.selected), "data-value": option.value } });
        item.createSpan({ cls: "tm-options-option-label", text: option.label });
        const check = item.createSpan({ cls: "tm-options-check", attr: { "aria-hidden": "true" } });
        if (option.selected) setIcon(check, "check");
        item.addEventListener("click", () => { focused = items().indexOf(item); spec.choose(option.value); });
      }
      // Keep keyboard focus on the same position after the list is rebuilt.
      if (index >= 0) items()[Math.min(index, items().length - 1)]?.focus({ preventScroll: true });
    };
    render();
    const move = (to: number): void => {
      const all = items();
      if (!all.length) return;
      focused = (to + all.length) % all.length;
      all[focused].focus({ preventScroll: true });
      all[focused].scrollIntoView?.({ block: "nearest" });
    };
    element.addEventListener("keydown", event => {
      const all = items();
      const index = all.indexOf(event.target as HTMLElement);
      if (event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(index < 0 ? all.length - 1 : index - 1); }
      else if (event.key === "Home") { event.preventDefault(); move(0); }
      else if (event.key === "End") { event.preventDefault(); move(all.length - 1); }
      else if ((event.key === "Enter" || event.key === " ") && index >= 0) {
        event.preventDefault();
        spec.choose(all[index].getAttribute("data-value") ?? "");
      } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.closeDropdown(true); }
      else if (event.key === "Tab") this.closeDropdown(false);
    });
    button.setAttribute("aria-expanded", "true");
    button.addClass("is-open");
    this.dropdown = { element, button, spec, render };
    this.position(element, button);
    if (input) input.focus();
    else {
      const selected = items().findIndex(item => item.getAttribute("aria-selected") === "true");
      move(selected >= 0 ? selected : 0);
    }
  }

  /** Under the button, or above it when the panel has no room below. */
  private position(element: HTMLElement, button: HTMLElement): void {
    const width = Math.max(button.offsetWidth, 200);
    element.style.width = `${width}px`;
    element.style.left = `${Math.max(0, button.offsetLeft + button.offsetWidth - width)}px`;
    element.style.top = `${button.offsetTop + button.offsetHeight + 4}px`;
    const room = this.panel.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
    if (element.offsetHeight > room && button.offsetTop > element.offsetHeight) element.style.top = `${button.offsetTop - element.offsetHeight - 4}px`;
  }

  private closeDropdown(focusButton: boolean): void {
    const current = this.dropdown;
    if (!current) return;
    this.dropdown = undefined;
    current.element.remove();
    current.button.setAttribute("aria-expanded", "false");
    current.button.removeClass("is-open");
    if (focusButton) current.button.focus({ preventScroll: true });
  }
}
