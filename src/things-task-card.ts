import { setIcon } from "obsidian";
import { formatDate, todayIso } from "./date";
import { repeatLabel } from "./parser";
import { deadlineIsOverdue, editable, taskTimeDurationLabel, taskTimeLabel } from "./task-row-details";
import type { TaskEditorProperty } from "./task-editor";
import { checkboxLabel, statusClass } from "./task-status";
import { renderThingsTaskDetails, thingsDeadlineLabel, type ThingsDetailsOptions } from "./things-row-details";
import { openTagsPopover } from "./task-menu";
import { taskInputRanges, tokenHighlightClass, type InputTokenRange } from "./task-input";
import { draftFromTask, draftFromTitle } from "./task-draft";
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
    /** The date format typed dates are read in, for marking them in the title. */
    dateFormat?: string;
    now?: Date;
    change: (draft: TaskCardDraft) => void;
    toggle: (task: Task, completed: boolean) => void;
    /** Adds tags typed into the card; without it, tags open the task editor. */
    addTags?: (tags: string[]) => void;
    /** Existing tags, suggested while typing one. */
    tagSuggestions?: string[];
    /** Takes a tag off the task. */
    removeTag?: (tag: string) => void;
    /** The note the task lives in, as a button that opens a list to move it elsewhere. */
    project?: { label: string; choose: (anchor: HTMLElement) => void };
    /** Opens a tag's own view. */
    openTag?: (tag: string) => void;
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
    // A text area so long titles wrap, as in Things; it stays one logical line. Behind it, the same text marks
    // what saving reads as a property (dates, p1, #[[tags]]…); the text area's own text is transparent.
    const titleBox = head.createDiv({ cls: "tm-things-card-title-box" });
    const backdrop = titleBox.createDiv({ cls: "tm-things-card-title-backdrop", attr: { "aria-hidden": "true" } });
    const title = titleBox.createEl("textarea", { cls: "tm-things-card-title", attr: { "aria-label": "Title", placeholder: "New To-Do", rows: "1", "data-tm-focus-key": "card-title" } });
    title.value = draft.title;
    const paintTitle = (): void => paintTokens(backdrop, title.value, taskInputRanges(title.value, task.title, now, options.dateFormat));
    paintTitle();
    const notes = card.createEl("textarea", { cls: "tm-things-card-notes", attr: { "aria-label": "Notes", placeholder: "Notes", rows: "1", "data-tm-focus-key": "card-notes" } });
    notes.value = draft.notes;
    let subtask = draft.subtask;
    const change = (): void => options.change({ title: title.value, notes: notes.value, subtask });
    title.addEventListener("input", () => {
        if (/[\r\n]/.test(title.value)) title.value = title.value.replace(/[\r\n]+/g, " ");
        autosize(title); paintTitle(); preview(); change();
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

    // The property lines and the toolbar below them show the task as its title now reads: typing "p1", a date or
    // #[[tag]] into the title shows that property at once, before it is saved.
    let footer: HTMLElement[] = [];
    const renderFooter = (shown: Task, tags: string[], projectLabel = options.project?.label ?? ""): void => {
        for (const element of footer) element.remove();
        const before = new Set(Array.from(card.children));
        renderThingsCardProperties(card, shown, tags, options.edit, now, { open: options.openTag, remove: options.removeTag, add: options.addTags, suggestions: options.tagSuggestions });

        // Things keeps buttons for the properties not set yet at the card's bottom right;
        // the note the task lives in sits at the left, and moves it to another project.
        const toolbar = card.createDiv({ cls: "tm-things-card-toolbar" });
        if (options.project) {
            const project = options.project;
            const button = toolbar.createEl("button", { cls: "tm-things-card-project", attr: { type: "button", "aria-label": `Project: ${projectLabel}. Move to another project`, title: "Move to another project", "aria-haspopup": "listbox", "data-tm-focus-key": "card-project" } });
            setIcon(button.createSpan({ cls: "tm-things-card-project-icon", attr: { "aria-hidden": "true" } }), "folder");
            button.createSpan({ cls: "tm-things-card-project-label", text: projectLabel });
            setIcon(button.createSpan({ cls: "tm-things-card-project-chevron", attr: { "aria-hidden": "true" } }), "chevron-down");
            button.addEventListener("click", event => { event.stopPropagation(); project.choose(button); });
        }
        const add = (icon: string, label: string, key: string, action: () => void): void => {
            const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label, "data-tm-focus-key": `card-add-${key}` } });
            setIcon(button, icon);
            button.addEventListener("click", event => { event.stopPropagation(); action(); });
        };
        if (!shown.scheduledDate) add("calendar", "When", "scheduledDate", () => options.edit("scheduledDate"));
        // Without tags, the Tags button opens the same inline "+" as the pills row, at the top of the properties.
        if (!tags.length) add("tag", "Tags", "tags", () => {
            const addTags = options.addTags;
            if (!addTags) { options.edit("tags"); return; }
            if (card.querySelector(".tm-things-add-tag")) return;
            const properties = card.querySelector<HTMLElement>(".tm-things-card-properties") ?? card.createDiv({ cls: "tm-things-card-properties" });
            if (!properties.parentElement || properties.nextElementSibling !== toolbar) toolbar.before(properties);
            const pills = properties.createDiv({ cls: "tm-things-card-tags" });
            properties.prepend(pills);
            renderAddTag(pills, { add: addTags, suggestions: options.tagSuggestions ?? [], tags, remove: options.removeTag }, true);
        });
        // The first subtask starts here; later ones follow with Enter.
        if (!options.children.length) add("list-todo", "Checklist", "checklist", () => { if (!newRow) startSubtask(undefined).focus(); });
        if (!shown.priority) add("signal", "Priority", "priority", () => options.edit("priority"));
        if (!shown.repeat) add("repeat", "Repeat", "repeat", () => options.edit("repeat"));
        if (!shown.deadline) add("flag", "Deadline", "deadline", () => options.edit("deadline"));
        if (!toolbar.childElementCount) toolbar.remove();
        footer = Array.from(card.children).filter(child => !before.has(child)) as HTMLElement[];
    };
    renderFooter(task, options.tags);
    const preview = (): void => {
        const next = draftFromTitle(task, title.value, now, options.dateFormat);
        const typedTags = (next.tags ?? []).filter(tag => !(task.tags ?? []).includes(tag));
        const moved = next.destination !== draftFromTask(task).destination;
        checkbox.className = `tm-task-checkbox${next.priority ? ` is-p${next.priority}` : ""}${statusClass(task.status)}`;
        renderFooter({ ...task, ...next, path: task.path }, [...options.tags, ...typedTags],
            moved ? next.destination.replace(/\.md(?=#|$)/i, "").split("/").pop()!.replace("#", " › ") : undefined);
    };

    const focus = options.focus === "new" ? typing : options.focus ? card.querySelector<HTMLInputElement>(`[data-tm-focus-key="card-subtask:${CSS.escape(options.focus)}"]`) : undefined;
    if (focus?.isConnected) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
    return card;
}

/**
 * The property lines an open card (and a board card) shows: tags, when (with its time), priority,
 * repeat and deadline, each opening its editor. Draws nothing when the task has none of them.
 */
export function renderThingsCardProperties(parent: HTMLElement, task: Task, tags: string[], edit: (property: TaskEditorProperty) => void, now = new Date(), actions?: TagActions): HTMLElement | undefined {
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
        for (const tag of tags) {
            const pill = pills.createSpan({ cls: "tm-things-card-tag", text: tag });
            if (actions?.open) editable(pill, `Open tag: ${tag}`, `card-tag:${tag}`, () => actions.open!(tag));
            else editable(pill, `Edit tags: ${tag}`, `card-tag:${tag}`, () => edit("tags"));
            // Hovering shows a cross that takes the tag off the task.
            if (actions?.remove) {
                const remove = pill.createEl("button", { cls: "tm-things-tag-remove", attr: { type: "button", "aria-label": `Remove tag ${tag}`, title: "Remove tag", tabindex: "-1" } });
                setIcon(remove, "x");
                remove.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); actions.remove!(tag); });
            }
        }
        if (actions?.add) renderAddTag(pills, { add: actions.add, suggestions: actions.suggestions ?? [], tags, remove: actions.remove });
    }
    // The scheduled time (and duration) joins its date on one line, as the deadline's time does.
    const time = taskTimeDurationLabel(task.scheduledTime, task.durationMinutes);
    if (task.scheduledDate) {
        const isToday = task.scheduledDate === today;
        const day = isToday ? "Today" : longDate(task.scheduledDate, now);
        line(isToday ? "star" : "calendar", time ? `${day}, ${time}` : day, "scheduledDate", undefined, isToday ? "is-today" : "");
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

/** Adding tags right in the card: what to do with them, and which existing tags to suggest. */
export interface TagAdding {
    add: (tags: string[]) => void;
    /** Existing tags, offered in the tag list. */
    suggestions: string[];
    /** The task's own tags, checked in the tag list. */
    tags?: string[];
    /** Takes a tag off the task when it is unchecked in the tag list. */
    remove?: (tag: string) => void;
}

/** What a card's (or board card's) tag pills can do besides opening the tag editor. */
export interface TagActions {
    /** Opens the tag's own view. */
    open?: (tag: string) => void;
    /** Takes the tag off the task (a cross on hover). */
    remove?: (tag: string) => void;
    /** Adds typed tags (the "+" pill). */
    add?: (tags: string[]) => void;
    suggestions?: string[];
}

/** "#errand, [[Office]]" → ["errand", "Office"]: typed tags without their marks, comma-separated. */
export function typedTags(text: string): string[] {
    return [...new Set(text.split(",").map(tag => tag.trim().replace(/^#/, "").replace(/^\[\[(.*)\]\]$/, "$1").trim()).filter(Boolean))];
}

/**
 * A "+" pill after the tags (no fill, dashed border) that becomes a small input when clicked:
 * Enter adds what was typed; Escape, or leaving it empty, puts the pill back. Its dropdown button
 * opens the tag list instead, to check or uncheck existing tags (what was typed becomes its search).
 */
export function renderAddTag(pills: HTMLElement, adding: TagAdding, open = false): void {
    const pill = pills.createEl("button", { cls: "tm-things-card-tag tm-things-add-tag", attr: { type: "button", "aria-label": "Add tag", title: "Add tag", "data-tm-focus-key": "card-add-tag" } });
    setIcon(pill, "plus");
    const start = (): void => {
        const input = createInput(pills);
        pill.replaceWith(input.wrapper);
        input.field.focus();
        let done = false;
        const finish = (save: boolean): void => {
            if (done) return;
            done = true;
            const tags = save ? typedTags(input.field.value) : [];
            input.wrapper.replaceWith(pill);
            if (tags.length) adding.add(tags);
        };
        input.field.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); finish(true); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); pill.focus(); }
            else if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); event.stopPropagation(); input.menu.click(); }
        });
        input.field.addEventListener("blur", () => { if (input.wrapper.isConnected) finish(true); });
        // Keep focus in the field while pressing the button, so leaving it does not add the text.
        input.menu.addEventListener("mousedown", event => event.preventDefault());
        input.menu.addEventListener("click", event => {
            event.stopPropagation();
            const query = input.field.value;
            finish(false);
            const own = adding.tags ?? [];
            openTagsPopover({
                anchor: pill, query,
                tags: [...own.map(name => ({ name, state: "all" as const })), ...adding.suggestions.filter(name => !own.includes(name)).map(name => ({ name, state: "none" as const }))],
                toggle: (tag, on) => { if (on) adding.add([tag]); else adding.remove?.(tag); },
                add: tags => adding.add(tags)
            });
        });
    };
    pill.addEventListener("click", event => { event.stopPropagation(); start(); });
    if (open) start();
}

function createInput(parent: HTMLElement): { wrapper: HTMLElement; field: HTMLInputElement; menu: HTMLButtonElement } {
    const wrapper = parent.createSpan({ cls: "tm-things-card-tag tm-things-add-tag is-editing" });
    const field = wrapper.createEl("input", { type: "text", attr: { "aria-label": "New tag", placeholder: "Tag", spellcheck: "false", autocomplete: "off" } });
    const menu = wrapper.createEl("button", { cls: "tm-things-add-tag-menu", attr: { type: "button", "aria-label": "Choose tags", title: "Choose tags", "aria-haspopup": "dialog", tabindex: "-1" } });
    setIcon(menu, "chevron-down");
    wrapper.remove();
    return { wrapper, field, menu };
}

/** Text with its token ranges marked, for a highlight layer behind a text field. */
export function paintTokens(target: HTMLElement, text: string, ranges: InputTokenRange[]): void {
    target.empty();
    let at = 0;
    for (const range of ranges) {
        if (range.from < at || range.to <= range.from) continue;
        target.appendText(text.slice(at, range.from));
        target.createSpan({ cls: tokenHighlightClass(range.kind, text.slice(range.from, range.to)), text: text.slice(range.from, range.to) });
        at = range.to;
    }
    // A trailing space keeps a final line break's height, as the text area has it.
    target.appendText(`${text.slice(at)} `);
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
