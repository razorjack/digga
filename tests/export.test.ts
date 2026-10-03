import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { saveReleaseNote } from "../src/server/db/notes.ts";
import { setTrackVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { BackupsResponse, DecisionsExport } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { toCsv } from "../src/shared/csv.ts";
import { fixtureDb, silentLogger, testSecrets } from "./helpers.ts";

let tmp: string;
let db: Db;
let server: DiggaServer;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-export-"));
  db = await fixtureDb();
  const paths = resolvePaths({ dataDir: tmp });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: testSecrets(),
    logger: silentLogger,
    db,
    serveStatic: false,
  });
  upsertVerdict(db, {
    key: "m:501",
    status: "accepted",
    source: "triage",
    releaseId: 1001,
    decidedAt: "2026-09-28T10:00:00.000Z",
  });
  saveReleaseNote(db, 1001, 'the "Kool FM" one, B side');
  upsertVerdict(db, {
    key: "m:506",
    status: "rejected",
    source: "triage",
    decidedAt: "2026-09-28T11:00:00.000Z",
  });
  setTrackVerdict(db, {
    releaseId: 1001,
    position: "B1",
    mark: "candidate",
    notes: "at 3:10",
    videoId: "aaaaaaaaaa1",
    atSeconds: 190.5,
  });
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("exports", () => {
  it("writes CSV fields that need it in quotes", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x, y", 'say "hi"'],
          [null, 3],
        ],
      ),
    ).toBe('a,b\r\n"x, y","say ""hi"""\r\n,3\r\n');
  });

  it("downloads every verdict as CSV, with its release", async () => {
    const response = await server.app.request("/api/export/verdicts.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="digga-\d{4}-\d{2}-\d{2}-verdicts\.csv"$/,
    );
    const lines = (await response.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "key,status,source,decided_at,notes,release_id,artist,title,label,catno,year,country",
    );
    expect(lines[1]).toBe(
      'm:501,accepted,triage,2026-09-28T10:00:00.000Z,"the ""Kool FM"" one, B side",1001,Ed Rush & Optical,Wormhole,Renegade Hardware,RH 20,2000,UK',
    );
    // Without a release id, the verdict is shown with its record's main release.
    expect(lines[2]).toMatch(/^m:506,rejected,triage,2026-09-28T11:00:00.000Z,,1006,/);
  });

  it("downloads verdicts and track marks as JSON", async () => {
    const response = await server.app.request("/api/export/decisions.json");
    const body = (await response.json()) as DecisionsExport;
    expect(body.app).toBe("digga");
    expect(body.verdicts.map((verdict) => verdict.key)).toEqual(["m:501", "m:506"]);
    expect(body.trackMarks).toEqual([
      expect.objectContaining({
        releaseId: 1001,
        position: "B1",
        mark: "candidate",
        notes: "at 3:10",
        trackTitle: "Watermelon",
        heardKey: "ed rush 2 and optical - watermelon",
        videoId: "aaaaaaaaaa1",
        atSeconds: 190.5,
        artist: "Ed Rush & Optical",
        catno: "RH 20",
      }),
    ]);
    const csv = await (await server.app.request("/api/export/track-marks.csv")).text();
    expect(csv.split("\r\n")[1]).toMatch(
      /^B1,candidate,.+,at 3:10,Ed Rush & Optical,Watermelon,aaaaaaaaaa1,190.5,1001,/,
    );
  });

  it("refuses unknown exports and lists backups", async () => {
    expect((await server.app.request("/api/export/secrets.txt")).status).toBe(400);
    const response = await server.app.request("/api/backups");
    const body = (await response.json()) as BackupsResponse;
    expect(body).toEqual({
      directory: path.join(tmp, "backups"),
      kept: 7,
      backups: [],
      decisions: { kept: 30, backups: [] },
      checkpoints: { kept: 48, backups: [] },
    });
  });
});
