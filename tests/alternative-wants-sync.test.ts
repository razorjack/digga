import { describe, expect, it, vi } from "vite-plus/test";
import type { Api } from "../src/client/api.ts";
import { WantlistSync } from "../src/client/triage/wantlist-sync.ts";
import type { TriageStatus } from "../src/client/keymap.ts";
import type {
  AlternativeAdditions,
  AlternativesPreview,
} from "../src/shared/alternative-pressings.ts";
import type { QueueItem } from "../src/shared/api.ts";

const item = { id: 1, triageKey: "m:50", title: "Record", artistDisplay: "Artist" } as QueueItem;
const options = { whiteLabels: true, promos: true, testPressings: false };
const preview = {
  candidates: [
    { release: { id: 2 }, match: "matching" },
    { release: { id: 3 }, match: "review" },
  ],
  errors: [],
} as unknown as AlternativesPreview;

function setup() {
  let status: TriageStatus | undefined = "accepted";
  const calls: string[] = [];
  const api = {
    getRelease: vi.fn(async () => ({ verdict: { status: "accepted" } })),
    pushToWantlist: vi.fn(async (id: number) => {
      calls.push(`add ${id}`);
    }),
    removeFromWantlist: vi.fn(async (id: number) => {
      calls.push(`remove ${id}`);
    }),
    previewAlternatives: vi.fn(async () => preview),
    addAlternativeWants: vi.fn(async (): Promise<AlternativeAdditions[]> => [
      { operationId: "operation", added: [2], existing: [], errors: [], undone: false },
    ]),
    undoAlternativeWants: vi.fn(async () => {
      calls.push("undo alternatives");
      return { operationId: "operation", added: [], existing: [], errors: [], undone: true };
    }),
  };
  const flash = vi.fn();
  const sync = new WantlistSync({
    api: api as unknown as Api,
    retryDelaysMs: [],
    latestVerdict: () => status,
    alternativeOptions: () => options,
    flash,
  });
  return {
    api,
    sync,
    flash,
    calls,
    setStatus: (value: TriageStatus | undefined) => {
      status = value;
    },
  };
}

describe("automatic alternative wants", () => {
  it("adds only matching versions and waits for their receipt before undoing an in-flight addition", async () => {
    const { api, sync, calls, setStatus } = setup();
    const started = Promise.withResolvers<void>();
    const addition = Promise.withResolvers<AlternativeAdditions[]>();
    api.addAlternativeWants.mockImplementation(async () => {
      started.resolve();
      return addition.promise;
    });
    const pushed = sync.push(item, () => {});
    await started.promise;
    expect(api.addAlternativeWants).toHaveBeenCalledWith({
      additions: [expect.objectContaining({ releaseIds: [2], automatic: true })],
    });
    setStatus(undefined);
    const undo = sync.takeOff(item);
    addition.resolve([
      { operationId: "operation", added: [2], existing: [], errors: [], undone: false },
    ]);
    await pushed;
    await undo;
    expect(calls).toEqual(["add 1", "undo alternatives", "remove 1"]);
    sync.destroy();
  });
  it("does not start additions after an undo during discovery, even when the round originally wanted the record", async () => {
    const { api, sync, setStatus } = setup();
    sync.rememberRoundRecord(item.triageKey, [1]);
    const started = Promise.withResolvers<void>();
    const discovery = Promise.withResolvers<AlternativesPreview>();
    api.previewAlternatives.mockImplementation(async () => {
      started.resolve();
      return discovery.promise;
    });
    const pushed = sync.push(item, () => {});
    await started.promise;
    setStatus(undefined);
    const undo = sync.takeOff(item);
    discovery.resolve(preview);
    await pushed;
    await undo;
    expect(api.addAlternativeWants).not.toHaveBeenCalled();
    expect(api.removeFromWantlist).not.toHaveBeenCalled();
    sync.destroy();
  });
  it("explains alternative failures without claiming that the original want failed", async () => {
    const { api, sync, flash } = setup();
    api.previewAlternatives.mockRejectedValue(new Error("Unavailable"));
    expect(await sync.push(item, () => {})).toBe("done");
    expect(flash).toHaveBeenCalledWith(
      expect.stringContaining("Want saved, but Digga could not confirm the alternative pressings"),
    );
    sync.destroy();
  });
  it("does not add after the session closes during discovery", async () => {
    const { api, sync } = setup();
    const started = Promise.withResolvers<void>();
    const discovery = Promise.withResolvers<AlternativesPreview>();
    api.previewAlternatives.mockImplementation(async () => {
      started.resolve();
      return discovery.promise;
    });
    const pushed = sync.push(item, () => {});
    await started.promise;
    sync.destroy();
    discovery.resolve(preview);
    await pushed;
    expect(api.addAlternativeWants).not.toHaveBeenCalled();
  });
});
