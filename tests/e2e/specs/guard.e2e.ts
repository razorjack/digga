import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TriagePage } from "../pages/triage.ts";
import { emptyGuardLog, guardContext } from "../support/browser-guard.ts";
import {
  closeServer,
  type CountingListener,
  countingListener,
  listen,
} from "../support/listener.ts";
import { expect, test } from "../support/test.ts";

const guarded = test.extend<{ forbidden: CountingListener }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  forbidden: async ({}, use) => {
    const listener = await countingListener();
    await use(listener);
    await listener.close();
  },
  diggaOptions: async ({ diggaOptions, forbidden }, use) => {
    await use({
      ...diggaOptions,
      serviceUrls: { youtubeOembed: `http://127.0.0.1:${forbidden.port}/oembed` },
    });
  },
});

guarded(
  "GUARD-01 the server cannot reach a loopback port other than the fakes'",
  { tag: ["@GUARD-01", "@P0"] },
  async ({ app, forbidden }) => {
    const triage = new TriagePage(app);
    await app.open();
    const releaseId = await triage.record.getAttribute("data-release-id");
    const attached = app.page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/releases/${releaseId}/videos`,
    );

    await app.paste("https://www.youtube.com/watch?v=pastedvideo");

    const response = await attached;
    expect(response.ok()).toBe(true);
    await response.finished();
    expect(forbidden.connections()).toBe(0);
    expect(app.server.stderr).toContain(
      `digga-e2e guard: refused a connection to 127.0.0.1:${forbidden.port}`,
    );
  },
);

guarded(
  "GUARD-02 the browser reaches only the allowed origin: no other port, redirect or WebSocket",
  { tag: ["@GUARD-02", "@P0"] },
  async ({ browser, forbidden }) => {
    const allowed = await redirectingServer(forbidden.port);
    const log = emptyGuardLog();
    const context = await browser.newContext();
    const guard = await guardContext(context, log);
    guard.allowOrigin(allowed.origin);
    const page = await context.newPage();
    await page.goto(`${allowed.origin}/`);

    const outcomes = await page.evaluate(async (port) => {
      const load = (url: string) =>
        fetch(url).then(
          () => "loaded",
          () => "failed",
        );
      const openSocket = () =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(`ws://localhost:${port}/`);
          socket.onopen = () => resolve("open");
          socket.onclose = () => resolve("closed");
        });
      return {
        direct: await load(`http://localhost:${port}/`),
        redirect: await load("/redirect"),
        webSocket: await openSocket(),
      };
    }, forbidden.port);
    const navigation = await page.goto(`${allowed.origin}/redirect`).then(
      () => "loaded",
      () => "failed",
    );

    expect(outcomes).toEqual({ direct: "failed", redirect: "failed", webSocket: "closed" });
    expect(navigation).toBe("failed");
    expect(forbidden.connections()).toBe(0);
    expect(log.refused).toEqual([`http://localhost:${forbidden.port}/`]);
    expect(log.redirects).toHaveLength(2);
    expect(log.webSockets).toEqual([`ws://localhost:${forbidden.port}/`]);
    await context.close();
    await allowed.close();
  },
);

/** The test's folder holds the folder the preload allows and, beside it, one it must refuse. */
for (const outside of ["userData", "DIGGA_DATA_DIR"] as const)
  test(
    `GUARD-03 the Electron preload refuses to start with ${outside} outside the test's folder`,
    { tag: ["@GUARD-03", "@P0", "@electron"] },
    async ({ testFolder }) => {
      const allowed = path.join(testFolder, "allowed");
      const elsewhere = path.join(testFolder, "elsewhere");
      const userData = path.join(outside === "userData" ? elsewhere : allowed, "user-data");
      const dataDir = path.join(outside === "DIGGA_DATA_DIR" ? elsewhere : allowed, "library");

      const run = await startElectron({ root: allowed, userData, dataDir });

      expect(run.code).toBe(78);
      expect(run.stderr).toContain(
        `digga-e2e preload: refused to start: ${outside} (${outside === "userData" ? fs.realpathSync(userData) : dataDir}) is not inside the test's folder (${allowed})`,
      );
      // Electron creates the userData folder before the preload runs; nothing is written into it.
      expect(fs.readdirSync(userData)).toEqual([]);
      expect(fs.existsSync(dataDir)).toBe(false);
    },
  );

/**
 * Starts the Electron app with the harness preload and nothing else of the host, so the preload's
 * own check is all that stands between the app and the folders it is given.
 */
async function startElectron(folders: {
  root: string;
  userData: string;
  dataDir: string;
}): Promise<{ code: number | null; stderr: string }> {
  const electron = createRequire(import.meta.url)("electron") as string;
  const preload = fileURLToPath(new URL("../support/electron-preload.cjs", import.meta.url));
  const appDir = fileURLToPath(new URL("../../../", import.meta.url));
  fs.mkdirSync(folders.root, { recursive: true });
  const child = spawn(electron, ["-r", preload, appDir, `--user-data-dir=${folders.userData}`], {
    cwd: folders.root,
    env: {
      PATH: process.env.PATH,
      HOME: folders.root,
      DIGGA_E2E_TEMP_ROOT: folders.root,
      DIGGA_DATA_DIR: folders.dataDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  // An app the preload let through would wait for the host at its start; it must not outlive the test.
  const stray = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  clearTimeout(stray);
  return { code, stderr };
}

/** A page, and a redirect to the forbidden port, as a server bug could send. */
async function redirectingServer(
  forbiddenPort: number,
): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect")
      response.writeHead(302, { location: `http://localhost:${forbiddenPort}/` }).end();
    else response.writeHead(200, { "content-type": "text/html" }).end("<title>allowed</title>");
  });
  const port = await listen(server);
  const close = () => {
    // A request still on its way would hold close() open.
    server.closeAllConnections();
    return closeServer(server);
  };
  return { origin: `http://localhost:${port}`, close };
}
