import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../src/client/api.ts";
import { SetupFlow } from "../src/client/setup/flow.svelte.ts";
import type { SetupResponse, Stats } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { Job } from "../src/shared/types.ts";

const FILE = "discogs_20260901_releases.xml.gz";

const SETUP: SetupResponse = {
  needed: true,
  catalogue: {
    newest: { date: "2026-09-01", file: FILE, bytes: 1000, downloaded: false },
    error: null,
    dumpsDir: "/dumps",
    freeBytes: null,
    neededBytes: null,
  },
  seeds: { releases: 0, styles: [] },
  browsers: [],
};

function job(id: string, type: "dump_download" | "dump_load"): Job {
  return {
    id,
    type,
    status: "running",
    error: null,
    createdAt: "2026-09-30T20:00:00.000Z",
    startedAt: "2026-09-30T20:00:00.000Z",
    finishedAt: null,
    progress: null,
  } as Job;
}

const DOWNLOAD = job("download", "dump_download");
const LOAD = job("load", "dump_load");

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the setup following its jobs", () => {
  it("keeps a load started while a poll of the jobs was on its way", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "getSetup").mockResolvedValue(SETUP);
    vi.spyOn(api, "getJobs").mockResolvedValue({ jobs: [DOWNLOAD] });
    vi.spyOn(api, "getDiscogsAccount").mockRejectedValue(new Error("no account"));
    vi.spyOn(api, "getStyles").mockRejectedValue(new Error("not needed here"));
    vi.spyOn(api, "getSettings").mockResolvedValue(DEFAULT_CONFIG);
    vi.spyOn(api, "putSettings").mockImplementation(async (config) => config);
    vi.spyOn(api, "getStats").mockResolvedValue({ remaining: 0 } as Stats);
    vi.spyOn(api, "startDumpLoad").mockResolvedValue(LOAD);
    const downloadAnswer = Promise.withResolvers<Job>();
    const getJob = vi.spyOn(api, "getJob").mockImplementation(async (id) => {
      if (id === DOWNLOAD.id) return downloadAnswer.promise;
      return id === LOAD.id ? LOAD : DOWNLOAD;
    });
    const flow = new SetupFlow();
    await flow.open("sound");

    // The poll asks about the download; before it answers, the picks start the load.
    await vi.advanceTimersByTimeAsync(1000);
    expect(getJob).toHaveBeenCalledWith(DOWNLOAD.id);
    await flow.fillCrate({
      styles: ["Drum n Bass"],
      span: [1998, 2002],
      loadYears: [1995, 2005],
      vinylOnly: true,
    });
    downloadAnswer.resolve(DOWNLOAD);
    await vi.advanceTimersByTimeAsync(0);

    expect(flow.load?.id).toBe(LOAD.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(getJob).toHaveBeenCalledWith(LOAD.id);
    flow.close();
  });
});
