import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      AGENT_API_KEY: "test-agent-key",
      ADMIN_PASSWORD: "test-admin",
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
