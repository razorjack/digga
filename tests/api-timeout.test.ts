import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createHttpApi } from "../src/client/api.ts";

let server: http.Server | null = null;

/** A server that answers `{}` after `delayMs`, or sends the headers and never finishes the body. */
async function slowServer(behaviour: { delayMs: number } | "stall"): Promise<string> {
  server = http.createServer((_request, response) => {
    if (behaviour === "stall") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      return;
    }
    setTimeout(() => response.end("{}"), behaviour.delayMs);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  server = null;
});

describe("request timeouts", () => {
  it("fail a request the server does not answer in time", async () => {
    const api = createHttpApi(await slowServer({ delayMs: 200 }), {
      localMs: 30,
      discogsMs: 1000,
      dialogMs: 1000,
    });
    await expect(api.getStats()).rejects.toThrow("Digga's server did not answer within 30 ms");
  });

  it("let requests that wait on Discogs take longer", async () => {
    const api = createHttpApi(await slowServer({ delayMs: 80 }), {
      localMs: 30,
      discogsMs: 1000,
      dialogMs: 1000,
    });
    await expect(api.enrichRelease(1)).resolves.toEqual({});
  });

  it("let a request that waits for the user to answer a native dialog take longer", async () => {
    const api = createHttpApi(await slowServer({ delayMs: 80 }), {
      localMs: 30,
      discogsMs: 30,
      dialogMs: 1000,
    });
    await expect(api.chooseDumpFile()).resolves.toEqual({});
  });

  it("cover an answer whose body stalls", async () => {
    const api = createHttpApi(await slowServer("stall"), {
      localMs: 50,
      discogsMs: 1000,
      dialogMs: 1000,
    });
    await expect(api.getQueue()).rejects.toThrow("Digga's server did not answer within 50 ms");
  });

  it("say the same thing whatever the runtime calls a refused connection", async () => {
    const url = await slowServer({ delayMs: 0 });
    server?.close();
    const api = createHttpApi(url, { localMs: 1000, discogsMs: 1000, dialogMs: 1000 });
    await expect(api.getStats()).rejects.toThrow("Can't reach Digga's server");
  });
});
