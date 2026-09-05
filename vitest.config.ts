import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "obsidian": new URL("./tests/obsidian-mock.ts", import.meta.url).pathname,
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
