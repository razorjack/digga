import { describe, expect, it } from "vite-plus/test";
import type { Stats } from "../src/shared/api.ts";
import type { QueueScope } from "../src/shared/scope.ts";
import { VERDICT_STATUSES, type VerdictStatus } from "../src/shared/types.ts";
import { triageScreen, type TriageScreenInput } from "../src/client/triage/screen.ts";
import { queueItem } from "./helpers/catalog.ts";

const label: QueueScope = { kind: "label", id: 88, name: "Moving Shadow" };

function statsWith(universe: Stats["universe"], dug = 0): Stats {
  const verdicts = Object.fromEntries(VERDICT_STATUSES.map((status) => [status, 0]));
  return {
    dug,
    universe,
    verdicts: verdicts as Record<VerdictStatus, number>,
    discogs: { collection: 0, wantlist: 0, list: 0 },
    remaining: 0,
    scopeRemaining: null,
    rate: { verdictsPerHour: null, sessions: 0, etaHours: null },
    dump: { date: null, loadedAt: null, lastLoad: null },
    heardTracks: 0,
  };
}

const loaded = statsWith({ releases: 10, keys: 8, filteredKeys: 8 }, 8);

function screenFor(input: Partial<TriageScreenInput>) {
  return triageScreen({
    settingsFailed: false,
    queueFailed: false,
    finished: false,
    current: null,
    scope: null,
    stats: loaded,
    load: null,
    ...input,
  });
}

describe("triageScreen", () => {
  it("shows the record while there is one, and the loading line before", () => {
    const item = queueItem(1);
    expect(screenFor({ current: item })).toEqual({ kind: "record", item });
    expect(screenFor({})).toEqual({ kind: "loading" });
  });

  it("puts a failed settings read before a failed queue, and both before the record", () => {
    const current = queueItem(1);
    expect(screenFor({ settingsFailed: true, queueFailed: true, current })).toEqual({
      kind: "settings-failed",
    });
    expect(screenFor({ queueFailed: true, current })).toEqual({ kind: "queue-failed" });
  });

  it("waits for a running load at the end of the queue, whatever the stats say", () => {
    const empty = statsWith({ releases: 0, keys: 0, filteredKeys: 0 });
    expect(screenFor({ finished: true, stats: empty, load: { fraction: 0.426 } })).toEqual({
      kind: "waiting-for-load",
      percent: 42,
    });
    expect(screenFor({ finished: true, load: { fraction: null } })).toEqual({
      kind: "waiting-for-load",
      percent: null,
    });
  });

  it("tells an empty library from filters that match nothing", () => {
    const empty = statsWith({ releases: 0, keys: 0, filteredKeys: 0 });
    const filteredOut = statsWith({ releases: 10, keys: 8, filteredKeys: 0 });
    expect(screenFor({ finished: true, stats: empty, scope: label })).toEqual({
      kind: "no-releases",
    });
    expect(screenFor({ finished: true, stats: filteredOut, scope: label })).toEqual({
      kind: "nothing-matches",
      loadedRecords: 8,
    });
  });

  it("ends a scope apart from the whole queue", () => {
    expect(screenFor({ finished: true, scope: label })).toEqual({
      kind: "scope-dug",
      scope: label,
    });
    expect(screenFor({ finished: true })).toEqual({ kind: "all-dug", dug: 8 });
  });

  it("ends the queue before the stats arrive without counting what was dug", () => {
    expect(screenFor({ finished: true, stats: null })).toEqual({ kind: "all-dug", dug: null });
  });
});
