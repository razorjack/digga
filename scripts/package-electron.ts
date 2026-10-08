/**
 * Packages the macOS app (docs/ELECTRON_PLAN.md#packaging) from dist/ and the sources, in two
 * variants: the release build, a dmg and the app in release/, and the inspectable variant in
 * release/inspectable/, which the E2E suite runs on. Run it through `vp run electron:package`,
 * which builds the client first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, type Configuration, Platform } from "electron-builder";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "release");

interface Variant {
  name: string;
  target: "dmg" | "dir";
  output: string;
  /** Playwright attaches through the inspector, so only the E2E variant keeps its arguments. */
  inspectable: boolean;
}

const VARIANTS: Variant[] = [
  { name: "release", target: "dmg", output: OUTPUT, inspectable: false },
  {
    name: "inspectable",
    target: "dir",
    output: path.join(OUTPUT, "inspectable"),
    inspectable: true,
  },
];

if (!fs.existsSync(path.join(ROOT, "dist", "index.html")))
  throw new Error("dist/ is not built; run `vp build` first, or `vp run electron:package`");

for (const variant of VARIANTS) {
  const started = performance.now();
  await build({
    projectDir: ROOT,
    targets: Platform.MAC.createTarget([variant.target], Arch.arm64),
    config: appConfig(variant),
    publish: "never",
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`package-electron: the ${variant.name} build took ${seconds} s`);
}

function appConfig(variant: Variant): Configuration {
  return {
    appId: "io.github.razorjack.digga",
    productName: "Digga",
    directories: { output: variant.output },
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
    // Nothing can run the app's Node as plain Node or attach a debugger to it (decision 161).
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: variant.inspectable,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    },
    // Ad-hoc signed, never notarized (decision 158): no identity, and no hardened runtime, whose
    // library validation can refuse an ad-hoc signed native module.
    mac: {
      target: variant.target,
      category: "public.app-category.music",
      identity: "-",
      hardenedRuntime: false,
      notarize: false,
      gatekeeperAssess: false,
    },
    publish: null,
  };
}
