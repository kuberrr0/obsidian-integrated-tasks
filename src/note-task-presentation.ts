import { parseTaskLine } from "./parser";
import { taskTokens, type TaskToken } from "./task-tokens";
import { deadlineIsOverdue, taskDeadlineLabel, taskScheduleLabel, taskTimeLabel } from "./task-row-details";
import { notePropertyIconStyle } from "./task-property-icons";

export interface NoteTaskPresentation {
    from: number;
    to: number;
    priority?: number;
    tokens: TaskToken[];
}

export function noteTaskPresentation(line: string, dateFormat?: string, now = new Date()): NoteTaskPresentation | undefined {
    const task = parseTaskLine(line, now, dateFormat);
    const tokens = taskTokens(line, dateFormat);
    if (!task || !tokens.length) return undefined;
    // Never consume destinations or prose between recognized metadata tokens.
    for (let index = 1; index < tokens.length; index++) {
        if (line.slice(tokens[index - 1].to, tokens[index].from).trim()) return undefined;
    }
    return { from: tokens[0].from, to: tokens[tokens.length - 1].to, priority: task.priority, tokens: tokens.map(token => {
        if (token.kind !== "scheduledDate" && token.kind !== "deadline") return token;
        const date = token.kind === "deadline" ? task.deadline! : task.scheduledDate!;
        const rawTime = token.kind === "deadline" ? task.deadlineTime : task.scheduledTime;
        const time = rawTime ? taskTimeLabel(rawTime) : undefined;
        const dateLabel = token.kind === "deadline" ? taskDeadlineLabel(date, now) : taskScheduleLabel(date, now);
        return { ...token, dateLabel, time, label: [dateLabel, time].filter(Boolean).join(", "),
            overdue: !task.completed && (token.kind === "deadline" ? deadlineIsOverdue(date, rawTime, now) : date < `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`) };
    }) };
}

/** Shared presentation for Reading view and Live Preview; links keep their real targets. */
export function renderNoteTaskDetails(root: HTMLElement, presentation: NoteTaskPresentation, link: (token: TaskToken, label: string) => HTMLElement | undefined): void {
    const document = root.ownerDocument;
    root.classList.add("tm-note-task-details");
    for (const kind of ["deadline", "scheduledDate", "tags"] as const) {
        for (const token of presentation.tokens.filter(token => token.kind === kind)) {
            const item = document.createDocumentFragment().createSpan();
            item.className = `tm-note-task-${kind}${token.overdue ? " is-overdue" : ""}`;
            item.setAttribute("data-tm-property-offset", String(token.from - presentation.from));
            item.setAttribute("title", token.description);
            item.setAttribute("aria-label", token.description);
            if (kind !== "scheduledDate") item.setAttribute("style", notePropertyIconStyle(kind));
            const label = token.dateLabel ?? token.label;
            const anchor = token.linkText ? link(token, label) : undefined;
            if (anchor) item.appendChild(anchor);
            else item.appendChild(document.createTextNode(label));
            if (token.time) item.appendChild(document.createTextNode(`, ${token.time}`));
            root.appendChild(item);
        }
    }
}
