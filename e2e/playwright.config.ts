/**
 * Browser-level smoke checks for the two SPAs.
 *
 *   pnpm dev                                    # or the docker stack (WEB_URL/ADMIN_URL below)
 *   pnpm dlx playwright@1.62.1 install chromium # one-time browser download (~150 MB)
 *   pnpm e2e
 *
 * WEB_URL / ADMIN_URL default to the Vite dev servers; for the compose stack use
 * WEB_URL=http://localhost:8080 ADMIN_URL=http://localhost:8081 pnpm e2e
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
