import { describe, expect, it } from "vite-plus/test";
import { DumpFiles, dumpUse } from "../src/client/settings/dumps.svelte.ts";
import type { DumpFile, DumpsResponse } from "../src/shared/api.ts";

const september: DumpFile = {
  name: "discogs_20260901_releases.xml.gz",
  date: "2026-09-01",
  bytes: 1,
};
const october: DumpFile = {
  name: "discogs_20261001_releases.xml.gz",
  date: "2026-10-01",
  bytes: 1,
};

describe("dumps in Settings", () => {
  it("say which dump the library came from and which nothing needs", () => {
    expect(dumpUse(september, september, "2026-09-01")).toBe("the library was loaded from it");
    expect(dumpUse(october, october, "2026-09-01")).toBe("not loaded yet");
    // formatDay leaves out the year of dates in the current year.
    expect(dumpUse(september, october, "2026-10-01")).toMatch(
      /^nothing needs it: the 1 Oct( 2026)? dump is newer$/,
    );
  });

  it("show the folder the server answers after a delete, and keep it when the delete fails", async () => {
    let listing: DumpsResponse = { directory: "/dumps", files: [october, september] };
    let refuse = false;
    const dumps = new DumpFiles({
      getDumps: async () => listing,
      deleteDump: async (name) => {
        if (refuse) throw new Error('Wait until "Download dump" has finished');
        listing = { ...listing, files: listing.files.filter((file) => file.name !== name) };
        return listing;
      },
    });
    await dumps.load();
    await dumps.delete(september.name);
    expect(dumps.value?.files).toEqual([october]);
    refuse = true;
    await expect(dumps.delete(october.name)).rejects.toThrow("Wait until");
    expect(dumps.value?.files).toEqual([october]);
  });
});
