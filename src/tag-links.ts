/**
 * A plain Obsidian tag: `#` after a space (or at the start), then letters, digits, `_`, `-` or `/`,
 * with at least one that is not a digit (`#1` is a number, not a tag).
 */
export const PLAIN_TAG = /(^|\s)#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)(?=$|[\s.,;:!?)])/gu;
/** Code, links and URLs keep their `#` as written. */
const OPAQUE = /(`+)[\s\S]*?\1|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g;
const CHECKBOX = /^\s*[-+*]\s+\[[^\]]\]\s*/;

/** Code, Markdown links and URLs, whose `#` stays as written even around a `#[[tag]]`. */
const OPAQUE_BUT_WIKILINKS = /(`+)[\s\S]*?\1|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g;
const WIKILINK_TAG = /(^|\s)#\[\[([^[\]\r\n|]+)\]\](?=$|[\s.,;:!?)])/g;

/**
 * Rewrites the tags on a note's task lines into `to`, the Tag format: `#[[open house]]` becomes `#open-house`, or
 * `#tag` becomes `#[[tag]]`. Only checklist lines change; code, links and URLs keep what they hold.
 */
export function convertTagFormat(content: string, to: "hash" | "wikilink"): string {
    return content.split("\n").map(line => {
        if (!CHECKBOX.test(line)) return line;
        const masked = line.replace(to === "hash" ? OPAQUE_BUT_WIKILINKS : OPAQUE, match => "\u0001".repeat(match.length));
        let result = "";
        let last = 0;
        for (const match of masked.matchAll(to === "hash" ? WIKILINK_TAG : PLAIN_TAG)) {
            const start = match.index + match[1].length;
            result += line.slice(last, start) + (to === "hash" ? `#${match[2].trim().replace(/\s+/g, "-")}` : `#[[${match[2]}]]`);
            last = match.index + match[0].length;
        }
        return result + line.slice(last);
    }).join("\n");
}
