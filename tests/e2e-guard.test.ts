import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

// The guard patches the process it loads into, so it only ever runs in a child process here.
const GUARD = pathToFileURL(fileURLToPath(new URL("./e2e/support/guard.ts", import.meta.url))).href;

const servers: net.Server[] = [];
const folders: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe("the end-to-end network guard", () => {
  it("refuses every client and call form except the allowed loopback port, in workers too", async () => {
    const forbidden = await countingListener();
    const allowed = await listen(
      http.createServer((request, response) => {
        if (request.url === "/redirect")
          response.writeHead(302, { location: `http://127.0.0.1:${forbidden.port}/` }).end();
        else response.end("ok");
      }),
    );

    const results = await runGuarded(writeChildScript(allowed, forbidden.port), allowed);

    expect(results).toEqual({
      "fetch 127.0.0.1": "refused",
      "fetch localhost": "refused",
      "fetch an external host": "refused",
      "fetch a redirect": "refused",
      "http.get": "refused",
      "https.get": "refused",
      "tls.connect": "refused",
      "net.connect(port, host)": "refused",
      "net.connect(options)": "refused",
      "socket.connect(options)": "refused",
      "a worker's fetch": "refused",
      "fetch the allowed port": "ok",
    });
    expect(forbidden.connections()).toBe(0);
  });
});

/** Writes the script that tries each client, and the worker it starts, to a temp folder. */
function writeChildScript(allowedPort: number, forbiddenPort: number): string {
  const forbidden = `127.0.0.1:${forbiddenPort}`;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "digga-guard-"));
  folders.push(folder);
  const worker = path.join(folder, "worker.mjs");
  fs.writeFileSync(
    worker,
    `import { parentPort } from "node:worker_threads";
     fetch("http://${forbidden}/").then(() => "connected", (error) => String(error.cause?.message ?? error.message))
       .then((outcome) => parentPort.postMessage(outcome.includes("digga-e2e guard") ? "refused" : outcome));`,
  );
  const main = path.join(folder, "main.mjs");
  fs.writeFileSync(
    main,
    `
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import tls from "node:tls";
    import { Worker } from "node:worker_threads";
    const verdict = (text) => (String(text).includes("digga-e2e guard") ? "refused" : String(text));
    const viaFetch = (url) => fetch(url).then((response) => response.text(), (error) => verdict(error.cause?.message ?? error.message));
    const viaEvents = (emitter, connected) => new Promise((resolve) => {
      emitter.once(connected, () => { emitter.destroy(); resolve("connected"); });
      emitter.once("error", (error) => resolve(verdict(error.message)));
    });
    const viaWorker = () => new Promise((resolve) => new Worker(${JSON.stringify(worker)}).once("message", resolve));
    const results = {
      "fetch 127.0.0.1": await viaFetch("http://${forbidden}/"),
      "fetch localhost": await viaFetch("http://localhost:${forbiddenPort}/"),
      "fetch an external host": await viaFetch("https://example.com/"),
      "fetch a redirect": await viaFetch("http://127.0.0.1:${allowedPort}/redirect"),
      "http.get": await viaEvents(http.get("http://${forbidden}/"), "response"),
      "https.get": await viaEvents(https.get("https://${forbidden}/"), "response"),
      "tls.connect": await viaEvents(tls.connect(${forbiddenPort}, "127.0.0.1"), "secureConnect"),
      "net.connect(port, host)": await viaEvents(net.connect(${forbiddenPort}, "127.0.0.1"), "connect"),
      "net.connect(options)": await viaEvents(net.connect({ port: ${forbiddenPort}, host: "localhost" }), "connect"),
      "socket.connect(options)": await viaEvents(new net.Socket().connect({ port: ${forbiddenPort} }), "connect"),
      "a worker's fetch": await viaWorker(),
      "fetch the allowed port": await viaFetch("http://127.0.0.1:${allowedPort}/"),
    };
    console.log(JSON.stringify(results));
  `,
  );
  return main;
}

/** Runs the script in a Node process that loads the guard as the harness does. */
function runGuarded(script: string, allowedPort: number): Promise<Record<string, string>> {
  const child = spawn(process.execPath, [script], {
    env: {
      PATH: process.env.PATH,
      NODE_OPTIONS: `--import=${GUARD}`,
      DIGGA_E2E_ALLOWED_PORT: String(allowedPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  return new Promise((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) resolve(JSON.parse(stdout) as Record<string, string>);
      else reject(new Error(`the guarded script failed (${code}): ${stderr}`));
    });
  });
}

async function countingListener(): Promise<{ port: number; connections: () => number }> {
  let connections = 0;
  const port = await listen(
    net.createServer((socket) => {
      connections += 1;
      socket.destroy();
    }),
  );
  return { port, connections: () => connections };
}

function listen(server: net.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}
