import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDb, type Db } from "../src/server/db/db.ts";
import { applySeedItem } from "../src/server/importers/seeds.ts";
import { dumpLoad } from "../src/server/jobs/dump-load.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createSecrets } from "../src/server/secrets.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type {
  ApiError,
  DiscogsAccountResponse,
  DiscogsProfileResponse,
  SetupResponse,
} from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { StyleCensus } from "../src/shared/style-census.ts";
import { FIXTURE_GZ, silentLogger } from "./helpers.ts";

const LISTING = {
  "data/": `<a href="?prefix=data%2F2026%2F">2026/</a>`,
  "data/2026/": `2026-09-01 19:21:51   10.5 GB   <a href="?download=data%2F2026%2Fdiscogs_20260901_releases.xml.gz">x</a>`,
};

let tmp: string;
let db: Db;
let server: DiggaServer;
let listingUp: boolean;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.host === "data.discogs.com") {
    const page = LISTING[url.searchParams.get("prefix") as keyof typeof LISTING];
    return listingUp && page ? new Response(page) : new Response("down", { status: 503 });
  }
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  if (url.pathname === "/oauth/identity")
    return authorization.includes("wrong")
      ? json({ message: "You must authenticate to access this resource." }, 401)
      : json({ id: 1, username: "dj" });
  if (url.pathname === "/users/dj")
    return json({
      id: 1,
      username: "dj",
      num_collection: 312,
      num_wantlist: 1204,
      curr_abbr: "PLN",
    });
  return json({ message: "not found" }, 404);
};

const send = async <T>(method: string, url: string, body?: unknown) => {
  const res = await server.app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-setup-"));
  db = openDb(":memory:");
  listingUp = true;
  const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: createSecrets({ envFile: path.join(tmp, "secrets.env"), env: {} }),
    logger: silentLogger,
    db,
    serveStatic: false,
    persistConfig: false,
    fetchImpl: fakeFetch,
  });
});

afterEach(async () => {
  await server.stop();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function importWant(id: number, year: number, styles: string[]): void {
  applySeedItem(db, {
    kind: "wantlist",
    releaseId: id,
    masterId: null,
    dateAdded: null,
    rating: null,
    notes: null,
    basicInformation: { id, title: `Release ${id}`, year, genres: ["Electronic"], styles },
  });
}

describe("GET /api/setup", () => {
  it("offers the newest catalogue with its size, the space needed and the free space", async () => {
    const { body } = await send<SetupResponse>("GET", "/api/setup");

    expect(body.needed).toBe(true);
    expect(body.catalogue).toMatchObject({
      newest: {
        date: "2026-09-01",
        file: "discogs_20260901_releases.xml.gz",
        bytes: Math.round(10.5 * 1024 ** 3),
        downloaded: false,
      },
      error: null,
      dumpsDir: path.join(tmp, "dumps"),
      neededBytes: Math.round(11.5 * 1024 ** 3),
    });
    expect(body.catalogue.freeBytes).toBeGreaterThan(0);
  });

  it("says why the listing could not be read, and is not needed once a load has finished", async () => {
    listingUp = false;
    await dumpLoad(
      { db, logger: silentLogger },
      { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false },
    );
    const { body } = await send<SetupResponse>("GET", "/api/setup");

    expect(body.needed).toBe(false);
    expect(body.catalogue).toMatchObject({ newest: null, error: "data.discogs.com answered 503" });
  });

  it("tallies the styles and years of imported releases, most first", async () => {
    importWant(1, 1999, ["Drum n Bass", "Jungle"]);
    importWant(2, 1999, ["Drum n Bass"]);
    importWant(3, 2001, ["Drum n Bass"]);
    const { body } = await send<SetupResponse>("GET", "/api/setup");

    expect(body.seeds).toEqual({
      releases: 3,
      styles: [
        {
          name: "Drum n Bass",
          releases: 3,
          years: [
            [1999, 2],
            [2001, 1],
          ],
        },
        { name: "Jungle", releases: 1, years: [[1999, 1]] },
      ],
    });
  });
});

describe("GET /api/styles", () => {
  it("answers with the shipped census, then with the one the last complete load counted", async () => {
    const shipped = (await send<StyleCensus>("GET", "/api/styles")).body;
    expect(shipped.styles.length).toBeGreaterThan(100);

    await dumpLoad(
      { db, logger: silentLogger },
      { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false },
    );
    const counted = (await send<StyleCensus>("GET", "/api/styles")).body;
    expect(counted.releases).toBe(6);
  });
});

describe("connecting Discogs", () => {
  it("keeps a token Discogs accepts and takes the username from it", async () => {
    const { body } = await send<DiscogsAccountResponse>("PUT", "/api/discogs/token", {
      token: "right",
    });

    expect(body).toMatchObject({ username: "dj", hasToken: true, tokenUsername: "dj" });
    expect(server.getConfig().discogs.username).toBe("dj");
  });

  it("does not keep a token Discogs refuses", async () => {
    await send("PUT", "/api/discogs/token", { token: "right" });
    const refused = await send<ApiError>("PUT", "/api/discogs/token", { token: "wrong" });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Discogs refused this token/);
    const account = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    expect(account.body).toMatchObject({ hasToken: true, tokenUsername: "dj" });
  });

  it("reads the collection and wantlist sizes, and a currency only when the API prices in it", async () => {
    await send("PUT", "/api/discogs/token", { token: "right" });
    const { body } = await send<DiscogsProfileResponse>("GET", "/api/discogs/profile");

    expect(body).toEqual({ username: "dj", collection: 312, wantlist: 1204, currency: null });
  });
});
