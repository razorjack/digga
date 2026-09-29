import { describe, expect, it } from "vite-plus/test";
import { ScopeParamSchema, scopeParam, scopesOfRelease } from "../src/shared/scope.ts";
import type { ArtistRef } from "../src/shared/types.ts";

const artist = (id: number | null, name: string): ArtistRef => ({ id, name, anv: "", join: "" });

describe("queue scope", () => {
  it("round-trips through a query parameter", () => {
    expect(scopeParam({ kind: "label", id: 123 })).toBe("label:123");
    expect(scopeParam(null)).toBeUndefined();
    expect(ScopeParamSchema.parse("artist:45")).toEqual({ kind: "artist", id: 45 });
    expect(ScopeParamSchema.parse("seller:6")).toEqual({ kind: "seller", id: 6 });
    for (const text of ["shop:1", "label:0", "label:x", "label", "label:1:2", "LABEL:1"])
      expect(ScopeParamSchema.safeParse(text).success).toBe(false);
  });

  it("offers a release's labels, artists and track artists once each, without Various", () => {
    const release = {
      labels: [
        { id: 77, name: "Renegade Hardware", catno: "RH 18" },
        { id: 77, name: "Renegade Hardware", catno: "RH 18 R" },
        { id: null, name: "Not On Label", catno: "" },
      ],
      artists: [artist(194, "Various")],
    };
    const tracks = [
      { artists: [artist(21, "Konflict")] },
      { artists: [artist(21, "Konflict"), artist(11, "Ed Rush (2)")] },
      { artists: [] },
    ];
    expect(scopesOfRelease(release, tracks)).toEqual([
      { kind: "label", id: 77, name: "Renegade Hardware" },
      { kind: "artist", id: 21, name: "Konflict" },
      { kind: "artist", id: 11, name: "Ed Rush (2)" },
    ]);
  });
});
