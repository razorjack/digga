import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serves the built frontend from an absolute dist dir. Written by hand so nothing
 * depends on process.cwd(); Electron can point distDir anywhere.
 */
export function createStaticHandler(distDir: string) {
  const root = path.resolve(distDir);
  return async (c: Context): Promise<Response> => {
    const url = new URL(c.req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const target = path.resolve(root, `.${rel}`);
    const fallback = path.join(root, "index.html");
    const inside = target === root || target.startsWith(root + path.sep);
    let file = inside && fs.existsSync(target) && fs.statSync(target).isFile() ? target : fallback;
    if (!fs.existsSync(file)) return c.text("dist/ not built. Run `vp build` first.", 404);
    if (file === fallback && !fs.existsSync(fallback)) file = fallback;
    const ext = path.extname(file).toLowerCase();
    const body = await fs.promises.readFile(file);
    const immutable = rel.startsWith("/assets/") && file !== fallback;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };
}
