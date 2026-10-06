import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { FilterPreview } from "../src/client/settings/preview.svelte.ts";
import { SettingsJobs } from "../src/client/settings/jobs.svelte.ts";
import {
  DiscogsSettings,
  tokenStorageText,
  usernameAfterTokenSave,
} from "../src/client/settings/discogs.svelte.ts";
import type { Api } from "../src/client/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { DiscogsAccountResponse, DiscogsListsResponse, Stats } from "../src/shared/api.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("Settings request ownership", () => {
  it("discards stale preview responses and pending work after invalid filters", async () => {
    vi.useFakeTimers();
    const older = deferred<Stats>();
    const newer = deferred<Stats>();
    const getStats = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const preview = new FilterPreview({ getStats } as unknown as Api);
    preview.update(DEFAULT_CONFIG.filters);
    await vi.advanceTimersByTimeAsync(300);
    preview.update({ ...DEFAULT_CONFIG.filters, countries: ["UK"] });
    await vi.advanceTimersByTimeAsync(300);
    const latest = { remaining: 22 } as Stats;
    newer.resolve(latest);
    await Promise.resolve();
    older.resolve({ remaining: 11 } as Stats);
    await Promise.resolve();
    expect(preview.value).toEqual(latest);
    preview.update(DEFAULT_CONFIG.filters);
    preview.update(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(preview.value).toBeNull();
    preview.destroy();
  });

  it("does not publish a preview response after destruction", async () => {
    vi.useFakeTimers();
    const pending = deferred<Stats>();
    const preview = new FilterPreview({ getStats: () => pending.promise } as unknown as Api);
    preview.update(DEFAULT_CONFIG.filters);
    await vi.advanceTimersByTimeAsync(300);
    preview.destroy();
    pending.resolve({ remaining: 11 } as Stats);
    await Promise.resolve();
    expect(preview.value).toBeNull();
  });

  it("polls jobs only after the preceding request finishes and stops on destruction", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ jobs: [] }>();
    const getJobs = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [{ status: "running" }] })
      .mockReturnValue(pending.promise);
    const http = { getJobs } as unknown as Api;
    const jobs = new SettingsJobs(http);
    await jobs.load();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getJobs).toHaveBeenCalledTimes(2);
    jobs.destroy();
    pending.resolve({ jobs: [] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(getJobs).toHaveBeenCalledTimes(2);
    expect(jobs.items).toHaveLength(1);
  });

  it("refreshes the counts when a job ends, also one that started and ended between two reads", async () => {
    vi.useFakeTimers();
    const job = (id: string, status: string) => ({ id, type: "import_wantlist", status });
    const getJobs = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [job("1", "done")] })
      .mockResolvedValueOnce({ jobs: [job("2", "done"), job("1", "done")] })
      .mockResolvedValueOnce({ jobs: [job("3", "running"), job("2", "done"), job("1", "done")] })
      .mockResolvedValueOnce({ jobs: [job("3", "failed"), job("2", "done"), job("1", "done")] })
      .mockResolvedValueOnce({ jobs: [job("3", "failed"), job("2", "done"), job("1", "done")] });
    const http = { getJobs } as unknown as Api;
    const refreshStats = vi.fn(async () => {});
    const jobs = new SettingsJobs(http, refreshStats);

    // The page opens on jobs that ended earlier: nothing new to count.
    await jobs.load();
    expect(refreshStats).not.toHaveBeenCalled();
    // A job the page started ended before the page read the jobs again.
    await jobs.load();
    expect(refreshStats).toHaveBeenCalledTimes(1);
    await jobs.load();
    expect(refreshStats).toHaveBeenCalledTimes(1);
    await jobs.load();
    expect(refreshStats).toHaveBeenCalledTimes(2);
    await jobs.load();
    expect(refreshStats).toHaveBeenCalledTimes(2);
    jobs.destroy();
  });

  it("discards the previous account's late list response", async () => {
    const older = deferred<DiscogsListsResponse>();
    const getDiscogsLists = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockResolvedValue({ lists: [] });
    const discogs = new DiscogsSettings({ getDiscogsLists } as unknown as Api);
    const first = discogs.loadLists();
    await discogs.loadLists();
    older.resolve({ lists: [{ id: 1, name: "Old account", public: false }] });
    await first;
    expect(discogs.lists).toEqual([]);
    expect(discogs.listsState).toBe("idle");
    discogs.destroy();
  });

  it("shows the account a saved token answers, not an older check", async () => {
    const olderCheck = deferred<DiscogsAccountResponse>();
    const account = (fields: Partial<DiscogsAccountResponse>): DiscogsAccountResponse => ({
      username: "dj",
      hasToken: false,
      tokenSource: null,
      tokenEncrypted: false,
      tokenUsername: null,
      error: null,
      dataAccount: null,
      ...fields,
    });
    const setDiscogsToken = vi
      .fn()
      .mockResolvedValueOnce(account({ hasToken: true, tokenSource: "saved", tokenUsername: "dj" }))
      .mockRejectedValueOnce(new Error("A Discogs token has no spaces or special characters"));
    const discogs = new DiscogsSettings({
      getDiscogsAccount: () => olderCheck.promise,
      setDiscogsToken,
    } as unknown as Api);

    const checking = discogs.loadAccount();
    expect(await discogs.saveToken("abc123")).toBe(true);
    olderCheck.resolve(account({}));
    await checking;
    expect(discogs.tokenStatus).toBe("Works for dj.");
    expect(discogs.tokenProblem).toBeNull();

    expect(await discogs.saveToken("two words")).toBe(false);
    expect(discogs.tokenError).toBe("A Discogs token has no spaces or special characters");
    expect(discogs.tokenSaving).toBe(false);
    expect(discogs.account?.tokenUsername).toBe("dj");
    discogs.destroy();
  });
});

describe("the Username field after a token save", () => {
  const account = (username: string): DiscogsAccountResponse => ({
    username,
    hasToken: true,
    tokenSource: "saved",
    tokenEncrypted: false,
    tokenUsername: "dj",
    error: null,
    dataAccount: null,
  });

  it("takes the username the server adopted with the first token", () => {
    expect(usernameAfterTokenSave("", "", account("dj"))).toBe("dj");
  });

  it("keeps a username typed since the last save, and keeps the field when nothing was saved", () => {
    expect(usernameAfterTokenSave("someone", "", account("dj"))).toBe("someone");
    expect(usernameAfterTokenSave("", "", null)).toBe("");
  });

  it("keeps the saved username, which the server does not replace", () => {
    expect(usernameAfterTokenSave("dj", "dj", account("dj"))).toBe("dj");
  });
});

describe("the hint on where the token is kept", () => {
  const account = (fields: Partial<DiscogsAccountResponse>): DiscogsAccountResponse => ({
    username: "dj",
    hasToken: true,
    tokenSource: "saved",
    tokenEncrypted: false,
    tokenUsername: "dj",
    error: null,
    dataAccount: null,
    ...fields,
  });

  it("says whether a saved token is encrypted", () => {
    expect(tokenStorageText(account({ tokenEncrypted: true }))).toBe(
      "From discogs.com/settings/developers; saved encrypted in secrets.env beside the database.",
    );
    expect(tokenStorageText(account({}))).toBe(
      "From discogs.com/settings/developers; saved unencrypted in secrets.env beside the database.",
    );
    expect(tokenStorageText(account({ hasToken: false, tokenSource: null }))).toBe(
      "From discogs.com/settings/developers; saved in secrets.env beside the database.",
    );
    expect(tokenStorageText(null)).toBe(
      "From discogs.com/settings/developers; saved in secrets.env beside the database.",
    );
  });
});
