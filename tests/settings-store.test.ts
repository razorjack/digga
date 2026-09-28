import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AppApi } from "../src/client/api.ts";
import { settings } from "../src/client/stores.svelte.ts";
import { DEFAULT_CONFIG, type ColorScheme, type Config } from "../src/shared/config.ts";

const fake = vi.hoisted(() => ({
  api: {
    generation: 0,
    setSandbox: () => {},
    getSettings: async () => ({}) as Config,
    putSettings: async (config: Config) => config,
  },
}));

vi.mock("../src/client/api.ts", () => ({ api: fake.api as unknown as AppApi }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function withColorScheme(colorScheme: ColorScheme): Config {
  return { ...DEFAULT_CONFIG, appearance: { colorScheme } };
}

beforeEach(async () => {
  fake.api.getSettings = async () => DEFAULT_CONFIG;
  await settings.load();
});

describe("color scheme saves", () => {
  it("run in order, each from the config the one before returned, without a new version", async () => {
    const first = deferred<Config>();
    const sent: Config[] = [];
    fake.api.putSettings = (config) => {
      sent.push(config);
      return sent.length === 1 ? first.promise : Promise.resolve(config);
    };
    const version = settings.version;

    const light = settings.saveColorScheme("light");
    const dark = settings.saveColorScheme("dark");
    await Promise.resolve();
    expect(sent).toHaveLength(1);

    first.resolve({ ...withColorScheme("light"), queue: { ...DEFAULT_CONFIG.queue, limit: 50 } });
    await light;
    await dark;

    expect(sent.map((config) => config.appearance.colorScheme)).toEqual(["light", "dark"]);
    expect(sent[1]!.queue.limit).toBe(50);
    expect(settings.value?.appearance.colorScheme).toBe("dark");
    expect(settings.version).toBe(version);
  });

  it("still saves the next choice after one fails", async () => {
    const first = deferred<Config>();
    let calls = 0;
    fake.api.putSettings = (config) => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(config);
    };

    const light = settings.saveColorScheme("light");
    const dark = settings.saveColorScheme("dark");
    first.reject(new Error("offline"));

    await expect(light).rejects.toThrow("offline");
    await dark;
    expect(settings.value?.appearance.colorScheme).toBe("dark");
  });
});
