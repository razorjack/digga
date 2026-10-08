/**
 * Packages the macOS app (docs/ELECTRON_PLAN.md#packaging) from dist/ and the sources: a dmg and
 * the app in release/. Run it through `vp run electron:package`, which builds the client first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, type Configuration, Platform } from "electron-builder";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "release");

if (!fs.existsSync(path.join(ROOT, "dist", "index.html")))
  throw new Error("dist/ is not built; run `vp build` first, or `vp run electron:package`");

const started = performance.now();
await build({
  projectDir: ROOT,
  targets: Platform.MAC.createTarget(["dmg"], Arch.arm64),
  config: appConfig(),
  publish: "never",
});
console.log(
  `package-electron: the build took ${((performance.now() - started) / 1000).toFixed(1)} s`,
);

function appConfig(): Configuration {
  return {
    appId: "io.github.razorjack.digga",
    productName: "Digga",
    directories: { output: OUTPUT },
    // The server runs from the .ts sources inside app.asar (decision 160); the client is dist/.
    files: [
      "package.json",
      "dist/**",
      "electron/**",
      "src/**",
      "!src/client/**",
      "tools/dump/**",
      // better-sqlite3's sources and the binaries of other platforms; darwin-arm64.node stays.
      "!node_modules/better-sqlite3/{deps,src}/**",
      "!node_modules/better-sqlite3/binding.gyp",
      "!node_modules/better-sqlite3/prebuilds/{darwin-x64,linux-*,linuxmusl-*,win32-*}.node",
      "!node_modules/node-addon-api/**",
    ],
    // A rebuild would replace the prebuild the CLI, vitest and the web suite load (decision 153).
    npmRebuild: false,
    electronLanguages: ["en"],
    // Ad-hoc signed, never notarized (decision 158): no identity, and no hardened runtime, whose
    // library validation can refuse an ad-hoc signed native module.
    mac: {
      target: "dmg",
      category: "public.app-category.music",
      identity: "-",
      hardenedRuntime: false,
      notarize: false,
      gatekeeperAssess: false,
    },
    publish: null,
  };
}
