import { describe, expect, it } from "vite-plus/test";
import { trackMarkForKey } from "../src/client/keymap.ts";

describe("trackMarkForKey", () => {
  it("reads the key Triage sees with Shift held, in lower case", () => {
    expect(trackMarkForKey("k")).toBe("keep");
    expect(trackMarkForKey("m")).toBe("meh");
    expect(trackMarkForKey("c")).toBe("candidate");
  });

  it("returns null for keys that mark nothing", () => {
    expect(trackMarkForKey("K")).toBeNull();
    expect(trackMarkForKey("a")).toBeNull();
  });
});
