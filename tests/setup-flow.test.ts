import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../src/client/api.ts";
import { confirmedPicks, SetupFlow, withChange } from "../src/client/setup/flow.svelte.ts";
import type { SetupStep } from "../src/client/setup/steps.ts";
import type { SetupResponse, Stats } from "../src/shared/api.ts";
import { type Config, DEFAULT_CONFIG } from "../src/shared/config.ts";
import { DOWNLOAD_RETRIED_ERROR, type Job } from "../src/shared/types.ts";

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

const PICKS = {
  styles: ["Jungle", "Breakbeat"],
  span: [1994, 1997] as [number, number],
  loadYears: [1990, 2000] as [number, number],
  vinylOnly: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("where the setup resumes", () => {
  function serverHas(jobs: Job[], downloaded: boolean, config: Config = DEFAULT_CONFIG): void {
    const newest = { ...SETUP.catalogue.newest!, downloaded };
    vi.spyOn(api, "getSetup").mockResolvedValue({
      ...SETUP,
      catalogue: { ...SETUP.catalogue, newest },
    });
    vi.spyOn(api, "getJobs").mockResolvedValue({ jobs });
    vi.spyOn(api, "getDiscogsAccount").mockRejectedValue(new Error("no account"));
    vi.spyOn(api, "getStyles").mockRejectedValue(new Error("not needed here"));
    vi.spyOn(api, "getJob").mockResolvedValue(DOWNLOAD);
    vi.spyOn(api, "getSettings").mockResolvedValue(config);
  }

  async function resumed(requested: SetupStep | null): Promise<SetupFlow> {
    const flow = new SetupFlow();
    await flow.open(requested);
    flow.close();
    return flow;
  }

  async function resumedStep(requested: SetupStep | null): Promise<SetupStep> {
    return (await resumed(requested)).step;
  }

  it("opens step 1 on a catalogue that was in the dumps folder before any download", async () => {
    serverHas([], true);

    expect(await resumedStep(null)).toBe("catalogue");
    expect(await resumedStep("catalogue")).toBe("catalogue");
    expect(await resumedStep("discogs")).toBe("discogs");
    expect(await resumedStep("sound")).toBe("sound");
  });

  it("opens step 2 while the catalogue downloads, or step 3 when the address asks", async () => {
    serverHas([DOWNLOAD], false);

    expect(await resumedStep(null)).toBe("discogs");
    expect(await resumedStep("catalogue")).toBe("discogs");
    expect(await resumedStep("sound")).toBe("sound");
  });

  it("opens step 3 with the confirmed picks once step 3 was confirmed, unless the address asks", async () => {
    serverHas([DOWNLOAD], false, withChange(DEFAULT_CONFIG, { picks: PICKS }));

    const flow = await resumed(null);
    expect(flow.step).toBe("sound");
    expect(flow.picks).toEqual(PICKS);
    expect(await resumedStep("discogs")).toBe("discogs");
  });

  it("opens step 3 for confirmed picks also on a catalogue that was in the dumps folder", async () => {
    serverHas([], true, withChange(DEFAULT_CONFIG, { picks: PICKS }));

    expect(await resumedStep(null)).toBe("sound");
  });

  it("starts from no picks on a new config, whose styles are only the defaults", async () => {
    serverHas([DOWNLOAD], false);

    const flow = await resumed(null);
    expect(flow.step).toBe("discogs");
    expect(flow.picks).toBeNull();
  });

  it("opens step 2 after the download stopped, where the setup says so", async () => {
    serverHas([{ ...DOWNLOAD, status: "failed", error: "fetch failed" } as Job], false);

    const flow = await resumed(null);
    expect(flow.step).toBe("discogs");
    expect(flow.downloadStopped).toBe("The download stopped: fetch failed.");
  });

  it("opens step 1 before anything is fetched, whatever the address asks", async () => {
    serverHas([], false);

    expect(await resumedStep("sound")).toBe("catalogue");
  });
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

describe("the setup after the download stopped", () => {
  it("downloads again before Fill the crate starts the load, which reads the new download", async () => {
    vi.spyOn(api, "getSetup").mockResolvedValue(SETUP);
    vi.spyOn(api, "getJobs").mockResolvedValue({
      jobs: [{ ...DOWNLOAD, status: "failed", error: "fetch failed" } as Job],
    });
    vi.spyOn(api, "getDiscogsAccount").mockRejectedValue(new Error("no account"));
    vi.spyOn(api, "getStyles").mockRejectedValue(new Error("not needed here"));
    vi.spyOn(api, "getSettings").mockResolvedValue(DEFAULT_CONFIG);
    vi.spyOn(api, "putSettings").mockImplementation(async (config) => config);
    vi.spyOn(api, "getJob").mockImplementation(async (id) => (id === LOAD.id ? LOAD : DOWNLOAD));
    const calls: string[] = [];
    vi.spyOn(api, "startDumpDownload").mockImplementation(async () => {
      calls.push("download");
      return DOWNLOAD;
    });
    vi.spyOn(api, "startDumpLoad").mockImplementation(async () => {
      calls.push("load");
      return LOAD;
    });
    const flow = new SetupFlow();
    await flow.open("sound");

    await flow.fillCrate(PICKS);
    flow.close();

    expect(flow.error).toBeNull();
    expect(calls).toEqual(["download", "load"]);
    expect(flow.downloadStopped).toBeNull();
  });
});

describe("the setup after a checksum mismatch", () => {
  it("starts the load again on the download that runs once more, without asking", async () => {
    const retrying = {
      ...DOWNLOAD,
      progress: {
        phase: "downloading",
        file: FILE,
        receivedBytes: 0,
        totalBytes: 1000,
        alreadyDownloaded: false,
        checksumMismatches: 1,
      },
    } as Job;
    const stoppedLoad = { ...LOAD, status: "failed", error: DOWNLOAD_RETRIED_ERROR } as Job;
    vi.spyOn(api, "getSetup").mockResolvedValue(SETUP);
    vi.spyOn(api, "getJobs").mockResolvedValue({ jobs: [stoppedLoad, retrying] });
    vi.spyOn(api, "getDiscogsAccount").mockRejectedValue(new Error("no account"));
    vi.spyOn(api, "getStyles").mockRejectedValue(new Error("not needed here"));
    vi.spyOn(api, "getSettings").mockResolvedValue(DEFAULT_CONFIG);
    vi.spyOn(api, "getJob").mockImplementation(async (id) => (id === LOAD.id ? LOAD : retrying));
    const startDumpLoad = vi.spyOn(api, "startDumpLoad").mockResolvedValue(LOAD);
    const flow = new SetupFlow();

    await flow.open(null);
    flow.close();

    expect(startDumpLoad).toHaveBeenCalledWith({ file: FILE });
    expect(flow.step).toBe("crate");
    expect(flow.load?.status).toBe("running");
    expect(flow.checksumRetry).toBe(
      "The download does not match Discogs' checksum, so Digga downloads it once more.",
    );
  });
});

describe("the picks step 3 confirms", () => {
  it("are marked in the config, and read back from it as they were picked", () => {
    const config = withChange(DEFAULT_CONFIG, { picks: PICKS });

    expect(config.setup.picksConfirmed).toBe(true);
    expect(confirmedPicks(config)).toEqual(PICKS);
    expect(
      confirmedPicks(withChange(DEFAULT_CONFIG, { picks: { ...PICKS, vinylOnly: true } })),
    ).toMatchObject({
      vinylOnly: true,
    });
  });

  it("are not the defaults of a new config, nor a config other setup steps changed", () => {
    expect(DEFAULT_CONFIG.setup.picksConfirmed).toBe(false);
    expect(confirmedPicks(DEFAULT_CONFIG)).toBeNull();
    expect(
      confirmedPicks(withChange(DEFAULT_CONFIG, { username: "dj", currency: "GBP" })),
    ).toBeNull();
  });
});
