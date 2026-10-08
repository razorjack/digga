import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";
import type { HostName } from "./support/test.ts";

/**
 * The shared suite and the Electron-only scenarios on the packaged app's inspectable variant
 * (docs/e2e/ELECTRON.md#the-packaged-app), which `vp run electron:package` builds. Run it through
 * `vp run e2e:packaged`, which packages the app first.
 */
const EXECUTABLE = fileURLToPath(
  new URL("../../release/inspectable/mac-arm64/Digga.app/Contents/MacOS/Digga", import.meta.url),
);
if (!fs.existsSync(EXECUTABLE))
  throw new Error(`${EXECUTABLE} is not built; run \`vp run electron:package\` first`);

export default defineConfig<{ host: HostName; electronExecutable: string }>({
  ...base,
  projects: [
    {
      name: "electron-packaged",
      grepInvert: /@web\b/,
      use: { host: "electron", electronExecutable: EXECUTABLE },
    },
  ],
});
