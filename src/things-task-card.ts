import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { repeatLabel } from "./parser";
import { deadlineIsOverdue, editable, taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import type { TaskEditorProperty } from "./task-editor";
import { checkboxLabel, statusClass } from "./task-status";
import { renderThingsTaskDetails, thingsDeadlineLabel, type ThingsDetailsOptions } from "./things-row-details";
import type { Task } from "./types";

/** The card's unsaved title, notes and new subtask, kept by the view so a re-render does not lose typing. */
export interface TaskCardDraft {
    title: string;
    notes: string;
    /** A subtask being typed: after which subtask it goes (none: at the end) and its text so far. */
    subtask?: { after?: string; text: string };
}

export interface TaskCardOptions {
    task: Task;
    /** How a subtask's properties render in the checklist, as on its own row. */
    childDetails?: (child: Task) => ThingsDetailsOptions;
    /** Subtasks, shown as the card's checklist. */
    children: Task[];
    draft: TaskCardDraft;
    tags: string[];
    /** Nesting level, matching the rows around the card. */
    depth: number;
    now?: Date;
    change: (draft: TaskCardDraft) => void;
    toggle: (task: Task, completed: boolean) => void;
    /** Renames a subtask. */
    renameChild: (child: Task, title: string) => void;
    /** Adds a subtask after `after` (or at the end); `next` starts another one below it once added. */
    addChild: (title: string, after: Task | undefined, next: boolean) => void;
    /** What to focus once drawn: a subtask's id, or "new" for the subtask being typed. */
    focus?: string;
    edit: (property: TaskEditorProperty) => void;
    collapse: () => void;
}

/**
 * Notes as Things shows them: top-level bullets read as plain lines. Saving turns each plain line
 * back into a bullet (see `descriptionLines`), so the note file keeps its shape.
 */
export function cardNotes(description: string | undefined): string {
    return (description ?? "").split("\n").map(line => line.replace(/^[-*+] (?!\[[ xX/?-]\])/, "")).join("\n");
}

/** Matches the project editor's P1 — High, P2 — Medium, P3 — Low. */
const PRIORITY_NAMES: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };

/** "Thu, Oct 8", with the year outside the current one. */
export function longDate(date: string, now: Date): string {
    return formatDate(date, date.slice(0, 4) === String(now.getFullYear()) ? "ddd, MMM D" : "ddd, MMM D, YYYY");
}

function autosize(area: HTMLTextAreaElement): void {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
}

/**
 * A task opened in place, as in Things: title and notes edit directly, subtasks form a checklist,
 * and each set property is a line that opens its editor. Toolbar buttons add the properties not set yet.
 */
export function renderThingsTaskCard(parent: HTMLElement, options: TaskCardOptions): HTMLElement {
    const { task, draft } = options;
    const now = options.now ?? new Date();
    const card = parent.createDiv({ cls: `tm-things-card tm-task-item${task.completed ? " is-completed" : ""}`, attr: { "data-task-id": task.id, role: "listitem" } });
    card.style.setProperty("--tm-depth", String(options.depth));

    const head = card.createDiv({ cls: "tm-things-card-head" });
    const checkbox = head.createEl("input", { type: "checkbox", cls: `tm-task-checkbox${task.priority ? ` is-p${task.priority}` : ""}${statusClass(task.status)}`, attr: { "aria-label": checkboxLabel(task), "data-tm-focus-key": "card-checkbox" } });
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => options.toggle(task, checkbox.checked));
    // A text area so long titles wrap, as in Things; it stays one logical line.
    const title = head.createEl("textarea", { cls: "tm-things-card-title", attr: { "aria-label": "Title", placeholder: "New To-Do", rows: "1", "data-tm-focus-key": "card-title" } });
    title.value = draft.title;
    const notes = card.createEl("textarea", { cls: "tm-things-card-notes", attr: { "aria-label": "Notes", placeholder: "Notes", rows: "1", "data-tm-focus-key": "card-notes" } });
    notes.value = draft.notes;
    let subtask = draft.subtask;
    const change = (): void => options.change({ title: title.value, notes: notes.value, subtask });
    title.addEventListener("input", () => {
        if (/[\r\n]/.test(title.value)) title.value = title.value.replace(/[\r\n]+/g, " ");
        autosize(title); change();
    });
    notes.addEventListener("input", () => { autosize(notes); change(); });
    // Enter in the title moves on to the notes, as in Things.
    title.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); notes.focus(); }
    });
    // Subtask edits save as you leave each one; closing the card saves the one still being edited.
    const commits: Array<() => void> = [];
    card.addEventListener("keydown", event => {
        // Escape, or Cmd/Ctrl+Enter, closes the card and saves it.
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
            event.preventDefault(); event.stopPropagation();
            for (const commit of commits) commit();
            options.collapse();
        }
        // Keep row shortcuts (M, S, arrows) from acting while typing.
        else event.stopPropagation();
    });
    // Size now when already on the page, so the opening animation measures the final height.
    const fit = (): void => { autosize(title); autosize(notes); };
    if (card.isConnected) fit();
    requestAnimationFrame(fit);

    // The checklist: subtask names edit in place, and Enter starts a new subtask right below.
    const checklist = card.createDiv({ cls: "tm-things-card-checklist", attr: { role: "list", "aria-label": "Subtasks" } });
    const items = new Map<string, HTMLElement>();
    let newRow: HTMLElement | undefined;
    const startSubtask = (after: Task | undefined, text = ""): HTMLInputElement => {
        newRow?.remove();
        const row = checklist.createDiv({ cls: "tm-things-card-check is-new", attr: { role: "listitem" } });
        const anchor = after && items.get(after.id);
        if (anchor) anchor.after(row);
        row.createEl("input", { type: "checkbox", cls: "tm-things-card-check-box", attr: { "aria-hidden": "true", tabindex: "-1", disabled: "" } });
        const input = row.createEl("input", { type: "text", cls: "tm-things-card-check-title", attr: { "aria-label": "New subtask", "data-tm-focus-key": "card-subtask-new" } });
        input.value = text;
        newRow = row;
        subtask = { after: after?.id, text };
        let finished = false;
        // Enter adds it and starts the next; leaving it adds it; either way an empty one just goes away.
        const finish = (next: boolean): void => {
            if (finished) return;
            finished = true;
            const value = input.value.trim();
            if (newRow === row) newRow = undefined;
            row.remove();
            subtask = undefined;
            change();
            if (value) options.addChild(value, after, next);
        };
        input.addEventListener("input", () => { subtask = { after: after?.id, text: input.value }; change(); });
        input.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.isComposing || event.metaKey || event.ctrlKey) return;
            event.preventDefault();
            finish(true);
        });
        // Only a real blur: a redraw removing the row keeps the text in the draft for the new card.
        input.addEventListener("blur", () => { if (row.isConnected) finish(false); });
        commits.push(() => finish(false));
        change();
        return input;
    };
    for (const child of options.children) {
        // Not a label: clicking a property must open its editor, not tick the box.
        const item = checklist.createDiv({ cls: `tm-things-card-check${child.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
        items.set(child.id, item);
        const box = item.createEl("input", { type: "checkbox", cls: "tm-things-card-check-box", attr: { "aria-label": checkboxLabel(child) } });
        box.checked = child.completed;
        box.addEventListener("change", () => options.toggle(child, box.checked));
        // Subtasks show their properties as task rows do: a star before the name, then tags, dates and the deadline.
        const lead = item.createSpan({ cls: "tm-things-lead" });
        const name = item.createEl("input", { type: "text", cls: "tm-things-card-check-title", attr: { "aria-label": `Subtask: ${child.title}`, "data-tm-focus-key": `card-subtask:${child.id}` } });
        name.value = child.title;
        let saved = child.title;
        const commit = (): void => {
            const value = name.value.trim();
            if (!value) { name.value = saved; return; }
            if (value === saved) return;
            saved = value;
            options.renameChild(child, value);
        };
        name.addEventListener("blur", commit);
        name.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.isComposing || event.metaKey || event.ctrlKey) return;
            event.preventDefault();
            commit();
            startSubtask(child).focus();
        });
        commits.push(commit);
        if (options.childDetails) renderThingsTaskDetails({ lead, inline: item, secondary: item }, child, options.childDetails(child));
        if (!lead.childElementCount) lead.remove();
    }
    // A subtask still being typed survives a redraw.
    const typing = draft.subtask ? startSubtask(options.children.find(child => child.id === draft.subtask!.after), draft.subtask.text) : undefined;

    renderThingsCardProperties(card, task, options.tags, options.edit, now);

    // Things keeps buttons for the properties not set yet at the card's bottom right.
    const toolbar = card.createDiv({ cls: "tm-things-card-toolbar" });
    const add = (icon: string, label: string, key: string, action: () => void): void => {
        const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label, "data-tm-focus-key": `card-add-${key}` } });
        setIcon(button, icon);
        button.addEventListener("click", event => { event.stopPropagation(); action(); });
    };
    if (!task.scheduledDate) add("calendar", "When", "scheduledDate", () => options.edit("scheduledDate"));
    if (!options.tags.length) add("tag", "Tags", "tags", () => options.edit("tags"));
    // The first subtask starts here; later ones follow with Enter.
    if (!options.children.length) add("list-todo", "Checklist", "checklist", () => { if (!newRow) startSubtask(undefined).focus(); });
    if (!task.priority) add("signal", "Priority", "priority", () => options.edit("priority"));
    if (!task.repeat) add("repeat", "Repeat", "repeat", () => options.edit("repeat"));
    if (!task.deadline) add("flag", "Deadline", "deadline", () => options.edit("deadline"));
    if (!toolbar.childElementCount) toolbar.remove();

    const focus = options.focus === "new" ? typing : options.focus ? card.querySelector<HTMLInputElement>(`[data-tm-focus-key="card-subtask:${CSS.escape(options.focus)}"]`) : undefined;
    if (focus?.isConnected) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
    return card;
}

/**
 * The property lines an open card (and a board card) shows: tags, when (with its time), priority,
 * repeat and deadline, each opening its editor. Draws nothing when the task has none of them.
 */
export function renderThingsCardProperties(parent: HTMLElement, task: Task, tags: string[], edit: (property: TaskEditorProperty) => void, now = new Date()): HTMLElement | undefined {
    const today = todayIso(now);
    const properties = parent.createDiv({ cls: "tm-things-card-properties" });
    const line = (icon: string, label: string, property: TaskEditorProperty, extra?: string, cls = ""): HTMLElement => {
        const element = properties.createDiv({ cls: `tm-things-card-property${cls ? ` ${cls}` : ""}` });
        setIcon(element.createSpan({ cls: "tm-things-card-icon", attr: { "aria-hidden": "true" } }), icon);
        element.createSpan({ cls: "tm-things-card-label", text: label });
        if (extra) element.createSpan({ cls: "tm-things-card-extra", text: extra });
        editable(element, `Edit ${label}`, `card-${property}`, () => edit(property));
        return element;
    };
    if (tags.length) {
        const pills = properties.createDiv({ cls: "tm-things-card-tags" });
        for (const tag of tags) editable(pills.createSpan({ cls: "tm-things-card-tag", text: tag }), `Edit tags: ${tag}`, `card-tag:${tag}`, () => edit("tags"));
    }
    // The scheduled time (and duration) joins its date on one line, as the deadline's time does.
    const time = taskTimeDurationLabel(task.scheduledTime, task.durationMinutes);
    if (task.scheduledDate) {
        const isToday = task.scheduledDate <= today;
        const day = isToday ? "Today" : longDate(task.scheduledDate, now);
        line(isToday ? "star" : "calendar", time ? `${day}, ${time}` : day, "scheduledDate",
            task.scheduledDate < today ? `since ${longDate(task.scheduledDate, now)}` : undefined, isToday ? "is-today" : "");
    } else if (time) line("clock", time, task.scheduledTime ? "scheduledDate" : "durationMinutes");
    if (task.priority) line("signal", `${PRIORITY_NAMES[task.priority]} priority`, "priority", `P${task.priority}`, `is-p${task.priority}`);
    if (task.repeat) line("repeat", `Repeats ${repeatLabel(task.repeat).toLowerCase()}`, "repeat");
    if (task.deadline) {
        const urgent = !task.completed && (deadlineIsOverdue(task.deadline, task.deadlineTime, now) || task.deadline === today);
        const label = `Deadline: ${longDate(task.deadline, now)}${task.deadlineTime ? `, ${taskTimeLabel(task.deadlineTime)}` : ""}`;
        line("flag", label, "deadline", thingsDeadlineLabel(task.deadline, now), urgent ? "is-urgent" : "");
    }
    if (properties.childElementCount) return properties;
    properties.remove();
    return undefined;
}

/** How long a card takes to open or close. */
export const CARD_OPEN_MS = 200;
const CARD_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/** The card's collapsed look, where its row's title sat, and its open look; the two animations run between them. */
function cardKeyframes(card: HTMLElement, rowsHeight: number): [Keyframe, Keyframe] | undefined {
    const win = card.ownerDocument.defaultView;
    if (!win || typeof card.animate !== "function" || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const style = win.getComputedStyle(card);
    return [
        { boxSizing: "border-box", overflow: "hidden", height: `${rowsHeight}px`, marginTop: "0px", marginBottom: "0px", paddingTop: "5px", backgroundColor: "transparent", boxShadow: "none" },
        { boxSizing: "border-box", overflow: "hidden", height: `${card.getBoundingClientRect().height}px`, marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, backgroundColor: style.backgroundColor, boxShadow: style.boxShadow }
    ];
}

/** Everything below the title line: notes, checklist, properties and toolbar. */
function cardDetails(card: HTMLElement): HTMLElement[] {
    return Array.from(card.children).filter((child): child is HTMLElement => !child.classList.contains("tm-things-card-head"));
}

const DETAILS_HIDDEN: Keyframe = { opacity: 0, transform: "translateY(-4px)" };
const DETAILS_SHOWN: Keyframe = { opacity: 1, transform: "none" };

/**
 * Opens the card out of the space its row (and subtask rows) filled: it grows to its full height while
 * its surface fades in, and the notes, checklist and properties fade in below the title.
 */
export function animateCardOpen(card: HTMLElement, fromHeight: number, duration = CARD_OPEN_MS): void {
    const frames = cardKeyframes(card, fromHeight);
    if (!frames) return;
    card.animate(frames, { duration, easing: CARD_EASING });
    for (const child of cardDetails(card)) child.animate([DETAILS_HIDDEN, DETAILS_SHOWN], { duration, easing: CARD_EASING });
}

/**
 * The reverse of opening: the details fade out and the card shrinks back into the space its rows take.
 * Resolves when done; the card holds its closed look until the caller replaces it with the rows.
 */
export async function animateCardClose(card: HTMLElement, toHeight: number, duration = CARD_OPEN_MS): Promise<void> {
    const frames = cardKeyframes(card, toHeight);
    if (!frames) return;
    const options: KeyframeAnimationOptions = { duration, easing: CARD_EASING, fill: "forwards" };
    for (const child of cardDetails(card)) child.animate([DETAILS_SHOWN, DETAILS_HIDDEN], options);
    try { await card.animate([frames[1], frames[0]], options).finished; } catch { /* Cancelled when the card is redrawn. */ }
}
