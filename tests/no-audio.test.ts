import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { requeueNoAudio } from "../src/server/db/no-audio.ts";
import { getVideos, writeVideos } from "../src/server/db/releases.ts";
import { getVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { countRemaining } from "../src/server/queue/query.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { ReleaseDetail } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { filters, fixtureDb, silentLogger } from "./helpers.ts";

let tmp: string;
let db: Db;
let server: DiggaServer;
let titles: Record<string, string>;

const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const watched = new URL(url.searchParams.get("url") ?? "").searchParams.get("v") ?? "";
  const title = titles[watched];
  if (url.pathname !== "/oembed" || title === undefined) return new Response("", { status: 404 });
  return Response.json({ title, author_name: "someone" });
};

const post = async <T>(url: string, body: unknown) => {
  const response = await server.app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-no-audio-"));
  db = await fixtureDb();
  titles = {};
  const paths = resolvePaths({ baseDir: tmp });
  paths.dbFile = ":memory:";
  server = createServer({
    config: { ...DEFAULT_CONFIG, sandbox: false },
    paths,
    secrets: { getDiscogsToken: () => undefined },
    logger: silentLogger,
    db,
    serveStatic: false,
    fetchImpl: fakeFetch,
  });
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const markNoAudio = () =>
  post("/api/verdicts", { key: "m:506", status: "no_audio", releaseId: 1006 });

describe("records without audio", () => {
  it("stay off the queue until a video they did not have appears", async () => {
    await markNoAudio();
    expect(requeueNoAudio(db)).toEqual([]);
    const known = getVideos(db, 1006).map((video) => ({ ...video, matchedPosition: null }));
    const fresh = { ...known[0]!, videoId: "eeeeeeeeee1", src: "https://youtu.be/eeeeeeeeee1" };
    writeVideos(db, 1006, [...known, fresh], { replace: true });
    expect(requeueNoAudio(db)).toEqual(["m:506"]);
    expect(getVerdict(db, "m:506")).toBeNull();
  });

  it("attach a pasted link, matched to a track by YouTube's title, and come back", async () => {
    await markNoAudio();
    titles.ffffffffff1 = "Konflict - Beckoning (Renegade Hardware 1999)";
    const attached = await post<ReleaseDetail>("/api/releases/1006/videos", {
      url: "https://www.youtube.com/watch?v=ffffffffff1&t=30",
    });
    expect(attached.status).toBe(200);
    expect(attached.body.videos.at(-1)).toMatchObject({
      videoId: "ffffffffff1",
      matchedPosition: "AA",
      embeddable: true,
    });
    expect(attached.body.tracks.map((track) => track.hasVideo)).toEqual([true, true]);
    expect(attached.body.verdict).toBeNull();
  });

  it("keep a link YouTube gives no title for, unmatched", async () => {
    const attached = await post<ReleaseDetail>("/api/releases/1006/videos", {
      url: "https://youtu.be/gggggggggg1",
    });
    expect(attached.body.videos.at(-1)).toMatchObject({
      videoId: "gggggggggg1",
      matchedPosition: null,
    });
    expect((await post("/api/releases/1006/videos", { url: "https://vimeo.com/1" })).status).toBe(
      400,
    );
    expect(
      (await post("/api/releases/4242/videos", { url: "https://youtu.be/gggggggggg1" })).status,
    ).toBe(404);
  });

  it("count attached links when the queue skips records without videos", async () => {
    db.prepare("UPDATE videos SET embeddable = 0 WHERE release_id = 1006").run();
    const skip = filters({ skipWithoutVideos: true });
    expect(countRemaining(db, skip)).toBe(1);
    await post("/api/releases/1006/videos", { url: "https://youtu.be/gggggggggg1" });
    expect(countRemaining(db, skip)).toBe(2);
  });
});
