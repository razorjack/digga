import { describe, expect, it } from "vite-plus/test";
import { missingReleasesNote } from "../src/client/settings/library.ts";

describe("the last load's missing releases", () => {
  it("says nothing when the load found every release, or did not finish", () => {
    expect(missingReleasesNote(0)).toBeNull();
    expect(missingReleasesNote(null)).toBeNull();
  });

  it("counts one release in the singular and more in the plural", () => {
    expect(missingReleasesNote(1)).toBe(
      "1 release from earlier loads was not in this one. It stays in your library.",
    );
    expect(missingReleasesNote(1234)).toBe(
      "1,234 releases from earlier loads were not in this one. They stay in your library.",
    );
  });
});
