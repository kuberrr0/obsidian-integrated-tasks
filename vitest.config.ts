import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-window.ts", "tests/setup-tag-format.ts"]
  },
  resolve: {
    alias: {
      "obsidian": fileURLToPath(new URL("./tests/obsidian-mock.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
