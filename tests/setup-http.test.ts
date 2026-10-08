import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDb, setMeta, type Db } from "../src/server/db/db.ts";
import { createDataDumpClient } from "../src/server/discogs/data-dumps.ts";
import { applySeedItem } from "../src/server/importers/seeds.ts";
import { dumpLoad } from "../src/server/jobs/dump-load.ts";
import { type Paths, resolvePaths } from "../src/server/paths.ts";
import { createSecrets, type SecretEncryption } from "../src/server/secrets.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { readSetup } from "../src/server/setup.ts";
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
let paths: Paths;
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
  paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
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
    expect(body.desktop).toBe(false);
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

  it("says nothing of the free space when the filesystem cannot tell it", async () => {
    const asked: string[] = [];
    const setup = await readSetup(
      { db, paths, dataDumps: createDataDumpClient({ fetchImpl: fakeFetch }), desktop: null },
      {
        freeBytes: async (dir) => {
          asked.push(dir);
          throw new Error("ENOSYS: function not implemented, statfs");
        },
      },
    );

    // The dumps folder does not exist yet, so its nearest existing folder is asked.
    expect(asked).toEqual([tmp]);
    expect(setup.catalogue).toMatchObject({
      newest: { file: "discogs_20260901_releases.xml.gz", downloaded: false },
      error: null,
      freeBytes: null,
      neededBytes: Math.round(11.5 * 1024 ** 3),
    });
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

  it("is not needed for a library loaded before loads were recorded", async () => {
    setMeta(db, "dump_loaded_at", "2026-09-27T18:44:16.434Z");
    const { body } = await send<SetupResponse>("GET", "/api/setup");

    expect(body.needed).toBe(false);
    expect((await send<ApiError>("DELETE", "/api/setup/load")).status).toBe(409);
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

describe("changing the picks during the first load", () => {
  it("deletes what the unfinished load added, leaving a record with a verdict as stubs", async () => {
    const load = await dumpLoad(
      { db, logger: silentLogger },
      { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false, limit: 3 },
    );
    // As a load that never finished leaves them.
    db.prepare("UPDATE dump_loads SET finished_at = NULL WHERE id = ?").run(load.load!.id);
    db.prepare("DELETE FROM meta WHERE key = 'dump_loaded_at'").run();
    await send("POST", "/api/verdicts", { key: "m:501", status: "rejected" });

    // 1001 and 1002 are the two pressings of m:501, which has a verdict now.
    const forgotten = await send<{ deleted: number }>("DELETE", "/api/setup/load");
    expect(forgotten.body).toEqual({ deleted: 1 });
    expect(db.prepare("SELECT id, in_universe FROM releases ORDER BY id").all()).toEqual([
      { id: 1001, in_universe: 0 },
      { id: 1002, in_universe: 0 },
    ]);
  });

  it("refuses once a load has finished", async () => {
    await dumpLoad(
      { db, logger: silentLogger },
      { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false },
    );
    expect((await send<ApiError>("DELETE", "/api/setup/load")).status).toBe(409);
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

/**
 * Stands in for safeStorage under one Keychain key: it decrypts only what it encrypted itself, as
 * after a new build's Keychain prompt was declined or the "Digga Safe Storage" item was replaced.
 */
function keychainEncryption(key: string, available = true) {
  const calls = { decrypt: 0 };
  const encryption: SecretEncryption = {
    isAvailable: () => available,
    encrypt: (text) => Buffer.from(`${key}:${text}`).toString("base64"),
    decrypt(stored) {
      calls.decrypt += 1;
      const text = Buffer.from(stored, "base64").toString();
      if (!available || !text.startsWith(`${key}:`))
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
        );
      return text.slice(key.length + 1);
    },
  };
  return { encryption, calls };
}

describe("a saved token this build cannot decrypt", () => {
  let secretsFile: string;

  /** The app's server on the same library, with the Keychain as a new build finds it. */
  async function restartWith(encryption: SecretEncryption): Promise<void> {
    await server.stop();
    server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: createSecrets({ envFile: secretsFile, env: {}, encryption }),
      logger: silentLogger,
      db,
      serveStatic: false,
      persistConfig: false,
      fetchImpl: fakeFetch,
    });
  }

  beforeEach(() => {
    secretsFile = path.join(tmp, "secrets.env");
    const earlierBuild = keychainEncryption("earlier-build").encryption;
    fs.writeFileSync(secretsFile, `DISCOGS_TOKEN_ENCRYPTED=${earlierBuild.encrypt("right")}\n`);
    importWant(1201, 1999, ["Techstep"]);
  });

  it("reads as no token once, so Settings asks for one, and saves the new one encrypted", async () => {
    const keychain = keychainEncryption("new-key");
    await restartWith(keychain.encryption);

    const first = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    const second = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    expect(first.status).toBe(200);
    expect(second.body).toMatchObject({ hasToken: false, tokenSource: null, error: null });
    expect(keychain.calls.decrypt).toBe(1);

    const saved = await send<DiscogsAccountResponse>("PUT", "/api/discogs/token", {
      token: "right",
    });
    expect(saved.body).toMatchObject({
      hasToken: true,
      tokenSource: "saved",
      tokenEncrypted: true,
      tokenUsername: "dj",
    });
    expect(fs.readFileSync(secretsFile, "utf8")).toBe(
      `DISCOGS_TOKEN_ENCRYPTED=${keychain.encryption.encrypt("right")}\n`,
    );
    expect(db.prepare("SELECT count(*) AS n FROM releases").get()).toEqual({ n: 1 });
  });

  it("saves the new token as text when the Keychain cannot be used at all", async () => {
    await restartWith(keychainEncryption("declined", false).encryption);

    const account = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    expect(account.body).toMatchObject({ hasToken: false, tokenSource: null });

    const saved = await send<DiscogsAccountResponse>("PUT", "/api/discogs/token", {
      token: "right",
    });
    expect(saved.body).toMatchObject({ tokenSource: "saved", tokenEncrypted: false });
    expect(fs.readFileSync(secretsFile, "utf8")).toBe("DISCOGS_TOKEN=right\n");
  });
});
