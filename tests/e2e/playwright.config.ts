import { defineConfig } from "@playwright/test";

/**
 * The end-to-end suite (docs/E2E_TESTING.md). Run it through `vp run e2e`, which builds the client
 * first: the server serves dist/, so the tests exercise the bundle a user runs.
 */

const CI = Boolean(process.env.CI);

// No host name but localhost resolves in the browser; the context routes then allow only the
// app's port. 127.0.0.1 stays resolvable for the scenario that opens the app there.
const HOST_RESOLVER_RULES =
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1";

export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.e2e.ts",
  outputDir: "../../test-results/e2e",
  globalSetup: "./support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  timeout: 30_000,
  reporter: CI
    ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]]
    : "list",
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
