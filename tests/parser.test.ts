import { describe, expect, it } from "vitest";
import { parseDateExpression } from "../src/date";
import { dailyNoteDateFormat } from "../src/daily-notes";
import { parseTaskInput, parseTaskLine, scanTasks, serializeTask, serializeTaskInput } from "../src/parser";

const reference = new Date(2026, 8, 4, 10, 0, 0);

describe("task parser", () => {
  it("parses canonical trailing metadata", () => {
    expect(parseTaskLine("- [ ] Draft launch [[2026-09-05]] 1h30m {[[2026-09-07]]} p1", reference)).toEqual({
      title: "Draft launch",
      indent: 0,
      completed: false,
      scheduledDate: "2026-09-05",
      durationMinutes: 90,
      deadline: "2026-09-07",
      priority: 1
    });
  });

  it("parses recognized suffix tokens in any order", () => {
    const task = parseTaskLine("  - [x] Send brief p2 [[tomorrow]] 45m", reference);
    expect(task).toMatchObject({
      title: "Send brief",
      indent: 2,
      completed: true,
      scheduledDate: "2026-09-05",
      durationMinutes: 45,
      priority: 2
    });
  });

  it("leaves metadata-like prose in the title", () => {
    expect(parseTaskLine("- [ ] Compare p1 and p2 approaches", reference)?.title).toBe("Compare p1 and p2 approaches");
    expect(parseTaskLine("- [ ] Link [[Design notes]]", reference)?.title).toBe("Link [[Design notes]]");
  });

  it("rejects invalid dates without consuming them", () => {
    const parsed = parseTaskLine("- [ ] Impossible [[2026-02-30]]", reference);
    expect(parsed?.scheduledDate).toBeUndefined();
    expect(parsed?.title).toBe("Impossible [[2026-02-30]]");
  });

  it("resolves natural language inside deadline syntax", () => {
    expect(parseTaskLine("- [ ] Submit proposal {[[tomorrow]]}", reference)).toMatchObject({
      title: "Submit proposal",
      deadline: "2026-09-05"
    });
  });

  it("parses scheduled date and deadline independently when both are present", () => {
    expect(parseTaskInput("do this [[today]] {[[tomorrow]]}", reference)).toMatchObject({
      title: "do this",
      scheduledDate: "2026-09-04",
      deadline: "2026-09-05"
    });
  });

  it("uses a trailing wiki-link marker as the editor destination", () => {
    expect(parseTaskInput("do this [[today]] ~[[Projects/Launch]]", reference)).toMatchObject({
      title: "do this",
      scheduledDate: "2026-09-04",
      destination: "Projects/Launch.md"
    });
  });

  it("serializes metadata in stable order", () => {
    expect(serializeTask({
      title: "Draft launch",
      completed: false,
      destination: "Inbox.md",
      indent: 2,
      scheduledDate: "2026-09-05",
      durationMinutes: 90,
      deadline: "2026-09-07",
      priority: 1
    })).toBe("  - [ ] Draft launch [[2026-09-05]] 1h30m {[[2026-09-07]]} p1");
  });

  it("keeps a title insertion gap before prefilled metadata", () => {
    const raw = serializeTask({
      title: "",
      completed: false,
      destination: "Inbox.md",
      indent: 0,
      scheduledDate: "2026-09-05"
    });
    expect(raw).toBe("- [ ]  [[2026-09-05]]");
    expect(parseTaskLine(raw, reference)).toMatchObject({ title: "", scheduledDate: "2026-09-05" });
  });

  it("includes destination routing in editor text but not saved task text", () => {
    const draft = {
      title: "Route me",
      completed: false,
      destination: "Projects/Launch.md",
      indent: 0,
      scheduledDate: "2026-09-05"
    };
    expect(serializeTaskInput(draft)).toBe("- [ ] Route me [[2026-09-05]] ~[[Projects/Launch]]");
    expect(serializeTask(draft)).toBe("- [ ] Route me [[2026-09-05]]");
  });

  it("serializes task links with the Daily Notes date format", () => {
    const draft = {
      title: "Journal task",
      completed: false,
      destination: "Inbox.md",
      indent: 0,
      scheduledDate: "2026-09-05",
      deadline: "2026-09-07"
    };
    expect(serializeTask(draft, "YYYY/MM/DD")).toBe(
      "- [ ] Journal task [[2026/09/05]] {[[2026/09/07]]}"
    );
  });

  it("parses task links written in the Daily Notes date format", () => {
    expect(parseTaskLine(
      "- [ ] Local format [[05-09-2026]] {[[07-09-2026]]}",
      reference,
      "DD-MM-YYYY"
    )).toMatchObject({
      title: "Local format",
      scheduledDate: "2026-09-05",
      deadline: "2026-09-07"
    });
  });
});

describe("date parser", () => {
  it("normalizes natural language against the supplied reference", () => {
    expect(parseDateExpression("tomorrow", reference)).toBe("2026-09-05");
    expect(parseDateExpression("next Friday", reference)).toBe("2026-09-11");
  });

  it("normalizes dates written in the Daily Notes format", () => {
    expect(parseDateExpression("Sep 5, 2026", reference, "MMM D, YYYY")).toBe("2026-09-05");
  });
});

describe("Daily Notes settings", () => {
  it("reads the configured format and falls back to Obsidian's default", () => {
    const configured = {
      internalPlugins: {
        getPluginById: () => ({ instance: { options: { format: "DD.MM.YYYY" } } })
      }
    };
    expect(dailyNoteDateFormat(configured as never)).toBe("DD.MM.YYYY");
    expect(dailyNoteDateFormat({} as never)).toBe("YYYY-MM-DD");
  });
});

describe("task scanner", () => {
  it("ignores frontmatter and fenced code", () => {
    const tasks = scanTasks("Work.md", [
      "---",
      "sample: '- [ ] not a task'",
      "---",
      "- [ ] Real task",
      "```markdown",
      "- [ ] Example only",
      "```"
    ].join("\n"), reference);
    expect(tasks.map((task) => task.title)).toEqual(["Real task"]);
  });

  it("constructs parent-child relationships and subtree ranges", () => {
    const tasks = scanTasks("Project.md", [
      "- [ ] Parent",
      "  - [x] First child",
      "    - [ ] Grandchild",
      "  - [ ] Second child",
      "- [ ] Sibling"
    ].join("\n"), reference);
    expect(tasks).toHaveLength(5);
    expect(tasks[0].childIds).toEqual([tasks[1].id, tasks[3].id]);
    expect(tasks[1].childIds).toEqual([tasks[2].id]);
    expect(tasks[0].endLine).toBe(3);
    expect(tasks[1].endLine).toBe(2);
    expect(tasks[4].parentId).toBeUndefined();
  });
});


describe("project sections", () => {
  it("round trips heading destinations with aliases and extensions", () => {
    for (const input of ["Project#Plan", "Project.md#Plan|Alias"]) {
      const parsed = parseTaskInput(`Do it ~[[${input}]]`)!;
      expect(parsed.destination).toBe("Project.md#Plan");
      expect(serializeTaskInput({ ...parsed, destination: parsed.destination! })).toBe("- [ ] Do it ~[[Project#Plan]]");
    }
  });

  it("assigns headings in document order and keeps task trees within sections", () => {
    const tasks = scanTasks("Project.md", "- [ ] Root\n## Plan\n- [ ] Parent\n  - [ ] Child\n### Next\n  - [ ] Separate\n## Plan\n- [ ] Repeated");
    expect(tasks.map((task) => task.section)).toEqual([undefined, "Plan", "Plan", "Next", "Plan"]);
    expect(tasks.map((task) => task.sectionLine)).toEqual([undefined, 1, 1, 4, 6]);
    expect(tasks[1].endLine).toBe(3);
    expect(tasks[3].parentId).toBeUndefined();
  });
});


describe("plain-language task input dates", () => {
  it.each([
    ["Call today", "Call", "2026-09-04"],
    ["Call tomorrow", "Call", "2026-09-05"],
    ["Review next Friday", "Review", "2026-09-11"],
    ["Call in two days", "Call", "2026-09-06"],
    ["today call Sam", "call Sam", "2026-09-04"],
    ["Call tomorrow about the launch", "Call about the launch", "2026-09-05"]
  ])("parses %s", (input, title, scheduledDate) => {
    expect(parseTaskInput(input, reference)).toMatchObject({ title, scheduledDate });
  });

  it("combines plain dates with duration, priority, deadline, and heading destination", () => {
    expect(parseTaskInput("Review 30m p1 tomorrow {[[next Friday]]} ~[[Project#Plan]]", reference)).toMatchObject({
      title: "Review", scheduledDate: "2026-09-05", durationMinutes: 30,
      deadline: "2026-09-11", priority: 1, destination: "Project.md#Plan"
    });
  });

  it("keeps explicit dates authoritative and leaves saved prose untouched", () => {
    expect(parseTaskInput("Discuss today [[2026-09-06]]", reference)).toMatchObject({ title: "Discuss today", scheduledDate: "2026-09-06" });
    expect(parseTaskLine("- [ ] Discuss tomorrow", reference)?.scheduledDate).toBeUndefined();
    expect(parseTaskInput("Discuss tomorrow", reference, undefined, false)?.scheduledDate).toBeUndefined();
  });

  it.each(["Read [[Today ideas]]", "Read `tomorrow`", "Read [tomorrow](https://example.com)", "Call May", "Estimate 30m"]) (
    "does not infer a date from protected text or duration: %s", (input) => {
      expect(parseTaskInput(input, reference)?.scheduledDate).toBeUndefined();
    }
  );
});


describe("curly-brace deadline input", () => {
  it.each([
    ["Submit {tomorrow}", "Submit", "2026-09-05"],
    ["Submit {next Friday}", "Submit", "2026-09-11"],
    ["Submit {2026-09-10}", "Submit", "2026-09-10"],
    ["Submit {10-09-2026}", "Submit", "2026-09-10"],
    ["{tomorrow} submit proposal", "submit proposal", "2026-09-05"],
    ["Submit {tomorrow} proposal", "Submit proposal", "2026-09-05"]
  ])("resolves %s as a deadline", (input, title, deadline) => {
    const task = parseTaskInput(input, reference, "DD-MM-YYYY");
    expect(task).toMatchObject({ title, deadline });
    expect(task?.scheduledDate).toBeUndefined();
  });

  it("keeps scheduled date and deadline separate with other metadata", () => {
    expect(parseTaskInput("Submit {tomorrow} today 30m p1 ~[[Project#Plan]]", reference)).toMatchObject({
      title: "Submit", scheduledDate: "2026-09-04", deadline: "2026-09-05",
      durationMinutes: 30, priority: 1, destination: "Project.md#Plan"
    });
  });

  it("saves the deadline in the existing canonical link format", () => {
    const parsed = parseTaskInput("Submit {tomorrow}", reference)!;
    expect(serializeTask({ ...parsed, destination: "Inbox.md" })).toBe("- [ ] Submit {[[2026-09-05]]}");
  });

  it.each(["Submit {2026-02-30}", "Submit {today nonsense}", "Submit {tomorrow", "Read `{tomorrow}`", "Read [[{tomorrow}]] notes"])(
    "preserves invalid, unfinished, or protected input: %s", (input) => {
      expect(parseTaskInput(input, reference)).toMatchObject({ title: input });
      expect(parseTaskInput(input, reference)?.deadline).toBeUndefined();
      expect(parseTaskInput(input, reference)?.scheduledDate).toBeUndefined();
    }
  );
});
