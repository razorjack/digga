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

/** The tabs whose fields belong to the settings form, which the save bar saves. */
export const FORM_TABS: ReadonlySet<SettingsTab> = new Set(["digging", "library", "discogs"]);

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

/** The newest jobs of the given types, from jobs listed newest first. */
export function recentJobs(jobs: readonly Job[], types: readonly JobType[]): Job[] {
  return jobs.filter((job) => types.includes(job.type)).slice(0, RECENT_JOBS);
}
