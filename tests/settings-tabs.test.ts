import { describe, expect, it } from "vite-plus/test";
import { recentJobs, settingsTab, TAB_JOBS, unsavedTabs } from "../src/client/settings/tabs.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { Job, JobType } from "../src/shared/types.ts";

function job(id: string, type: JobType): Job {
  return {
    id,
    type,
    status: "done",
    error: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    progress: null,
  } as Job;
}

describe("the Settings tab an address opens", () => {
  it("opens the tab the address names", () => {
    expect(settingsTab("library")).toBe("library");
    expect(settingsTab("discogs")).toBe("discogs");
    expect(settingsTab("backups")).toBe("backups");
    expect(settingsTab("general")).toBe("general");
  });

  it("opens General for the header's sandbox link", () => {
    expect(settingsTab("sandbox")).toBe("general");
  });

  it("opens Digging without a tab or with an unknown one", () => {
    expect(settingsTab(null)).toBe("digging");
    expect(settingsTab("jobs")).toBe("digging");
  });
});

describe("the jobs a tab lists", () => {
  it("keeps the tab's jobs in their order", () => {
    const jobs = [
      job("1", "import_wantlist"),
      job("2", "dump_load"),
      job("3", "import_seller"),
      job("4", "dump_update"),
    ];
    expect(recentJobs(jobs, TAB_JOBS.discogs).map((listed) => listed.id)).toEqual(["1", "3"]);
    expect(recentJobs(jobs, TAB_JOBS.library).map((listed) => listed.id)).toEqual(["2", "4"]);
  });

  it("lists the five newest", () => {
    const jobs = ["1", "2", "3", "4", "5", "6", "7"].map((id) => job(id, "import_collection"));
    expect(recentJobs(jobs, TAB_JOBS.discogs).map((listed) => listed.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });
});

describe("the tabs with unsaved changes", () => {
  it("names none while the draft is the saved settings", () => {
    expect(unsavedTabs(structuredClone(DEFAULT_CONFIG), DEFAULT_CONFIG)).toEqual([]);
  });

  it("names each tab whose fields changed, in the list's order", () => {
    const draft = structuredClone(DEFAULT_CONFIG);
    draft.discogs.currency = "GBP";
    draft.queue.limit = 50;
    expect(unsavedTabs(draft, DEFAULT_CONFIG)).toEqual(["digging", "discogs"]);
    draft.universe.coverage = !draft.universe.coverage;
    expect(unsavedTabs(draft, DEFAULT_CONFIG)).toEqual(["digging", "library", "discogs"]);
  });

  it("leaves out the settings General saves at once", () => {
    const draft = structuredClone(DEFAULT_CONFIG);
    draft.sandbox = !draft.sandbox;
    draft.appearance.colorScheme = "dark";
    expect(unsavedTabs(draft, DEFAULT_CONFIG)).toEqual([]);
  });
});
