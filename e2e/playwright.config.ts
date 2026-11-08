import { defineConfig } from "@playwright/test";

/**
 * Standalone Playwright config for offline POS e2e specs.
 * Kept separate from the app's Vitest config so `bun test` never picks these up.
 */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 900 },
    headless: true,
    trace: "retain-on-failure",
  },
});