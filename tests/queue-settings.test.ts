import { describe, expect, it } from "vite-plus/test";
import { queueSettingsChange } from "../src/client/triage/queue-settings.ts";
import { type Config, DEFAULT_CONFIG } from "../src/shared/config.ts";

const saved: Config = structuredClone(DEFAULT_CONFIG);
const changed = (change: (config: Config) => void): Config => {
  const config = structuredClone(saved);
  change(config);
  return config;
};

describe("queueSettingsChange", () => {
  it("restarts the queue for the universe, the filters and the order", () => {
    for (const change of [
      (config: Config) => (config.universe.styles = ["Jungle"]),
      (config: Config) => (config.filters.yearTo = 2003),
      (config: Config) => (config.filters.skipHistory = false),
      (config: Config) => (config.queue.strategy = "random"),
      (config: Config) => (config.queue.limit = 50),
    ])
      expect(queueSettingsChange(saved, changed(change))).toEqual({ kind: "restart" });
  });

  it("keeps the queue for the player, the account, the currency and the appearance", () => {
    const after = changed((config) => {
      config.player.seekStepSeconds = 20;
      config.discogs.username = "dj";
      config.discogs.currency = "GBP";
      config.discogs.maybeListId = 7;
      config.appearance.colorScheme = "dark";
    });
    expect(queueSettingsChange(saved, after)).toEqual({ kind: "none" });
  });

  it("names the labels hidden and shown, a typed name matching a label with an id", () => {
    const before = changed((config) => {
      config.filters.excludeLabels = [
        { id: 88, name: "Moving Shadow" },
        { id: null, name: "Cold Storage" },
      ];
    });
    const after = changed((config) => {
      config.filters.excludeLabels = [
        { id: null, name: "moving shadow" },
        { id: 12, name: "Renegade Hardware" },
      ];
    });
    expect(queueSettingsChange(before, after)).toEqual({
      kind: "labels",
      hidden: [{ id: 12, name: "Renegade Hardware" }],
      shown: [{ id: null, name: "Cold Storage" }],
    });
  });
});
