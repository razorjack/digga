/**
 * Draws the app icon from the logo (docs/assets/digga-logo-light.png): the cube on a flyer-yellow
 * squircle with the app's grain, on macOS's 1024 px grid. Writes build/icon.icns, which the
 * package uses, and build/icon.png, the Dock icon of an unpackaged run. macOS only: it renders
 * with Playwright's Chromium and converts with sips and iconutil.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = path.join(ROOT, "docs", "assets", "digga-logo-light.png");
const OUTPUT = path.join(ROOT, "build");
/** The iconset's sizes; each also has an @2x file at twice the size. */
const SIZES = [16, 32, 128, 256, 512];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "digga-icon-"));
try {
  const master = path.join(work, "icon-1024.png");
  await renderIcon(master);
  writeIconset(master, path.join(work, "Digga.iconset"));
  fs.mkdirSync(OUTPUT, { recursive: true });
  execFileSync("iconutil", [
    "-c",
    "icns",
    path.join(work, "Digga.iconset"),
    "-o",
    path.join(OUTPUT, "icon.icns"),
  ]);
  resize(master, 512, path.join(OUTPUT, "icon.png"));
  console.log(`make-icon: wrote ${path.relative(ROOT, OUTPUT)}/icon.icns and icon.png`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

async function renderIcon(file: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    // setContent() waits for the page's load event, which waits for the logo.
    await page.setContent(iconPage(fs.readFileSync(LOGO).toString("base64")));
    await page.screenshot({ path: file, omitBackground: true });
  } finally {
    await browser.close();
  }
}

function writeIconset(master: string, folder: string): void {
  fs.mkdirSync(folder);
  for (const size of SIZES) {
    resize(master, size, path.join(folder, `icon_${size}x${size}.png`));
    resize(master, size * 2, path.join(folder, `icon_${size}x${size}@2x.png`));
  }
}

function resize(source: string, size: number, target: string): void {
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", target], {
    stdio: "ignore",
  });
}

/** The squircle is macOS's 824 px body with its 185 px corners; the grain is styles.css's. */
function iconPage(logoBase64: string): string {
  const grain =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
  return `<!doctype html>
<style>
  body { margin: 0; background: transparent; }
  .squircle {
    position: absolute; left: 100px; top: 100px; width: 824px; height: 824px;
    border-radius: 185px; overflow: hidden; background: #ffd21a;
    box-shadow: 0 10px 20px rgb(0 0 0 / 0.25);
  }
  .squircle::after {
    content: ""; position: absolute; inset: 0; opacity: 0.55; mix-blend-mode: soft-light;
    background: #bcbcbc; mask-image: ${grain};
  }
  img { position: absolute; left: 50%; top: 52%; width: 640px; transform: translate(-50%, -50%); }
</style>
<div class="squircle"><img src="data:image/png;base64,${logoBase64}" alt=""></div>`;
}
