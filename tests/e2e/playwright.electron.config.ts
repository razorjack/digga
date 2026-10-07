import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";
import type { HostName } from "./support/test.ts";

/**
 * The shared suite and the Electron-only scenarios on the unpackaged Electron app
 * (docs/e2e/ELECTRON.md). Run it through `vp run e2e:electron`, which builds the client first. The
 * default configuration keeps to the web host, so `vp run e2e`, the smoke set and CI never start
 * Electron.
 */
export default defineConfig<{ host: HostName }>({
  ...base,
  projects: [{ name: "electron", grepInvert: /@web\b/, use: { host: "electron" } }],
});
