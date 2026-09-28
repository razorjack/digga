import { describe, expect, it } from "vite-plus/test";
import { integerOption } from "../src/cli/args.ts";
import { parseInteger } from "../src/shared/integer.ts";

describe("integer boundaries", () => {
  it.each(["12garbage", "1.5", "1e3", "0x10", "", " ", "12 ", "-1", "9007199254740992"])(
    "rejects invalid numeric input %j",
    (input) => {
      expect(parseInteger(input)).toBeNull();
      expect(() => integerOption(input, "ahead")).toThrow("--ahead");
    },
  );

  it("enforces positive IDs and bounded ports while permitting zero where supported", () => {
    expect(parseInteger("0")).toBe(0);
    expect(parseInteger("0", { min: 1 })).toBeNull();
    expect(parseInteger("0012", { min: 1 })).toBe(12);
    expect(parseInteger("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(integerOption(undefined, "port")).toBeUndefined();
    expect(integerOption("0", "port", { max: 65535 })).toBe(0);
    expect(integerOption("65535", "port", { max: 65535 })).toBe(65535);
    expect(() => integerOption("65536", "port", { max: 65535 })).toThrow("--port");
    expect(() => integerOption("0", "list", { min: 1 })).toThrow("--list");
  });
});
