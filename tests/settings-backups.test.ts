import { describe, expect, it } from "vite-plus/test";
import { checkpointTime } from "../src/client/settings/backups.ts";

describe("a checkpoint's time", () => {
  it("reads the time its file name writes with dashes", () => {
    expect(checkpointTime("2026-10-04T17-27-56-315Z")).toBe("2026-10-04T17:27:56.315Z");
  });

  it("reads nothing from a name in another form", () => {
    expect(checkpointTime("2026-10-04")).toBeNull();
    expect(checkpointTime("2026-10-04T17:27:56.315Z")).toBeNull();
  });
});
