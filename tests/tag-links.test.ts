import { describe, expect, it } from "vitest";
import { linkPlainTags } from "../src/tag-links";
import { scanTasks } from "../src/parser";

describe("linking plain tags", () => {
  it("moves plain tags to the end as task tags", () => {
    expect(linkPlainTags("- [ ] Call #mom about dinner")).toBe("- [ ] Call about dinner #[[mom]]");
    expect(linkPlainTags("- [ ] #errand Buy milk #home/kitchen")).toBe("- [ ] Buy milk #[[errand]] #[[home/kitchen]]");
    expect(linkPlainTags("Buy milk #errand")).toBe("Buy milk #[[errand]]");
    const [task] = scanTasks("A.md", linkPlainTags("- [ ] Call #mom about dinner [[2026-10-01]]"));
    expect(task).toMatchObject({ title: "Call about dinner", tags: ["mom"], scheduledDate: "2026-10-01" });
  });

  it("keeps the line's indentation and closes the gap before punctuation", () => {
    expect(linkPlainTags("    - [ ] Call #mom, then eat")).toBe("    - [ ] Call, then eat #[[mom]]");
  });

  it("leaves numbers, linked tags, code, links and URLs alone", () => {
    for (const text of ["- [ ] Fix bug #1 today", "- [ ] Buy milk #[[errand]]", "- [ ] Run `git log #main`", "- [ ] Read [[Notes#Heading]]", "- [ ] See https://x.com/#anchor", "- [ ] Read [guide](https://x.com/#top)"]) {
      expect(linkPlainTags(text)).toBe(text);
    }
  });

  it("keeps a task that is only a tag, and merges repeats", () => {
    expect(linkPlainTags("- [ ] #errand")).toBe("- [ ] #errand");
    expect(linkPlainTags("- [ ] Buy #errand milk #errand")).toBe("- [ ] Buy milk #[[errand]]");
  });
});
