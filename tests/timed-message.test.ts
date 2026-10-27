import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { TimedMessage } from "../src/client/timed-message.svelte.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("clears a shown message after its time, unless a newer one replaced it", () => {
  const message = new TimedMessage(1000);
  message.show("Saved.");
  vi.advanceTimersByTime(600);
  message.show("Undone.");
  vi.advanceTimersByTime(600);
  expect(message.text).toBe("Undone.");
  vi.advanceTimersByTime(400);
  expect(message.text).toBeNull();
});

it("holds a progress message until the next one, and keeps the text when destroyed", () => {
  const message = new TimedMessage(1000);
  message.show("Saved.");
  message.hold("Adding 1 of 3…");
  vi.advanceTimersByTime(5000);
  expect(message.text).toBe("Adding 1 of 3…");

  message.show("Added.");
  message.destroy();
  vi.advanceTimersByTime(5000);
  expect(message.text).toBe("Added.");

  message.clear();
  expect(message.text).toBeNull();
});
