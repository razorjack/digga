import { describe, expect, it } from "vite-plus/test";
import { wantlistNote } from "../src/shared/wantlist.ts";

describe("wantlist notes", () => {
  it("lists grail tracks, then keepers, then the record's note", () => {
    const marks = [
      { position: "A1", mark: "keep" as const },
      { position: "A2", mark: "meh" as const },
      { position: "B1", mark: "candidate" as const },
      { position: "B2", mark: "keep" as const },
    ];
    expect(wantlistNote(marks, " heard on Kool FM ")).toBe(
      "grail B1; keep A1, B2; heard on Kool FM",
    );
  });

  it("says nothing without marks or a note, and stays within 255 characters", () => {
    expect(wantlistNote([{ position: "A1", mark: "meh" }], null)).toBeUndefined();
    const long = wantlistNote([], "x".repeat(400))!;
    expect(long).toHaveLength(255);
    expect(long.endsWith("...")).toBe(true);
  });
});
