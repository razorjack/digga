import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { ReleaseDetail } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

let tmp: string;
let server: DiggaServer;

const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname !== "/releases/1001") return json({ message: "not found" }, 404);
  return json({
    id: 1001,
    title: "Wormhole",
    lowest_price: 14,
    num_for_sale: 4,
    community: { have: 300, want: 900 },
    videos: [
      {
        uri: "https://www.youtube.com/watch?v=aaaaaaaaaa1",
        title: "Ed Rush & Optical - Wormhole",
        duration: 372,
        embed: true,
      },
    ],
  });
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-enrich-http-"));
  const paths = resolvePaths({ baseDir: tmp });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: { getDiscogsToken: () => "token" },
    logger: silentLogger,
    db: await fixtureDb(),
    serveStatic: false,
    fetchImpl: fakeFetch,
  });
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("enriching one release over HTTP", () => {
  it("stores and returns the release's market data and videos, in the sandbox too", async () => {
    const response = await server.app.request("/api/releases/1001/enrich", { method: "POST" });
    expect(response.status).toBe(200);
    const detail = (await response.json()) as ReleaseDetail;
    expect(detail.release.snapshot).toMatchObject({
      lowestPrice: 14,
      communityWant: 900,
      currency: "EUR",
    });
    expect(detail.videos.map((video) => video.videoId)).toEqual(["aaaaaaaaaa1"]);
  });

  it("answers 502 when Discogs has no such release, and 404 for unknown ones", async () => {
    expect((await server.app.request("/api/releases/1006/enrich", { method: "POST" })).status).toBe(
      502,
    );
    expect((await server.app.request("/api/releases/4242/enrich", { method: "POST" })).status).toBe(
      404,
    );
  });
});
