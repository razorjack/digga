import { expect, it, vi } from "vite-plus/test";
import { SessionCheckpoint } from "../src/client/triage/checkpoint.svelte.ts";
import type { Api } from "../src/client/api.ts";
import type { SessionState } from "../src/shared/digging-session.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";

function checkpoint() {
  const state: SessionState = {
    seed: null,
    currentId: 1,
    passedIds: [],
    scope: null,
    roundIds: null,
    queueBeforeRound: null,
    playback: null,
  };
  const putSession = vi.fn().mockResolvedValue({ saved: true });
  const getLatestSession = vi.fn().mockResolvedValue(null);
  const api = { getLatestSession, putSession } as unknown as Api;
  const session = {
    status: "ready" as const,
    checkpoint: () => structuredClone(state),
    restoreSession: vi.fn(),
  };
  const player = {
    sessionId: null as string | null,
    playbackPosition: () => null,
    restorePlayback: vi.fn(),
    pauseForResume: vi.fn(),
  };
  const settings = { value: DEFAULT_CONFIG, save: vi.fn() };
  return {
    checkpoint: new SessionCheckpoint(api, session, player, settings),
    putSession,
    getLatestSession,
    state,
    player,
  };
}

it("reports a failed save, retries the current state on the next checkpoint and clears the report", async () => {
  const test = checkpoint();
  await test.checkpoint.open();
  test.putSession.mockRejectedValueOnce(new Error("disk full"));
  await test.checkpoint.save();
  expect(test.checkpoint.message).toContain("disk full");
  test.state.currentId = 2;
  await test.checkpoint.save();
  expect(test.putSession.mock.lastCall?.[0].state.currentId).toBe(2);
  expect(test.checkpoint.message).toBe("");
  await test.checkpoint.save();
  expect(test.putSession).toHaveBeenCalledTimes(2);
});

it("does not publish a stale save after starting a fresh session", async () => {
  const test = checkpoint();
  await test.checkpoint.open();
  const pending = Promise.withResolvers<{ saved: boolean }>();
  test.putSession.mockReturnValueOnce(pending.promise);
  const saving = test.checkpoint.save();
  const previousId = test.player.sessionId;
  test.checkpoint.startFresh();
  pending.resolve({ saved: true });
  await saving;
  expect(test.checkpoint.message).toBe("");
  expect(test.player.sessionId).not.toBe(previousId);
  await test.checkpoint.save();
  expect(test.putSession).toHaveBeenCalledTimes(2);
});

it("offers the saved session on the first start only; a restart starts a new session", async () => {
  const test = checkpoint();
  await test.checkpoint.open();
  const first = test.player.sessionId;
  expect(first).not.toBeNull();
  await test.checkpoint.open();
  expect(test.getLatestSession).toHaveBeenCalledTimes(1);
  expect(test.player.sessionId).not.toBeNull();
  expect(test.player.sessionId).not.toBe(first);
});
