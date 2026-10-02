import { describe, expect, it } from "vite-plus/test";
import { pagesClosed, sendToSetup } from "../src/client/setup/access.ts";

const NEW = { firstRun: true, loading: false, recordsToDig: 0 };
const LOADING = { firstRun: true, loading: true, recordsToDig: 120 };
const STOPPED = { firstRun: true, loading: false, recordsToDig: 120 };
const LOADED = { firstRun: false, loading: false, recordsToDig: 7139 };

describe("the setup's hold on the app", () => {
  it("keeps the pages closed until something can be dug", () => {
    expect(pagesClosed(NEW)).toBe(true);
    expect(pagesClosed(LOADING)).toBe(false);
    expect(pagesClosed(STOPPED)).toBe(false);
    expect(pagesClosed(LOADED)).toBe(false);
  });

  it("opens the app on the setup until a load has finished, unless one runs", () => {
    expect(sendToSetup(NEW, false)).toBe(true);
    expect(sendToSetup(NEW, true)).toBe(true);
    expect(sendToSetup(STOPPED, false)).toBe(true);
    expect(sendToSetup(LOADING, false)).toBe(false);
    expect(sendToSetup(LOADED, false)).toBe(false);
  });

  it("lets the records a stopped load kept be dug once the setup has said it stopped", () => {
    expect(sendToSetup(STOPPED, true)).toBe(false);
  });
});
