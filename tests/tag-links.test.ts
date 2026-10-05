import { afterEach, describe, expect, it } from "vitest";
import { convertTagFormat } from "../src/tag-links";
import { formatTags, parseTags, setTagFormat } from "../src/task-tags";
import { parseTaskLine, scanTasks, serializeTask } from "../src/parser";

afterEach(() => setTagFormat("wikilink"));

describe("the Tag format", () => {
  it("reads only #tag tags as #tag, leaving #[[tag]] in the title", () => {
    setTagFormat("hash");
    expect(parseTaskLine("- [ ] Call mom #family #home/kitchen")).toMatchObject({ title: "Call mom", tags: ["family", "home/kitchen"] });
    expect(parseTaskLine("- [ ] Call mom #[[family]]")).toMatchObject({ title: "Call mom #[[family]]" });
    expect(parseTaskLine("- [ ] Issue #1")).toMatchObject({ title: "Issue #1" });
    expect(parseTaskLine("- [ ] Call #mom about dinner")!.tags).toBeUndefined();
  });

  it("reads only #[[tag]] tags as #[[tag]], leaving #tag in the title", () => {
    setTagFormat("wikilink");
    expect(parseTaskLine("- [ ] Call mom #[[open house]]")).toMatchObject({ title: "Call mom", tags: ["open house"] });
    expect(parseTaskLine("- [ ] Call mom #family")).toMatchObject({ title: "Call mom #family" });
  });

  it("writes tags in the chosen format, hyphenating spaces for #tag", () => {
    setTagFormat("hash");
    expect(formatTags(["open house", "work", "open-house"])).toBe("#open-house #work");
    expect(serializeTask({ title: "Plan", completed: false, indent: 0, destination: "Inbox.md", tags: ["open house"] })).toBe("- [ ] Plan #open-house");
    expect(parseTags("#work #client-notes")).toEqual(["work", "client-notes"]);
    expect(() => parseTags("#[[work]]")).toThrow("#work");
    setTagFormat("wikilink");
    expect(formatTags(["open house"])).toBe("#[[open house]]");
  });

  it("reads the same tasks again after switching", () => {
    const note = "- [ ] Call mom #[[family]]";
    setTagFormat("hash");
    expect(scanTasks("A.md", note)[0].tags).toBeUndefined();
    setTagFormat("wikilink");
    expect(scanTasks("A.md", note)[0].tags).toEqual(["family"]);
  });
});

describe("converting notes' task tags", () => {
  it("turns #[[tag]] into #tag on task lines only, hyphenating spaces", () => {
    const note = "Intro #[[not a task]]\n- [ ] Plan #[[open house]] #[[work]]\n  - [x] Done `#[[code]]` #[[a/b]]\n- Bullet #[[x]]";
    expect(convertTagFormat(note, "hash")).toBe("Intro #[[not a task]]\n- [ ] Plan #open-house #work\n  - [x] Done `#[[code]]` #a/b\n- Bullet #[[x]]");
  });

  it("turns #tag into #[[tag]] on task lines, leaving numbers, code, links and URLs", () => {
    const note = "- [ ] Plan #work #1 [[Note#Part]] `#code` https://x.dev/#anchor #home/kitchen";
    expect(convertTagFormat(note, "wikilink")).toBe("- [ ] Plan #[[work]] #1 [[Note#Part]] `#code` https://x.dev/#anchor #[[home/kitchen]]");
  });

  it("changes nothing already in the format", () => {
    expect(convertTagFormat("- [ ] Plan #work", "hash")).toBe("- [ ] Plan #work");
    expect(convertTagFormat("- [ ] Plan #[[work]]", "wikilink")).toBe("- [ ] Plan #[[work]]");
    // Examples in code blocks and frontmatter stay as written.
    const fenced = "---\r\nx: - [ ] #[[a b]]\r\n---\r\n```md\r\n- [ ] Example #[[open house]]\r\n```\r\n- [ ] Real #[[open house]]\r\n";
    expect(convertTagFormat(fenced, "hash")).toBe(fenced.replace("Real #[[open house]]", "Real #open-house"));
  });
});
