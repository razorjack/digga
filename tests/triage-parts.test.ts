import { expect, it } from "vite-plus/test";
import type { Stats } from "../src/shared/api.ts";
import type { Verdict } from "../src/shared/types.ts";
import { countVerdict } from "../src/client/triage/optimistic-stats.ts";
import { WriteVersions } from "../src/client/triage/write-versions.ts";

function statsWith(overrides: Partial<Stats>): Stats {
  return {
    dug: 10,
    universe: { releases: 100, keys: 90, filteredKeys: 80 },
    verdicts: {
      rejected: 0,
      accepted: 0,
      maybe: 0,
      candidate: 0,
      snoozed: 2,
      no_audio: 0,
      seen: 1,
    },
    discogs: { collection: 0, wantlist: 0, list: 0 },
    remaining: 70,
    scopeRemaining: 5,
    rate: { verdictsPerHour: null, sessions: 0, etaHours: null },
    dump: { date: null, loadedAt: null, lastLoad: null },
    heardTracks: 0,
    ...overrides,
  } as Stats;
}

const snoozed: Verdict = {
  key: "m:1",
  status: "snoozed",
  source: "triage",
  releaseId: 1,
  decidedAt: "2026-10-01T10:00:00.000Z",
};

it("counts a verdict on a queued record as dug and no longer remaining, and its undo back", () => {
  const before = statsWith({});
  const after = countVerdict(before, { status: "accepted", previous: null }, 1);
  expect(after).toMatchObject({ dug: 11, remaining: 69, scopeRemaining: 4 });
  expect(after.verdicts.accepted).toBe(1);
  expect(countVerdict(after, { status: "accepted", previous: null }, -1)).toEqual(before);
});

it("only moves a record dug before from one status to another", () => {
  const after = countVerdict(statsWith({}), { status: "accepted", previous: snoozed }, 1);
  expect(after).toMatchObject({ dug: 10, remaining: 70, scopeRemaining: 5 });
  expect(after.verdicts).toMatchObject({ accepted: 1, snoozed: 1 });
});

it("lets only the latest write of a key put its saved value back", () => {
  const writes = new WriteVersions<string | null>();
  const first = writes.begin("m:1", null);
  const second = writes.begin("m:1", "ignored, the first write knows the saved value");
  expect(first.isLatest()).toBe(false);
  expect(second.isLatest()).toBe(true);
  expect(second.saved()).toBeNull();

  first.markSaved("first note");
  expect(second.saved()).toBe("first note");

  writes.forget("m:1");
  expect(second.isLatest()).toBe(false);
});
