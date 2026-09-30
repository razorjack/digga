import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer } from "../src/server/server.ts";
import type { ApiError } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { Job } from "../src/shared/types.ts";
import type { GrowingState } from "../tools/dump/growing.ts";
import { loadDump } from "../tools/dump/load.ts";
import { FIXTURE_GZ, silentLogger, testSecrets } from "./helpers.ts";

const DUMP = "discogs_20260901_releases.xml.gz";
const BYTES = fs.readFileSync(FIXTURE_GZ);

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-growing-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A writer that writes the fixture dump to `<file>.part` in three steps. */
async function writeInSteps(file: string): Promise<void> {
  const steps = [BYTES.subarray(0, 100), BYTES.subarray(100, 700), BYTES.subarray(700)];
  for (const step of steps) {
    await sleep(300);
    fs.appendFileSync(`${file}.part`, step);
  }
}

describe("a load reading a dump that is still downloading", () => {
  it("reads it as it arrives and ends once it is whole", async () => {
    const file = path.join(dir, DUMP);
    let state: GrowingState = { state: "writing" };
    const growing = { state: () => state, totalBytes: () => BYTES.length };
    const db = openDb(":memory:");

    const loading = loadDump(
      db,
      { file, styles: ["Drum n Bass"], loadYears: null },
      { growing, logger: silentLogger },
    );
    await writeInSteps(file);
    fs.renameSync(`${file}.part`, file);
    state = { state: "whole" };

    expect(await loading).toMatchObject({ scanned: 6, matched: 5, upserted: 5 });
    db.close();
  });

  it("fails with the writer's reason when the download stops", async () => {
    const file = path.join(dir, DUMP);
    let state: GrowingState = { state: "writing" };
    const db = openDb(":memory:");

    const loading = loadDump(
      db,
      { file, styles: ["Drum n Bass"], loadYears: null },
      { growing: { state: () => state, totalBytes: () => null }, logger: silentLogger },
    );
    fs.writeFileSync(`${file}.part`, BYTES.subarray(0, 500));
    await sleep(300);
    fs.rmSync(`${file}.part`);
    state = { state: "failed", reason: "The download stopped: connection reset" };

    await expect(loading).rejects.toThrow("The download stopped: connection reset");
    db.close();
  });
});

describe("starting a load during the download", () => {
  it("reads the dump the download is writing, in a worker, and both finish", async () => {
    const paths = resolvePaths({ dataDir: dir, distDir: path.join(dir, "dist") });
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      persistConfig: false,
      fetchImpl: slowDataDumps(),
    });
    const post = async (url: string, body?: unknown) => {
      const response = await server.app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Job & ApiError };
    };
    try {
      const download = await post("/api/jobs/dump-download");
      const load = await post("/api/jobs/dump-load", { file: DUMP });
      expect(load.status).toBe(202);
      expect((await post("/api/jobs/dump-load", { file: DUMP })).body.error).toBe(
        'Wait until "Load dump" has finished',
      );

      await expect
        .poll(() => server.jobs.get(load.body.id)?.status, { timeout: 5000 })
        .toBe("done");
      expect(server.jobs.get(download.body.id)?.status).toBe("done");
      expect(server.db.prepare("SELECT COUNT(*) FROM releases").pluck().get()).toBe(5);
    } finally {
      await server.stop();
    }
  });
});

/** data.discogs.com serving the fixture dump in three slow pieces. */
function slowDataDumps(): typeof fetch {
  const listing: Record<string, string> = {
    "data/": `<a href="?prefix=data%2F2026%2F">2026/</a>`,
    "data/2026/": `<a href="?download=data%2F2026%2F${DUMP}">x</a>`,
  };
  const checksum = createHash("sha256").update(BYTES).digest("hex");
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const prefix = url.searchParams.get("prefix");
    const download = url.searchParams.get("download") ?? "";
    if (prefix !== null) return new Response(listing[prefix] ?? "");
    if (download.endsWith("CHECKSUM.txt")) return new Response(`${checksum} ${DUMP}\n`);
    return new Response(slowBody(), { headers: { "content-length": String(BYTES.length) } });
  };
}

function slowBody(): ReadableStream<Uint8Array> {
  const pieces = [BYTES.subarray(0, 100), BYTES.subarray(100, 700), BYTES.subarray(700)];
  return new ReadableStream({
    async pull(controller) {
      await sleep(200);
      const piece = pieces.shift();
      if (piece) controller.enqueue(new Uint8Array(piece));
      else controller.close();
    },
  });
}
