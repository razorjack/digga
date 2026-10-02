import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { LoadStatusStore } from "../src/client/load-status.svelte.ts";
import type { JobsResponse, Stats } from "../src/shared/api.ts";
import type { Job } from "../src/shared/types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function job(id: string, type: Job["type"], status: Job["status"]): Job {
  return { id, type, status, progress: null } as unknown as Job;
}

function storeWith(getJobs: () => Promise<JobsResponse>): LoadStatusStore {
  const stats = { value: null as Stats | null, refresh: async () => {} };
  return new LoadStatusStore({ getJobs }, stats);
}

afterEach(() => vi.useRealTimers());

describe("the load status", () => {
  it("follows a dump job the page started, and polls while it runs", async () => {
    vi.useFakeTimers();
    const update = job("7", "dump_update", "running");
    const getJobs = vi
      .fn<() => Promise<JobsResponse>>()
      .mockResolvedValueOnce({ jobs: [update] })
      .mockResolvedValue({ jobs: [{ ...update, status: "done" } as Job] });
    const status = storeWith(getJobs);

    status.follow(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(status.job?.id).toBe("7");
    expect(status.loading).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getJobs).toHaveBeenCalledTimes(2);
    expect(status.job).toBeNull();
  });

  it("asks nothing for a job that is not a dump job", async () => {
    const getJobs = vi.fn<() => Promise<JobsResponse>>().mockResolvedValue({ jobs: [] });
    const status = storeWith(getJobs);

    status.follow(job("8", "import_wantlist", "running"));
    await Promise.resolve();

    expect(getJobs).not.toHaveBeenCalled();
  });

  it("keeps the answer of the later check when an earlier one arrives after it", async () => {
    vi.useFakeTimers();
    const earlier = deferred<JobsResponse>();
    const download = job("9", "dump_download", "running");
    const getJobs = vi
      .fn<() => Promise<JobsResponse>>()
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValue({ jobs: [download] });
    const status = storeWith(getJobs);

    // The app's first check is still out when the page starts a download.
    void status.check();
    status.follow(download);
    await vi.advanceTimersByTimeAsync(0);
    earlier.resolve({ jobs: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(status.job?.id).toBe("9");
    await vi.advanceTimersByTimeAsync(1000);
    expect(getJobs).toHaveBeenCalledTimes(3);
  });
});
