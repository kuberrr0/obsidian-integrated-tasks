import { expect, it } from "vitest";
import { scanTasks } from "../src/parser";
import { scanSections } from "../src/structure";
import { insertIntoDestination } from "../src/markdown";

it.each([1, 2, 3, 4, 5, 6])("uses Heading %s for grouping and section writes", level => {
  const marker = "#".repeat(level);
  const content = `- [ ] Before\n${marker} First\n- [ ] A\n${marker} Second\n- [ ] B\n`;
  expect(scanSections(content, level).map(heading => heading.name)).toEqual(["First", "Second"]);
  expect(scanTasks("Work.md", content, new Date(), "YYYY-MM-DD", level).map(task => task.section)).toEqual([undefined, "First", "Second"]);
  const inserted = insertIntoDestination(content, ["- [ ] Added"], "Second", "top", level);
  expect(inserted).toContain(`${marker} Second\n- [ ] Added\n- [ ] B`);
  expect(scanTasks("Work.md", inserted, new Date(), "YYYY-MM-DD", level).find(task => task.title === "Added")?.section).toBe("Second");
});

it("ignores other heading levels and preserves Heading 1 as the default", () => {
  const content = "# Project\n- [ ] A\n## Section\n- [ ] B\n### Detail\n- [ ] C\n## Next\n- [ ] D";
  expect(scanSections(content).map(heading => heading.name)).toEqual(["Project"]);
  expect(scanTasks("Work.md", content, new Date(), "YYYY-MM-DD", 2).map(task => task.section)).toEqual([undefined, "Section", "Section", "Next"]);
  expect(insertIntoDestination(content, ["- [ ] Added"], "Section", "bottom", 2)).toContain("- [ ] B\n- [ ] Added\n### Detail");
});
