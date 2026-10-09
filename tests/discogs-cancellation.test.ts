import { describe, expect, it, vi } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { createDiscogsClient } from "../src/server/discogs/client.ts";
import { importCollection } from "../src/server/importers/collection.ts";
import { createJobRunner } from "../src/server/jobs/runner.ts";
import { silentLogger } from "./helpers.ts";

describe("Discogs request cancellation", () => {
  it.each(["headers", "body"])(
    "times out stalled %s and releases the shared queue",
    async (phase) => {
      const stalled = Promise.withResolvers<Response>();
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      let signal: AbortSignal | null | undefined;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        if (fetchImpl.mock.calls.length > 1) return Response.json({ username: "dj" });
        signal = init?.signal;
        if (phase === "headers") return stalled.promise;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
        );
      });
      const client = createDiscogsClient({ fetchImpl, minIntervalMs: 0, timeoutMs: 20 });
      try {
        const failed = expect(client.getIdentity()).rejects.toMatchObject({ name: "TimeoutError" });
        const next = client.getIdentity();
        await failed;
        expect(signal?.aborted).toBe(true);
        await expect(next).resolves.toMatchObject({ username: "dj" });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      } finally {
        stalled.resolve(Response.json({}));
        stream?.close();
      }
    },
  );

  it("cancels a queued caller without cancelling another caller's active request", async () => {
    const response = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    });
    const client = createDiscogsClient({ fetchImpl, minIntervalMs: 0 });
    const first = client.getIdentity();
    const controller = new AbortController();
    try {
      await started.promise;
      const queued = client.withSignal(controller.signal).getUser("cancelled");
      controller.abort();
      await expect(queued).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      response.resolve(Response.json({ username: "first" }));
      await expect(first).resolves.toMatchObject({ username: "first" });
      fetchImpl.mockImplementation(async () => Response.json({ username: "next" }));
      await expect(client.getIdentity()).resolves.toMatchObject({ username: "next" });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      response.resolve(Response.json({}));
      await first;
    }
  });

  it("cancels a retry wait and lets another caller proceed", async () => {
    const sleeping = Promise.withResolvers<void>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(Response.json({ username: "next" }));
    const client = createDiscogsClient({
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {
        sleeping.resolve();
        await new Promise<void>(() => {});
      },
    });
    const controller = new AbortController();
    const request = client.withSignal(controller.signal).getIdentity();
    const cancelled = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await sleeping.promise;
    controller.abort();
    await cancelled;
    await expect(client.getIdentity()).resolves.toMatchObject({ username: "next" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("cancels a quota wait before sending another request", async () => {
    const sleeping = Promise.withResolvers<void>();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({}, { headers: { "X-Discogs-Ratelimit-Remaining": "1" } }),
    );
    const client = createDiscogsClient({
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {
        sleeping.resolve();
        await new Promise<void>(() => {});
      },
    });
    await client.getIdentity();
    const controller = new AbortController();
    const request = client.withSignal(controller.signal).getIdentity();
    const cancelled = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await sleeping.promise;
    controller.abort();
    await cancelled;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops an import job while its response body is stalled", async () => {
    const db = openDb(":memory:");
    const runner = createJobRunner(db, silentLogger);
    const started = Promise.withResolvers<void>();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestSignal: AbortSignal | null | undefined;
    const discogs = createDiscogsClient({
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal;
        started.resolve();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
        );
      },
    });
    try {
      const job = runner.run("import_collection", ({ signal }) =>
        importCollection({ db, discogs, logger: silentLogger }, { username: "dj", signal }),
      );
      await started.promise;
      await runner.stop();
      expect(requestSignal?.aborted).toBe(true);
      expect(runner.get(job.id)?.status).toBe("cancelled");
      expect(db.prepare("SELECT COUNT(*) FROM memberships").pluck().get()).toBe(0);
    } finally {
      stream?.close();
      await runner.stop();
      db.close();
    }
  });
});
