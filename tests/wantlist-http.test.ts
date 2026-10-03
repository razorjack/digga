import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { getRelease } from "../src/server/db/releases.ts";
import { recordWantlistPush } from "../src/server/importers/seeds.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createSecrets, type Secrets } from "../src/server/secrets.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { ApiError, DiscogsAccountResponse, TwelvesResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { fixtureDb, silentLogger, testSecrets, tuneAt } from "./helpers.ts";

interface Call {
  method: string;
  path: string;
}

let tmp: string;
let db: Db;
let server: DiggaServer;
let token: string | undefined;
let calls: Call[];
let bodies: unknown[];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? "GET";
  calls.push({ method, path: url.pathname });
  if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/oauth/identity") {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    return json({ id: 1, username: authorization.includes("other") ? "other" : "dj" });
  }
  if (url.pathname === "/users/dj/wants/1002") return json({ message: "Unauthorized" }, 401);
  if (url.pathname.startsWith("/users/dj/wants/"))
    return method === "DELETE" ? new Response(null, { status: 204 }) : json({ id: 1 }, 201);
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

const wantlistRows = () =>
  (
    db.prepare("SELECT release_id AS id FROM memberships WHERE kind = 'wantlist'").all() as {
      id: number;
    }[]
  ).map((r) => r.id);

const acceptedOnWantlist = async () =>
  (await send<TwelvesResponse>("GET", "/api/twelves?status=accepted")).body.items.map((i) => [
    i.key,
    i.membership.onWantlist,
  ]);

function serverWith(secrets: Secrets): DiggaServer {
  const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  return createServer({
    config: {
      ...DEFAULT_CONFIG,
      sandbox: false,
      discogs: { ...DEFAULT_CONFIG.discogs, username: "dj" },
    },
    paths,
    secrets,
    logger: silentLogger,
    db,
    serveStatic: false,
    persistConfig: false,
    fetchImpl: fakeFetch,
  });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-wantlist-"));
  db = await fixtureDb();
  token = "token";
  calls = [];
  bodies = [];
  server = serverWith(testSecrets(() => token));
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Discogs wantlist over HTTP", () => {
  it("adds a want to the Discogs wantlist and records it for Twelves", async () => {
    await send("POST", "/api/verdicts", { key: "m:501", status: "accepted", releaseId: 1001 });
    expect(await acceptedOnWantlist()).toEqual([["m:501", false]]);
    const res = await send("POST", "/api/discogs/wantlist/1001", {});
    expect(res).toEqual({ status: 200, body: { releaseId: 1001, ok: true } });
    expect(calls).toEqual([{ method: "PUT", path: "/users/dj/wants/1001" }]);
    expect(wantlistRows()).toEqual([1001]);
    expect(await acceptedOnWantlist()).toEqual([["m:501", true]]);
  });

  it("sends the grail and keep tracks and the release's note with a want", async () => {
    await send("POST", "/api/verdicts", { key: "m:501", status: "accepted", releaseId: 1001 });
    await send("PUT", "/api/releases/1001/note", { notes: "from the Kool FM tape" });
    await send("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "keep",
    });
    await send("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "A2",
      tune: tuneAt(db, 1001, "A2"),
      mark: "candidate",
    });
    await send("POST", "/api/discogs/wantlist/1001", {});
    expect(bodies).toEqual([{ notes: "grail A2; keep B1; from the Kool FM tape" }]);
    const row = db.prepare("SELECT notes FROM memberships WHERE release_id = 1001").get();
    expect(row).toEqual({ notes: "grail A2; keep B1; from the Kool FM tape" });
  });

  it("takes a release off the wantlist again", async () => {
    await send("POST", "/api/verdicts", { key: "m:501", status: "accepted", releaseId: 1001 });
    recordWantlistPush(db, getRelease(db, 1001)!, null);
    const res = await send("DELETE", "/api/discogs/wantlist/1001");
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ method: "DELETE", path: "/users/dj/wants/1001" }]);
    expect(wantlistRows()).toEqual([]);
    expect(await acceptedOnWantlist()).toEqual([["m:501", false]]);
  });

  it("explains a missing username or token, and a refused token", async () => {
    const refused = await send<ApiError>("POST", "/api/discogs/wantlist/1002", {});
    expect(refused.status).toBe(502);
    expect(refused.body.error).toMatch(/check the Discogs token in Settings/);
    token = undefined;
    const noToken = await send<ApiError>("POST", "/api/discogs/wantlist/1001", {});
    expect([noToken.status, noToken.body.error]).toEqual([
      400,
      "Set your Discogs token in Settings first",
    ]);
    expect((await send("POST", "/api/discogs/wantlist/999999", {})).status).toBe(404);
    token = "token";
    await send("PUT", "/api/settings", {
      ...server.getConfig(),
      discogs: { ...server.getConfig().discogs, username: "" },
    });
    const noUser = await send<ApiError>("DELETE", "/api/discogs/wantlist/1001");
    expect([noUser.status, noUser.body.error]).toEqual([
      400,
      "Set your Discogs username in Settings first",
    ]);
    expect(wantlistRows()).toEqual([]);
  });

  it("reports whose token is set", async () => {
    const res = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    expect(res.body).toEqual({
      username: "dj",
      hasToken: true,
      tokenSource: "saved",
      tokenUsername: "dj",
      error: null,
      dataAccount: null,
    });
    token = undefined;
    const none = await send<DiscogsAccountResponse>("GET", "/api/discogs/account");
    expect(none.body).toMatchObject({ hasToken: false, tokenSource: null, tokenUsername: null });
  });

  it("saves the token from Settings, in the sandbox too, and removes it again", async () => {
    const envFile = path.join(tmp, ".env");
    await server.stop();
    server = serverWith(createSecrets({ envFile, env: {} }));
    await send("PUT", "/api/settings", { ...server.getConfig(), sandbox: true });

    const saved = await send<DiscogsAccountResponse>("PUT", "/api/discogs/token", {
      token: " abc123 ",
    });
    expect(saved.body).toMatchObject({ hasToken: true, tokenSource: "saved", tokenUsername: "dj" });
    expect(fs.readFileSync(envFile, "utf8")).toBe("DISCOGS_TOKEN=abc123\n");
    expect(calls).toEqual([{ method: "GET", path: "/oauth/identity" }]);

    const invalid = await send<ApiError>("PUT", "/api/discogs/token", { token: "two words" });
    expect(invalid.status).toBe(400);

    const removed = await send<DiscogsAccountResponse>("PUT", "/api/discogs/token", {
      token: null,
    });
    expect(removed.body).toMatchObject({ hasToken: false, tokenSource: null });
    expect(fs.readFileSync(envFile, "utf8")).toBe("");
  });

  it("refuses another account while the library holds one's Discogs data, until it is forgotten", async () => {
    const envFile = path.join(tmp, ".env");
    await server.stop();
    server = serverWith(createSecrets({ envFile, env: {} }));
    await send("PUT", "/api/discogs/token", { token: "token" });
    await send("POST", "/api/discogs/wantlist/1001");
    const config = server.getConfig();
    const rename = (username: string) =>
      send<ApiError>("PUT", "/api/settings", {
        ...config,
        discogs: { ...config.discogs, username },
      });
    const dataAccount = async () =>
      (await send<DiscogsAccountResponse>("GET", "/api/discogs/account")).body.dataAccount;

    expect(await rename("someone")).toEqual({
      status: 409,
      body: {
        error:
          "This library holds the Discogs collection and wantlist of dj; forget them in Settings before using someone",
      },
    });
    const otherToken = await send<ApiError>("PUT", "/api/discogs/token", { token: "other" });
    expect(otherToken.status).toBe(409);
    expect(otherToken.body.error).toMatch(/of dj; forget them in Settings before using other$/);
    expect(fs.readFileSync(envFile, "utf8")).toBe("DISCOGS_TOKEN=token\n");
    expect(await dataAccount()).toBe("dj");

    expect((await send("DELETE", "/api/discogs/data")).body).toEqual({ forgotten: 1 });
    expect(await dataAccount()).toBeNull();
    expect((await rename("someone")).status).toBe(200);
  });

  it("leaves a token from the environment alone", async () => {
    const envFile = path.join(tmp, ".env");
    await server.stop();
    server = serverWith(createSecrets({ envFile, env: { DISCOGS_TOKEN: "from-env" } }));
    const res = await send<ApiError>("PUT", "/api/discogs/token", { token: "abc123" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/set in the environment/);
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it("refuses every digging write while the config says sandbox", async () => {
    const config = server.getConfig();
    await send("PUT", "/api/settings", { ...config, sandbox: true });
    const writes: [string, string, unknown][] = [
      ["POST", "/api/verdicts", { key: "m:501", status: "accepted", releaseId: 1001 }],
      ["DELETE", "/api/verdicts/m:501", undefined],
      ["POST", "/api/track-verdicts", { releaseId: 1001, position: "A1", mark: "keep" }],
      ["POST", "/api/listen-log", { releaseId: 1001, videoId: "x", seconds: 5 }],
      ["POST", "/api/discogs/wantlist/1001", {}],
      ["DELETE", "/api/discogs/wantlist/1001", undefined],
      ["POST", "/api/jobs/import/list", { listId: 77 }],
    ];
    for (const [method, url, body] of writes)
      expect([url, (await send(method, url, body)).status]).toEqual([url, 409]);
    expect(calls).toEqual([]);
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([count("verdicts"), count("track_verdicts"), count("listen_log")]).toEqual([0, 0, 0]);
  });
});
