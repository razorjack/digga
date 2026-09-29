import { describe, expect, it } from "vite-plus/test";
import { createDiscogsClient, DiscogsApiError } from "../src/server/discogs/client.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeFetch(responses: (() => Response)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  };
  return { fetchImpl, calls };
}

const json =
  (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

describe("discogs client", () => {
  it("sends token, user agent and currency", async () => {
    const { fetchImpl, calls } = fakeFetch([
      json(
        { id: 1, title: "x" },
        { "X-Discogs-Ratelimit-Remaining": "57", "X-Discogs-Ratelimit": "60" },
      ),
    ]);
    const client = createDiscogsClient({
      token: "abc",
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
    });
    const rel = await client.getRelease(1, "EUR");
    expect(rel.title).toBe("x");
    expect(calls[0]!.url).toBe("https://api.discogs.com/releases/1?curr_abbr=EUR");
    expect(calls[0]!.headers.Authorization).toBe("Discogs token=abc");
    expect(calls[0]!.headers["User-Agent"]).toMatch(/^Digga\/0\.1 \(\+https:/);
    expect(client.hasToken()).toBe(true);
  });

  it("spaces requests by the minimum interval", async () => {
    const { fetchImpl } = fakeFetch([json({}), json({}), json({})]);
    const sleeps: number[] = [];
    let clock = 0;
    const client = createDiscogsClient({
      fetchImpl,
      minIntervalMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    await client.getIdentity();
    clock += 200;
    await client.getIdentity();
    await client.getIdentity();
    expect(sleeps).toEqual([800, 1000]);
  });

  it("retries on 429 using Retry-After and pauses when the quota is nearly used", async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ message: "slow down" }, { "Retry-After": "2" }, 429),
      json({ ok: 1 }, { "X-Discogs-Ratelimit-Remaining": "1" }),
      json({ ok: 2 }),
    ]);
    const sleeps: number[] = [];
    const client = createDiscogsClient({
      fetchImpl,
      minIntervalMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
      now: () => 0,
    });
    await client.getIdentity();
    await client.getIdentity();
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 60000]);
  });

  it("throws DiscogsApiError on other failures", async () => {
    const { fetchImpl } = fakeFetch([json({ message: "nope" }, {}, 500)]);
    const client = createDiscogsClient({
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    await expect(client.getIdentity()).rejects.toBeInstanceOf(DiscogsApiError);
  });

  it("builds paginated collection and wantlist URLs", async () => {
    const { fetchImpl, calls } = fakeFetch([json({}), json({})]);
    const client = createDiscogsClient({
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    await client.getCollectionPage("dj name", 2, 50);
    await client.getWantlistPage("dj", 3);
    expect(calls[0]!.url).toBe(
      "https://api.discogs.com/users/dj%20name/collection/folders/0/releases?page=2&per_page=50&sort=added&sort_order=desc",
    );
    expect(calls[1]!.url).toBe("https://api.discogs.com/users/dj/wants?page=3&per_page=100");
  });

  it("reads a user's profile and a page of their shop", async () => {
    const { fetchImpl, calls } = fakeFetch([json({ id: 6, username: "Shop" }), json({})]);
    const client = createDiscogsClient({
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    expect(await client.getUser("the shop")).toEqual({ id: 6, username: "Shop" });
    await client.getInventoryPage("the shop", 4);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.discogs.com/users/the%20shop",
      "https://api.discogs.com/users/the%20shop/inventory?page=4&per_page=100",
    ]);
  });

  it("adds to and removes from the wantlist, treating a missing want as removed", async () => {
    const { fetchImpl, calls } = fakeFetch([
      json({ id: 7 }, {}, 201),
      json({ id: 7 }, {}, 201),
      () => new Response(null, { status: 204 }),
      json({ message: "The requested resource was not found." }, {}, 404),
      json({ message: "You must authenticate to access this resource." }, {}, 401),
    ]);
    const client = createDiscogsClient({
      token: "t0k",
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    await client.addToWantlist("dj name", 7);
    await client.addToWantlist("dj name", 7, { notes: "from Digga" });
    await client.removeFromWantlist("dj name", 7);
    await client.removeFromWantlist("dj name", 7);
    await expect(client.removeFromWantlist("dj name", 7)).rejects.toBeInstanceOf(DiscogsApiError);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["PUT", "https://api.discogs.com/users/dj%20name/wants/7", null],
      ["PUT", "https://api.discogs.com/users/dj%20name/wants/7", '{"notes":"from Digga"}'],
      ["DELETE", "https://api.discogs.com/users/dj%20name/wants/7", null],
      ["DELETE", "https://api.discogs.com/users/dj%20name/wants/7", null],
      ["DELETE", "https://api.discogs.com/users/dj%20name/wants/7", null],
    ]);
    expect(calls[1]!.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.headers.Authorization).toBe("Discogs token=t0k");
  });
});
