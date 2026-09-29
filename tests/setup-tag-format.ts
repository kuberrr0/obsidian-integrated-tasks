import { beforeEach } from "vitest";
import { setTagFormat } from "../src/task-tags";

// Most tests were written with #[[tag]] tags; tests of the #tag format (the default) switch to it themselves.
// Loading the plugin applies its own default, so every test starts again from #[[tag]].
setTagFormat("wikilink");
beforeEach(() => setTagFormat("wikilink"));
