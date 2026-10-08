import { describe, expect, it } from "vite-plus/test";
import { isSelectAll, trackMarkForKey } from "../src/client/keymap.ts";

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

describe("isSelectAll", () => {
  type Press = Parameters<typeof isSelectAll>[0];
  const press = (key: string, modifiers: Partial<Press> = {}): Press => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
  });

  it("is Cmd+A or Ctrl+A, with Shift or Caps Lock", () => {
    expect(isSelectAll(press("a", { metaKey: true }))).toBe(true);
    expect(isSelectAll(press("A", { ctrlKey: true }))).toBe(true);
  });

  it("is not A alone, A with Alt, or another key", () => {
    expect(isSelectAll(press("a"))).toBe(false);
    expect(isSelectAll(press("a", { metaKey: true, altKey: true }))).toBe(false);
    expect(isSelectAll(press("s", { metaKey: true }))).toBe(false);
  });
});
