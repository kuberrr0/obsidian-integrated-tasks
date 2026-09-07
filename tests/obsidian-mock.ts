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

// Minimal SVG shape for note-pill decoration styles in the Node test host.
export const getIcon = (name: string) => ({
  setAttribute: () => {},
  outerHTML: `<svg xmlns="http://www.w3.org/2000/svg" data-icon="${name}" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>`
});
