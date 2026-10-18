/**
 * Draws the app icon from the mole (docs/assets/digga-mole-dark.png): the mole from the waist up in
 * front of a flyer-yellow disc, on the app's dark ground with its grain. Two masters share these
 * layers (docs/ELECTRON_PLAN.md#icon-on-windows-and-linux): macOS's, on Apple's 1024 px grid with
 * its shadow, and Linux's, which fills the canvas on a plate with smaller corners and no shadow.
 * Writes build/icons/<size>x<size>.png, the Linux icons, on any system; Playwright's Chromium draws
 * and scales them. On macOS it also writes build/icon.icns, which the package uses, and
 * build/icon.png, the Dock icon of an unpackaged run, converted with sips and iconutil.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The version drawn for the dark scheme: its light outline keeps the fur off the dark ground. */
const MOLE = path.join(ROOT, "docs", "assets", "digga-mole-dark.png");
/** The visible part of the 1254 px drawing, which the layout frames. */
const MOLE_BOX = { x: 288, y: 108, width: 690, height: 1045 };
const OUTPUT = path.join(ROOT, "build");
/** The macOS iconset's sizes; each also has an @2x file at twice the size. */
const MAC_SIZES = [16, 32, 128, 256, 512];
/** The hicolor theme's sizes, which electron-builder's linux.icon takes as a folder. */
const LINUX_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];

/** Where the plate sits on the 1024 px canvas, and whether it casts a shadow. */
interface Plate {
  inset: number;
  radius: number;
  shadow: boolean;
}

/** Apple's grid: an 824 px body 100 px from each edge, with 185 px corners and a drop shadow. */
const MAC_PLATE: Plate = { inset: 100, radius: 185, shadow: true };
/**
 * About 6% margin on each side, as the square app icons of KDE and GNOME keep, and corners an
 * eighth of the plate. Neither desktop shadows app icons.
 */
const LINUX_PLATE: Plate = { inset: 64, radius: 112, shadow: false };

const work = fs.mkdtempSync(path.join(os.tmpdir(), "digga-icon-"));
const browser = await chromium.launch();
try {
  const mole = fs.readFileSync(MOLE).toString("base64");
  await writeLinuxIcons(browser, mole);
  if (process.platform === "darwin") await writeMacIcons(browser, mole);
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}

async function writeLinuxIcons(browser: Browser, mole: string): Promise<void> {
  const master = path.join(work, "linux-1024.png");
  await renderIcon(browser, iconPage(mole, LINUX_PLATE), master);
  const folder = path.join(OUTPUT, "icons");
  fs.mkdirSync(folder, { recursive: true });
  for (const size of LINUX_SIZES)
    await scaleWithChromium(browser, master, size, path.join(folder, `${size}x${size}.png`));
  console.log(`make-icon: wrote ${path.relative(ROOT, folder)}/ (${LINUX_SIZES.join(", ")} px)`);
}

async function writeMacIcons(browser: Browser, mole: string): Promise<void> {
  const master = path.join(work, "mac-1024.png");
  await renderIcon(browser, iconPage(mole, MAC_PLATE), master);
  writeIconset(master, path.join(work, "Digga.iconset"));
  execFileSync("iconutil", [
    "-c",
    "icns",
    path.join(work, "Digga.iconset"),
    "-o",
    path.join(OUTPUT, "icon.icns"),
  ]);
  resizeWithSips(master, 512, path.join(OUTPUT, "icon.png"));
  console.log(`make-icon: wrote ${path.relative(ROOT, OUTPUT)}/icon.icns and icon.png`);
}

async function renderIcon(browser: Browser, html: string, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  try {
    // setContent() waits for the page's load event, which waits for the drawing.
    await page.setContent(html);
    await page.screenshot({ path: file, omitBackground: true });
  } finally {
    await page.close();
  }
}

/** Chromium draws a downscaled image from its mipmaps, which keeps the small sizes smooth. */
async function scaleWithChromium(
  browser: Browser,
  master: string,
  size: number,
  target: string,
): Promise<void> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  try {
    const source = fs.readFileSync(master).toString("base64");
    await page.setContent(
      `<!doctype html><style>body { margin: 0; background: transparent; } img { display: block; width: ${size}px; height: ${size}px; }</style>` +
        `<img src="data:image/png;base64,${source}" alt="">`,
    );
    await page.screenshot({ path: target, omitBackground: true });
  } finally {
    await page.close();
  }
}

function writeIconset(master: string, folder: string): void {
  fs.mkdirSync(folder);
  for (const size of MAC_SIZES) {
    resizeWithSips(master, size, path.join(folder, `icon_${size}x${size}.png`));
    resizeWithSips(master, size * 2, path.join(folder, `icon_${size}x${size}@2x.png`));
  }
}

function resizeWithSips(source: string, size: number, target: string): void {
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", target], {
    stdio: "ignore",
  });
}

/**
 * The layers were laid out on macOS's 824 px plate and scale with the plate. The mole stands 860
 * units tall, so the plate's lower edge cuts it at the waist and its head and record stay large in
 * the Dock or a panel. The grain is styles.css's.
 */
function iconPage(moleBase64: string, plate: Plate): string {
  const unit = (1024 - 2 * plate.inset) / 824;
  const scale = (860 * unit) / MOLE_BOX.height;
  const left = 512 - (MOLE_BOX.x + MOLE_BOX.width / 2) * scale;
  const top = plate.inset + 490 * unit - (MOLE_BOX.y + MOLE_BOX.height / 2) * scale;
  const disc = { left: plate.inset + 72 * unit, top: plate.inset + 30 * unit, size: 680 * unit };
  const shadow = plate.shadow ? "filter: drop-shadow(0 8px 14px rgb(0 0 0 / 0.25));" : "";
  const grain =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
  return `<!doctype html>
<style>
  body { margin: 0; background: transparent; }
  .shadow { position: absolute; inset: 0; ${shadow} }
  .body {
    position: absolute; inset: 0; clip-path: inset(${plate.inset}px round ${plate.radius}px);
    background: linear-gradient(#26262a, #161618 70%);
  }
  .body::after {
    content: ""; position: absolute; inset: 0; opacity: 0.35; mix-blend-mode: soft-light;
    background: #bcbcbc; mask-image: ${grain};
  }
  /* A faint light edge, as macOS's own icons have, keeps the dark body apart from a dark Dock. */
  .rim {
    position: absolute; inset: ${plate.inset}px; border-radius: ${plate.radius}px;
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.07), inset 0 4px 3px -2px rgb(255 255 255 / 0.12);
  }
  .disc {
    position: absolute; left: ${disc.left}px; top: ${disc.top}px;
    width: ${disc.size}px; height: ${disc.size}px; border-radius: 50%;
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
