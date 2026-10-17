import { defineConfig, devices } from "@playwright/test";

const live = process.env.DEPLOY_URL || "https://bigdaddy109.github.io/library-read/";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /deploy-smoke\.mjs$/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: live,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-desktop" }],
});
