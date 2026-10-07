import { defineConfig, type ReporterDescription } from "@playwright/test";
import { HOST_RESOLVER_RULES } from "./support/browser-guard.ts";

/**
 * The end-to-end suite (docs/E2E_TESTING.md). Run it through `vp run e2e`, which builds the client
 * first: the server serves dist/, so the tests exercise the bundle a user runs.
 */

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.ts",
  outputDir: "../../test-results/e2e",
  globalSetup: "./support/global-setup.ts",
  fullyParallel: true,
  // Each test runs its own server and browser, so CI's four vCPUs are busy with two workers.
  // More workers finish the suite little sooner and slow every test: on four, A11Y-01's Twelves
  // scans reached the 30 s timeout (docs/e2e/HARNESS.md#runner-and-configuration).
  workers: CI ? 2 : undefined,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  timeout: 30_000,
  reporter: CI ? ciReporters() : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "web-chromium",
      grepInvert: /@electron/,
      use: { browserName: "chromium", launchOptions: { args: [HOST_RESOLVER_RULES] } },
    },
  ],
});

/** On GitHub Actions, the github reporter also annotates each failure at its line. */
function ciReporters(): ReporterDescription[] {
  const reporters: ReporterDescription[] = [
    ["list"],
    ["html", { open: "never", outputFolder: "../../playwright-report" }],
  ];
  if (process.env.GITHUB_ACTIONS) reporters.push(["github"]);
  return reporters;
}
