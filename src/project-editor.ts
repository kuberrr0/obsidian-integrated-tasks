import { projectDraftProperties, type ProjectDraft } from "./project-creator";
import type { Project } from "./types";

const propertyAliases: Record<string, string[]> = {
  date: ["date", "startdate", "scheduleddate"],
  "end date": ["enddate"], deadline: ["deadline"], priority: ["priority"], parent: ["parent"], tags: ["tags"]
};
const normalize = (key: string): string => key.toLowerCase().replace(/[\s_-]/g, "");

export function projectEditDraft(project: Project, frontmatter: Record<string, unknown>): ProjectDraft {
  const value = (property: string): unknown => {
    const entries = Object.entries(frontmatter);
    return propertyAliases[property].map(alias => entries.find(([key]) => normalize(key) === alias)?.[1])
      .find(value => value !== null && value !== undefined);
  };
  const scalar = (property: string): string => {
    const raw = value(property);
    const single: unknown = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    return typeof single === "string" || typeof single === "number" ? String(single) : "";
  };
  const rawTags = value("tags");
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string") : scalar("tags").split(/[,\s]+/);
  return {
    name: project.name, date: scalar("date"), endDate: scalar("end date"), deadline: scalar("deadline"),
    priority: project.priority ? String(project.priority) : "",
    parent: project.parentPath ?? project.parent ?? "",
    tags: tags.map(tag => tag.replace(/^#/, "")).filter(tag => tag && tag !== "archived").join(", "),
    archived: project.archived
  };
}

/** Update only known project fields, retaining custom properties and existing property names. */
export function applyProjectDraft(frontmatter: Record<string, unknown>, draft: ProjectDraft, dateFormat: string, linkDates: boolean): void {
  const values = projectDraftProperties(draft, dateFormat, linkDates);
  for (const [property, value] of Object.entries(values)) {
    const keys = Object.keys(frontmatter).filter(key => propertyAliases[property].includes(normalize(key)));
    for (const key of keys.length ? keys : [property]) frontmatter[key] = value;
  }
}
