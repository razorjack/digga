import { describe, expect, it } from "vite-plus/test";
import {
  commandKeys,
  commandModifier,
  commandShortcut,
  GLOBAL_KEYS,
  isSelectAll,
  isTriageStatus,
  shortcutKey,
  trackMarkForKey,
  verdictForKey,
} from "../src/client/keymap.ts";
import { ROUTES } from "../src/client/routes.ts";

describe("verdict keys", () => {
  it("finds the verdict a lower-case key writes, snooze included", () => {
    expect(verdictForKey("l")?.status).toBe("snoozed");
    expect(verdictForKey("a")?.status).toBe("accepted");
    expect(verdictForKey("n")).toBeUndefined();
  });

  it("counts only the statuses a verdict key writes as triage verdicts", () => {
    expect(isTriageStatus("no_audio")).toBe(true);
    expect(isTriageStatus("seen")).toBe(false);
  });
});

it("lists every page's key in the Keys dialog, then ?", () => {
  const keys = GLOBAL_KEYS.keys.map((help) => help.keys[0]);
  expect(keys).toEqual([...ROUTES.map((destination) => destination.key), "?"]);
});

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

describe("shortcutKey", () => {
  it("looks letters up in lower case, also with Caps Lock", () => {
    expect(shortcutKey({ key: "a", shiftKey: false })).toBe("a");
    expect(shortcutKey({ key: "A", shiftKey: false })).toBe("a");
  });

  it("runs no letter shortcut with Shift held", () => {
    expect(shortcutKey({ key: "A", shiftKey: true })).toBeNull();
    expect(shortcutKey({ key: "É", shiftKey: true })).toBeNull();
  });

  it("keeps keys that are not letters with Shift, which some layouts need to type them", () => {
    expect(shortcutKey({ key: "/", shiftKey: true })).toBe("/");
    expect(shortcutKey({ key: "1", shiftKey: true })).toBe("1");
    expect(shortcutKey({ key: ",", shiftKey: true })).toBe(",");
    expect(shortcutKey({ key: "ArrowLeft", shiftKey: true })).toBe("ArrowLeft");
  });

  it("tells Shift+Enter from Enter", () => {
    expect(shortcutKey({ key: "Enter", shiftKey: false })).toBe("Enter");
    expect(shortcutKey({ key: "Enter", shiftKey: true })).toBe("Shift+Enter");
  });
});

describe("commandModifier", () => {
  it("is ⌘ on the platforms navigator.platform names for Apple systems", () => {
    for (const platform of ["MacIntel", "iPhone", "iPad"])
      expect(commandModifier(platform)).toBe("⌘");
  });

  it("is Ctrl on Linux, Windows and an unknown platform", () => {
    for (const platform of ["Linux x86_64", "Win32", ""])
      expect(commandModifier(platform)).toBe("Ctrl");
  });
});

describe("commandKeys and commandShortcut", () => {
  it("draw one ⌘ cap on Apple keyboards", () => {
    expect(commandKeys("V", "⌘")).toEqual(["⌘V"]);
    expect(commandShortcut("S", "⌘")).toBe("⌘S");
  });

  it("draw Ctrl and the key elsewhere", () => {
    expect(commandKeys("V", "Ctrl")).toEqual(["Ctrl", "V"]);
    expect(commandShortcut("S", "Ctrl")).toBe("Ctrl+S");
  });
});
