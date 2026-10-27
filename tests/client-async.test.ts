import { expect, it } from "vite-plus/test";
import { Generation, SerialQueue } from "../src/client/async.ts";

it("makes earlier checks stale when a new generation starts or the owner ends", () => {
  const generation = new Generation();
  const first = generation.next();
  const sameGeneration = generation.current();
  expect(first()).toBe(true);
  expect(sameGeneration()).toBe(true);

  const second = generation.next();
  expect(first()).toBe(false);
  expect(sameGeneration()).toBe(false);
  expect(second()).toBe(true);

  generation.invalidate();
  expect(second()).toBe(false);
  expect(generation.ended).toBe(false);

  const third = generation.next();
  generation.end();
  expect(third()).toBe(false);
  expect(generation.next()()).toBe(false);
  expect(generation.ended).toBe(true);
});

it("runs queued operations one at a time, in order, past a failure", async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  const { promise: firstGate, resolve: openFirst } = Promise.withResolvers<void>();

  const first = queue.run(async () => {
    events.push("first starts");
    await firstGate;
    events.push("first ends");
    return 1;
  });
  const failing = queue.run(async () => {
    events.push("failing runs");
    throw new Error("refused");
  });
  const last = queue.run(async () => {
    events.push("last runs");
    return 3;
  });
  const idle = queue.idle().then(() => events.push("idle"));

  await Promise.resolve();
  expect(events).toEqual(["first starts"]);
  openFirst();

  await expect(first).resolves.toBe(1);
  await expect(failing).rejects.toThrow("refused");
  await expect(last).resolves.toBe(3);
  await idle;
  expect(events).toEqual(["first starts", "first ends", "failing runs", "last runs", "idle"]);
});
