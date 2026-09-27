import { describe, expect, it } from "vite-plus/test";
import {
  createDiscogsClient,
  DiscogsApiError,
  NotImplementedError,
} from "../src/server/discogs/client.ts";

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(responses: (() => Response)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: (init?.headers as Record<string, string>) ?? {},
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
  it("sends token, user agent and currency, and reads rate limit headers", async () => {
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
    expect(client.rateLimit()).toEqual({ limit: 60, remaining: 57, used: null });
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

  it("throws DiscogsApiError on other failures and rejects stubs", async () => {
    const { fetchImpl } = fakeFetch([json({ message: "nope" }, {}, 500)]);
    const client = createDiscogsClient({
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    await expect(client.getIdentity()).rejects.toBeInstanceOf(DiscogsApiError);
    await expect(client.addToWantlist("u", 1)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(client.addToCollection("u", 1)).rejects.toBeInstanceOf(NotImplementedError);
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
});
