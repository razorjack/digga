/**
 * Draws the app icon from the mole (docs/assets/digga-mole-dark.png): the mole from the waist up in
 * front of a flyer-yellow disc, on the app's dark ground with its grain, on macOS's 1024 px grid.
 * Writes build/icon.icns, which the package uses, and build/icon.png, the Dock icon of an
 * unpackaged run. macOS only: it renders with Playwright's Chromium and converts with sips and
 * iconutil. docs/ELECTRON_PLAN.md says what Windows and Linux need instead.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The version drawn for the dark scheme: its light outline keeps the fur off the dark ground. */
const MOLE = path.join(ROOT, "docs", "assets", "digga-mole-dark.png");
/** The visible part of the 1254 px drawing, which the layout frames. */
const MOLE_BOX = { x: 288, y: 108, width: 690, height: 1045 };
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
    // setContent() waits for the page's load event, which waits for the drawing.
    await page.setContent(iconPage(fs.readFileSync(MOLE).toString("base64")));
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

/**
 * Apple's grid: an 824 px body 100 px from each edge, with 185 px corners, and the shadow macOS's
 * own icons carry. The mole stands 860 px tall, so the body's lower edge cuts it at the waist and
 * its head and record stay large in the Dock. The grain is styles.css's.
 */
function iconPage(moleBase64: string): string {
  const scale = 860 / MOLE_BOX.height;
  const left = 512 - (MOLE_BOX.x + MOLE_BOX.width / 2) * scale;
  const top = 590 - (MOLE_BOX.y + MOLE_BOX.height / 2) * scale;
  const grain =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
  return `<!doctype html>
<style>
  body { margin: 0; background: transparent; }
  .shadow { position: absolute; inset: 0; filter: drop-shadow(0 8px 14px rgb(0 0 0 / 0.25)); }
  .body {
    position: absolute; inset: 0; clip-path: inset(100px round 185px);
    background: linear-gradient(#26262a, #161618 70%);
  }
  .body::after {
    content: ""; position: absolute; inset: 0; opacity: 0.35; mix-blend-mode: soft-light;
    background: #bcbcbc; mask-image: ${grain};
  }
  /* A faint light edge, as macOS's own icons have, keeps the dark body apart from a dark Dock. */
  .rim {
    position: absolute; inset: 100px; border-radius: 185px;
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.07), inset 0 4px 3px -2px rgb(255 255 255 / 0.12);
  }
  .disc {
    position: absolute; left: 172px; top: 130px; width: 680px; height: 680px; border-radius: 50%;
    background: radial-gradient(circle at 50% 35%, #ffd93a, #ffd21a 55%, #f4c400);
  }
  img { position: absolute; left: ${left}px; top: ${top}px; width: ${1254 * scale}px; }
</style>
<div class="shadow"><div class="body">
  <div class="disc"></div>
  <img src="data:image/png;base64,${moleBase64}" alt="">
  <div class="rim"></div>
</div></div>`;
}
