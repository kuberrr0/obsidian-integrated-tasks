/**
 * A plain Obsidian tag: `#` after a space (or at the start), then letters, digits, `_`, `-` or `/`,
 * with at least one that is not a digit (`#1` is a number, not a tag).
 */
export const PLAIN_TAG = /(^|\s)#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)(?=$|[\s.,;:!?)])/gu;
/** Code, links and URLs keep their `#` as written. */
const OPAQUE = /(`+)[\s\S]*?\1|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g;
const CHECKBOX = /^\s*[-+*]\s+\[[^\]]\]\s*/;

/**
 * Turns plain `#tag`s in a task into task tags: each is taken out of the text and added at the end
 * as `#[[tag]]`, where the task reads its tags. "Call #mom about dinner" becomes
 * "Call about dinner #[[mom]]". A task that would be left with no title keeps its text as it is.
 */
export function linkPlainTags(text: string): string {
    const masked = text.replace(OPAQUE, match => "\u0001".repeat(match.length));
    const tags: string[] = [];
    let rest = "";
    let last = 0;
    for (const match of masked.matchAll(PLAIN_TAG)) {
        const start = match.index + match[1].length;
        const end = match.index + match[0].length;
        rest += text.slice(last, start);
        last = end;
        tags.push(text.slice(start + 1, end));
    }
    if (!tags.length) return text;
    rest += text.slice(last);
    // Close the gaps the tags leave, but never touch the line's indentation.
    const body = rest.replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ").replace(/(\S)[ \t]+([.,;:!?)])/g, "$1$2").trimEnd();
    if (!body.replace(CHECKBOX, "").trim()) return text;
    return `${body} ${[...new Set(tags)].map(tag => `#[[${tag}]]`).join(" ")}`;
}
