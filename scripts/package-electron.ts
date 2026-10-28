/**
 * Packages the app (docs/ELECTRON_PLAN.md#packaging) from dist/ and the sources, for the system it
 * runs on, in two variants: the release build in release/, a dmg on macOS and an AppImage on
 * Linux, and the inspectable variant in release/inspectable/, which the E2E suite runs on. Run it
 * through `vp run electron:package`, which builds the client first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, build, type Configuration, Platform } from "electron-builder";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "release");

/** What this system builds: Apple silicon only on macOS (decision 159), x64 on Linux. */
interface PackagingSystem {
  platform: Platform;
  arch: Arch;
  /** The release build's target. */
  release: "dmg" | "AppImage";
  /** The better-sqlite3 prebuild the package keeps, as named in its prebuilds folder. */
  prebuild: string;
}

interface Variant {
  name: string;
  target: PackagingSystem["release"] | "dir";
  output: string;
  /** Playwright attaches through the inspector, so only the E2E variant keeps its arguments. */
  inspectable: boolean;
}

const SYSTEM = packagingSystem();

const VARIANTS: Variant[] = [
  { name: "release", target: SYSTEM.release, output: OUTPUT, inspectable: false },
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
    targets: SYSTEM.platform.createTarget([variant.target], SYSTEM.arch),
    config: appConfig(variant),
    publish: "never",
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`package-electron: the ${variant.name} build took ${seconds} s`);
}

function packagingSystem(): PackagingSystem {
  if (process.platform === "darwin")
    return { platform: Platform.MAC, arch: Arch.arm64, release: "dmg", prebuild: "darwin-arm64" };
  if (process.platform === "linux" && process.arch === "x64")
    return { platform: Platform.LINUX, arch: Arch.x64, release: "AppImage", prebuild: "linux-x64" };
  throw new Error(
    `packaging is set up for macOS and x64 Linux, not ${process.platform} on ${process.arch}`,
  );
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
      // The window's icon on Linux, where an AppImage the desktop has not integrated has no entry.
      "build/icons/512x512.png",
      // better-sqlite3's sources and the binaries of other systems; this system's prebuild stays.
      "!node_modules/better-sqlite3/{deps,src}/**",
      "!node_modules/better-sqlite3/binding.gyp",
      ...otherPrebuilds(),
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
      icon: path.join(ROOT, "build", "icon.icns"),
      category: "public.app-category.music",
      identity: "-",
      hardenedRuntime: false,
      notarize: false,
      gatekeeperAssess: false,
    },
    // The desktop entry takes desktopName's name, the window's app ID, so the desktop matches them.
    linux: {
      icon: path.join(ROOT, "build", "icons"),
      category: "Audio",
      syncDesktopName: true,
    },
    // AppRun adds --no-sandbox itself where unprivileged user namespaces are unavailable; by default
    // the desktop entry passes it too, which would turn Chromium's sandbox off everywhere.
    appImage: { executableArgs: [] },
    publish: null,
  };
}

/** Exclusions for the better-sqlite3 binaries of every system but this one. */
function otherPrebuilds(): string[] {
  const folder = path.join(ROOT, "node_modules", "better-sqlite3", "prebuilds");
  return fs
    .readdirSync(folder)
    .filter((file) => file !== `${SYSTEM.prebuild}.node`)
    .map((file) => `!node_modules/better-sqlite3/prebuilds/${file}`);
}
