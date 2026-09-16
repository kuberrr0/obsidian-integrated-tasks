import { filterOperators, propertyLabel, propertyValue, type TASK_PROPERTIES } from "./task-properties";
import type { FilterOperator, Task, TaskFilter } from "./types";

type Clause = { operator: FilterOperator | ""; values: string[]; join: "and" | "or" };
const complete = (clause: Clause): boolean => Boolean(clause.operator && (
  clause.operator === "has" || clause.operator === "missing" ||
  (clause.values[0]?.trim() && (clause.operator !== "between" || clause.values[1]?.trim()))
));

export function renderPropertyFilter(container: HTMLElement, property: typeof TASK_PROPERTIES[number], initial: TaskFilter | undefined,
  tasks: Task[], onChange: (filter: TaskFilter | undefined) => void): void {
  const clauses: Clause[] = [{ operator: initial?.operator ?? "", values: [...initial?.values ?? []], join: "and" },
    ...(initial?.conditions ?? []).map(condition => ({ ...condition, values: [...condition.values] }))];
  const apply = (): void => {
    const valid: Clause[] = [];
    for (const clause of clauses) { if (!complete(clause)) break; valid.push(clause); }
    const first = valid.shift();
    onChange(first ? { property: property.key, operator: first.operator as FilterOperator, values: [...first.values],
      ...(valid.length ? { conditions: valid.map(clause => ({ join: clause.join, operator: clause.operator as FilterOperator, values: [...clause.values] })) } : {}) } : undefined);
  };
  const syncControls: Array<() => void> = [];
  const render = (): void => {
    container.empty();
    syncControls.length = 0;
    clauses.forEach((clause, index) => {
      const row = container.createDiv({ cls: "tm-filter-clause" });
      if (index) {
        const join = row.createEl("select", { cls: "tm-filter-join", attr: { "aria-label": `${property.label} connector ${index}` } });
        join.createEl("option", { value: "and", text: "AND" });
        join.createEl("option", { value: "or", text: "OR" });
        join.value = clause.join;
        join.addEventListener("change", () => { clause.join = join.value === "or" ? "or" : "and"; apply(); });
      }
      const operator = row.createEl("select", { attr: { "aria-label": `${property.label} condition${index ? ` ${index + 1}` : ""}` } });
      operator.createEl("option", { value: "", text: "Any value" });
      for (const [value, text] of filterOperators(property.kind)) operator.createEl("option", { value, text });
      operator.value = clause.operator;
      const inputs = row.createDiv({ cls: "tm-filter-values" });
      if (index) {
        const remove = row.createEl("button", { text: "×", attr: { "aria-label": `Remove ${property.label} condition ${index + 1}` } });
        remove.addEventListener("click", () => { clauses.splice(index, 1); render(); apply(); });
      }
      const add = row.createEl("select", { cls: "tm-filter-join", attr: { "aria-label": `Add ${property.label} condition` } });
      add.createEl("option", { value: "", text: "AND / OR…" });
      add.createEl("option", { value: "and", text: "AND" });
      add.createEl("option", { value: "or", text: "OR" });
      const sync = (): void => { add.hidden = index !== clauses.length - 1 || !clauses.every(complete); };
      syncControls.push(sync);
      add.addEventListener("change", () => {
        if (!add.value) return;
        clauses.push({ join: add.value === "or" ? "or" : "and", operator: "", values: [] });
        render();
      });
      const changed = (): void => { apply(); syncControls.forEach(update => update()); };
      const renderValues = (): void => {
        inputs.empty();
        if (!clause.operator || ["has", "missing"].includes(clause.operator)) return;
        if (property.kind === "choice") {
          const choices = property.key === "priority" ? ["1", "2", "3"] : property.key === "status" ? ["Open", "Completed"]
            : [...new Set(tasks.map(task => propertyValue(task, property.key)).filter(value => value !== undefined && value !== "").map(String))].sort();
          for (const value of choices) {
            const label = inputs.createEl("label");
            const check = label.createEl("input", { type: "checkbox" });
            check.checked = clause.values.includes(value);
            label.createSpan({ text: propertyLabel(property.key, value) });
            check.addEventListener("change", () => {
              clause.values = check.checked ? [...clause.values, value] : clause.values.filter(item => item !== value); changed();
            });
          }
        } else {
          for (let i = 0; i < (clause.operator === "between" ? 2 : 1); i++) {
            const input = inputs.createEl("input", { type: property.kind === "number" ? "number" : property.kind, attr: {
              "aria-label": `${property.label} ${i ? "upper bound" : "value"}${index ? ` ${index + 1}` : ""}`,
              ...(property.kind === "number" ? { min: "0", step: "1", placeholder: "Minutes" } : {})
            } });
            input.value = clause.values[i] ?? "";
            input.addEventListener("input", () => { if (!input.validity.valid) return; clause.values[i] = input.value; changed(); });
          }
          if (property.kind === "number") inputs.createSpan({ text: "Duration in minutes", cls: "tm-filter-hint" });
        }
      };
      operator.addEventListener("change", () => { clause.operator = operator.value as Clause["operator"]; clause.values = []; renderValues(); changed(); });
      renderValues(); sync();
    });
  };
  render();
}
