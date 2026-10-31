import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Api } from "../src/client/api.ts";
import { AlternativesPreviewState } from "../src/client/twelves/alternatives.svelte.ts";
import type {
  AddAlternativesBatch,
  AlternativeAdditions,
  AlternativesPreview,
  AlternativesProgress,
} from "../src/shared/alternative-pressings.ts";
import type { TwelvesItem } from "../src/shared/api.ts";

const options = { whiteLabels: true, promos: true, testPressings: false };
const item = { key: "m:50", release: { id: 1, title: "Record" } } as TwelvesItem;
const preview = {
  source: { id: 1 },
  candidates: [{ release: { id: 2 }, match: "matching", onWantlist: false }],
  errors: [],
} as unknown as AlternativesPreview;
const receipt: AlternativeAdditions = {
  operationId: "operation",
  added: [2],
  existing: [],
  errors: [],
  undone: false,
};

function setup() {
  const getAlternativesProgress = vi.fn<(batchId: string) => Promise<AlternativesProgress | null>>(
    async () => null,
  );
  const client = {
    previewAlternatives: vi.fn(async () => preview),
    getAlternativesProgress,
  } as unknown as Pick<Api, "previewAlternatives" | "getAlternativesProgress">;
  const state = new AlternativesPreviewState(client);
  const answer = Promise.withResolvers<AlternativeAdditions[]>();
  const batches: AddAlternativesBatch[] = [];
  const write = (batch: AddAlternativesBatch) => {
    batches.push(batch);
    return answer.promise;
  };
  return { state, getAlternativesProgress, answer, batches, write };
}

afterEach(() => vi.useRealTimers());

describe("the alternatives preview", () => {
  it("counts the records it checks, and hides the count once the preview is ready", async () => {
    const checked = Promise.withResolvers<AlternativesPreview>();
    const second = Promise.withResolvers<AlternativesPreview>();
    const client = {
      previewAlternatives: vi
        .fn()
        .mockReturnValueOnce(checked.promise)
        .mockReturnValueOnce(second.promise),
      getAlternativesProgress: vi.fn(),
    } as unknown as Pick<Api, "previewAlternatives" | "getAlternativesProgress">;
    const state = new AlternativesPreviewState(client);
    const reading = state.read([item, { ...item, key: "m:51" }], options);
    expect(state.meter).toEqual({ done: 0, total: 2 });
    expect(state.progress).toBe("Checking record 1 of 2…");
    checked.resolve(preview);
    await vi.waitFor(() => expect(state.meter).toEqual({ done: 1, total: 2 }));
    expect(state.progress).toBe("Checking record 2 of 2…");
    second.resolve(preview);
    await reading;
    expect(state.meter).toBeNull();
  });

  it("shows the batch's progress each second until its answer arrives", async () => {
    vi.useFakeTimers();
    const { state, getAlternativesProgress, answer, batches, write } = setup();
    await state.read([item], options);
    const adding = state.add(options, write);
    expect(state.writing).toBe(true);
    expect(state.meter).toBeNull();

    getAlternativesProgress.mockResolvedValue({ done: 1, total: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(getAlternativesProgress).toHaveBeenCalledWith(batches[0]!.batchId);
    expect(state.meter).toEqual({ done: 1, total: 3 });
    expect(state.progress).toBe("Adding the selected pressings to Discogs: 1 of 3…");

    const late = Promise.withResolvers<AlternativesProgress | null>();
    getAlternativesProgress.mockReturnValue(late.promise);
    await vi.advanceTimersByTimeAsync(1000);
    answer.resolve([receipt]);
    await adding;
    late.resolve({ done: 2, total: 3 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.meter).toBeNull();
    expect(state.progress).toMatch(/^Selected pressings are on your wantlist/);
    expect(getAlternativesProgress).toHaveBeenCalledTimes(2);
  });

  it("keeps the last count when a poll fails, and stops polling when the dialog closes", async () => {
    vi.useFakeTimers();
    const { state, getAlternativesProgress, write } = setup();
    await state.read([item], options);
    void state.add(options, write);
    getAlternativesProgress.mockResolvedValueOnce({ done: 1, total: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    getAlternativesProgress.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.meter).toEqual({ done: 1, total: 3 });

    state.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getAlternativesProgress).toHaveBeenCalledTimes(2);
  });
});
