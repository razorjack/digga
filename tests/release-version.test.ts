import { describe, expect, it } from "vite-plus/test";
import { releaseVersion } from "../scripts/release-version.ts";

describe("releaseVersion", () => {
  it.each([
    ["v0.1", "0.1.0"],
    ["v0.1.0", "0.1.0"],
    ["v12.34.56", "12.34.56"],
    ["v0.1-beta.1", "0.1.0-beta.1"],
    ["v0.1.0-beta.1", "0.1.0-beta.1"],
    ["v1.0.0-0", "1.0.0-0"],
    ["v1.0.0-01alpha", "1.0.0-01alpha"],
    ["v9007199254740991.0.0", "9007199254740991.0.0"],
    [`v1.0.0-${"a".repeat(250)}`, `1.0.0-${"a".repeat(250)}`],
  ])("normalizes %s to %s", (tag, version) => {
    expect(releaseVersion(tag)).toBe(version);
  });

  it.each([
    "",
    "0.1.0",
    "v1",
    "v01.2.3",
    "v1.02.3",
    "v1.2.03",
    "v1.2.3.4",
    "v1.2.3-",
    "v1.2.3-beta..1",
    "v1.2.3-01",
    "v1.2.3-beta.01",
    "v1.2.3+build.1",
    "v1.2.3\n",
    "v1.2.3/other",
    "v1.2.3;echo hello",
    "v9007199254740992.0.0",
    "v1.9007199254740992.0",
    "v1.0.9007199254740992",
    `v1.0.0-${"a".repeat(251)}`,
  ])("rejects an invalid or unsupported tag: %j", (tag) => {
    expect(() => releaseVersion(tag)).toThrow("Invalid release tag");
  });
});
