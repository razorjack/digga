import { describe, expect, it } from "vite-plus/test";
import { ScopeSearch } from "../src/client/triage/scope-search.svelte.ts";
import type { ScopeMatch, ScopeSearchResponse } from "../src/shared/api.ts";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const match = (name: string): ScopeMatch => ({ kind: "label", id: 1, name, records: 3 });

/** Answers each search after the delay its text asks for, so a later one can overtake it. */
function fakeApi(delays: Record<string, number> = {}) {
  const asked: string[] = [];
  return {
    asked,
    searchScopes: async (text: string): Promise<ScopeSearchResponse> => {
      asked.push(text);
      await wait(delays[text] ?? 0);
      if (text === "fail") throw new Error("server down");
      return { items: [match(text)] };
    },
  };
}

describe("scope search", () => {
  it("searches once typing pauses, from two characters on", async () => {
    const api = fakeApi();
    const search = new ScopeSearch(api, 10);
    search.update("m");
    expect([search.active, search.searching]).toEqual([false, false]);
    search.update("mo");
    search.update("mov");
    expect(search.searching).toBe(true);
    await wait(30);
    expect(api.asked).toEqual(["mov"]);
    expect([search.matches, search.searching]).toEqual([[match("mov")], false]);
    search.clear();
    expect([search.text, search.matches]).toEqual(["", []]);
  });

  it("drops an answer to text that has changed since", async () => {
    const api = fakeApi({ slow: 40 });
    const search = new ScopeSearch(api, 0);
    search.update("slow");
    await wait(5);
    search.update("fast");
    await wait(60);
    expect(api.asked).toEqual(["slow", "fast"]);
    expect(search.matches).toEqual([match("fast")]);
  });

  it("reports a failed search and clears the error with the next text", async () => {
    const search = new ScopeSearch(fakeApi(), 0);
    search.update("fail");
    await wait(5);
    expect([search.error, search.matches, search.searching]).toEqual(["server down", [], false]);
    search.update("f");
    expect(search.error).toBeNull();
  });
});
