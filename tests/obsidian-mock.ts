export { default as moment } from "moment";

// Obsidian ships declarations only; these stand-ins exercise vault writes in Node.
export class TFile { path = ""; }
export class TFolder {}
export const normalizePath = (path: string): string => path;
export const getAllTags = (cache: { tags?: Array<{ tag: string }>; frontmatter?: { tags?: string[] } }): string[] => [
  ...(cache.tags ?? []).map((entry) => entry.tag),
  ...(cache.frontmatter?.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`)
];

export const Platform = { isMacOS: true };
