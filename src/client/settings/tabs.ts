import type { Config } from "../../shared/config.ts";
import type { Job, JobType } from "../../shared/types.ts";

/** The groups Settings shows one at a time, in the order of its section list. */
export const SETTINGS_TABS = ["digging", "library", "discogs", "backups", "general"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  digging: "Digging",
  library: "Library",
  discogs: "Discogs",
  backups: "Backups",
  general: "General",
};

/** The parts of the config each tab's fields edit, in the settings form the save bar saves. */
const TAB_SETTINGS: Partial<Record<SettingsTab, readonly (keyof Config)[]>> = {
  digging: ["filters", "queue", "player"],
  library: ["universe"],
  discogs: ["discogs"],
};

/** The jobs a tab starts, which it lists under its controls. */
export const TAB_JOBS = {
  library: ["dump_update", "dump_download", "dump_load"],
  discogs: [
    "import_collection",
    "import_wantlist",
    "import_history",
    "import_list",
    "import_seller",
  ],
} as const satisfies Record<string, readonly JobType[]>;

/** How many of its jobs a tab lists, newest first. */
const RECENT_JOBS = 5;

/**
 * The tab `#/settings/<anchor>` opens: a tab's name, or `sandbox`, which General holds and
 * highlights. Anything else opens Digging.
 */
export function settingsTab(anchor: string | null): SettingsTab {
  if (anchor === "sandbox") return "general";
  return SETTINGS_TABS.find((tab) => tab === anchor) ?? "digging";
}

/** Whether the tab holds part of the settings form. */
export function hasSettingsForm(tab: SettingsTab): boolean {
  return TAB_SETTINGS[tab] !== undefined;
}

/** The tabs whose fields differ from the saved settings. */
export function unsavedTabs(draft: Config, saved: Config): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) =>
    (TAB_SETTINGS[tab] ?? []).some(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]),
    ),
  );
}

/** The newest jobs of the given types, from jobs listed newest first. */
export function recentJobs(jobs: readonly Job[], types: readonly JobType[]): Job[] {
  return jobs.filter((job) => types.includes(job.type)).slice(0, RECENT_JOBS);
}
