import type { TrackMark, VerdictStatus } from "../shared/types.ts";
import { youtubeIdFromUrl } from "../shared/youtube.ts";
import { ROUTES } from "./routes.ts";

/**
 * The modifier that paste and save are held with, as the keyboard labels it: ⌘ on Apple systems,
 * Ctrl elsewhere. The handlers accept either; only the caps differ.
 */
export const COMMAND_MODIFIER = commandModifier(globalThis.navigator?.platform ?? "");

/** Verdicts the triage keys write. */
export type TriageStatus = Extract<
  VerdictStatus,
  "rejected" | "accepted" | "maybe" | "candidate" | "snoozed" | "no_audio"
>;

export type StampTone = "plain" | "accent" | "muted";

/** A verdict key; its stamp's words and tone are STATUS_COPY's and STATUS_TONE's. */
export interface VerdictKey {
  status: TriageStatus;
  key: string;
  hint: string;
  /** "judge" verdicts get the large buttons; "defer" ones sit with N in the smaller group. */
  group: "judge" | "defer";
  /** Only offered once a Discogs Maybe list is chosen in Settings. */
  needsMaybeList?: boolean;
}

export const VERDICT_KEYS: VerdictKey[] = [
  {
    status: "rejected",
    key: "R",
    hint: "not for the box",
    group: "judge",
  },
  {
    status: "accepted",
    key: "A",
    hint: "onto the wantlist",
    group: "judge",
  },
  {
    status: "maybe",
    key: "M",
    hint: "for your Maybe list",
    group: "judge",
    needsMaybeList: true,
  },
  {
    status: "candidate",
    key: "C",
    hint: "the one you've been hunting",
    group: "judge",
  },
  {
    status: "snoozed",
    key: "L",
    hint: "hear it again later",
    group: "defer",
  },
  {
    status: "no_audio",
    key: "D",
    hint: "nothing plays, so it leaves the queue without a verdict",
    group: "defer",
  },
];

/** The verdict a key writes, given as `event.key` in lower case; undefined for other keys. */
export function verdictForKey(key: string): VerdictKey | undefined {
  return VERDICT_KEYS.find((verdict) => verdict.key.toLowerCase() === key);
}

/** A verdict the triage keys write, which Twelves can change; the rest is the account's. */
export function isTriageStatus(status: VerdictStatus): status is TriageStatus {
  return VERDICT_KEYS.some((verdict) => verdict.status === status);
}

/** What a record's stamp says: its verdict, or what the Discogs account holds of it. */
export type RecordStamp = VerdictStatus | "wantlist" | "collection";

/** How each stamp reads on screen. */
export const STATUS_COPY: Record<RecordStamp, string> = {
  rejected: "skip",
  accepted: "want",
  maybe: "maybe",
  candidate: "grail",
  no_audio: "no audio",
  snoozed: "snooze",
  wantlist: "wantlist",
  collection: "owned",
  seen: "seen",
};

/** Shift and one of these keys marks the playing track in Triage; the same again clears it. */
export const TRACK_MARK_KEYS: { mark: TrackMark; key: string }[] = [
  { mark: "keep", key: "K" },
  { mark: "meh", key: "M" },
  { mark: "candidate", key: "C" },
];

/** The mark a key sets with Shift held, given as `event.key` in lower case; else null. */
export function trackMarkForKey(key: string): TrackMark | null {
  return TRACK_MARK_KEYS.find((binding) => binding.key.toLowerCase() === key)?.mark ?? null;
}

export const STATUS_TONE: Record<RecordStamp, StampTone> = {
  rejected: "plain",
  accepted: "accent",
  maybe: "plain",
  candidate: "accent",
  no_audio: "muted",
  snoozed: "muted",
  wantlist: "plain",
  collection: "plain",
  seen: "muted",
};

export interface KeyHelp {
  keys: string[];
  label: string;
}

export interface KeyGroup {
  title: string;
  keys: KeyHelp[];
}

export const GLOBAL_KEYS: KeyGroup = {
  title: "Pages",
  keys: [
    ...ROUTES.map((destination) => ({ keys: [destination.key], label: destination.help })),
    { keys: ["?"], label: "show or hide these keys" },
  ],
};

export function triageKeyGroups(seekStepSeconds: number, hasMaybeList: boolean): KeyGroup[] {
  return [verdictKeyGroup(hasMaybeList), playerKeyGroup(seekStepSeconds), TRACK_MARK_KEY_GROUP];
}

function verdictKeyGroup(hasMaybeList: boolean): KeyGroup {
  return {
    title: "Verdicts",
    keys: [
      ...VERDICT_KEYS.map((verdict) => ({
        keys: [verdict.key],
        label:
          verdict.needsMaybeList && !hasMaybeList
            ? `${STATUS_COPY[verdict.status]}: choose your Discogs Maybe list in Settings first`
            : `${STATUS_COPY[verdict.status]}: ${verdict.hint}`,
      })),
      { keys: ["N"], label: "next: decide later, and it stays in the queue" },
      { keys: ["E"], label: "write a note (Enter or leaving the field saves it, Esc cancels)" },
      { keys: ["X"], label: "hide label: every record on this label leaves the queue" },
      {
        keys: ["F"],
        label: "dig one label, artist or seller: only their records stay in the queue",
      },
      { keys: ["Z"], label: "undo the last verdict, next or hidden label" },
      { keys: ["Esc"], label: "back to the whole queue from snoozed records or a dig" },
    ],
  };
}

function playerKeyGroup(seekStepSeconds: number): KeyGroup {
  return {
    title: "Player",
    keys: [
      { keys: ["Space"], label: "play / pause" },
      { keys: ["J", "K"], label: "next / previous track (J skips heard tunes)" },
      { keys: ["←", "→"], label: `seek ${seekStepSeconds} s` },
      { keys: ["1", "…", "9"], label: "jump to 10% … 90%" },
      { keys: ["O"], label: "open the release on discogs.com" },
      {
        keys: ["P"],
        label: "ask Discogs for the release's lowest price, have/want and current videos",
      },
      { keys: ["S"], label: "search YouTube for the record" },
      { keys: commandKeys("V"), label: "attach a copied YouTube link to the release, and play it" },
    ],
  };
}

const TRACK_MARK_KEY_GROUP: KeyGroup = {
  title: "Mark the playing track",
  keys: [
    { keys: ["⇧K"], label: "keep" },
    { keys: ["⇧M"], label: "meh" },
    { keys: ["⇧C"], label: "grail" },
  ],
};

export const TWELVES_KEY_GROUPS: KeyGroup[] = [
  {
    title: "Twelves",
    keys: [
      { keys: ["1", "…", "9"], label: "switch shelf (8 is your marked tracks, 9 is no audio)" },
      { keys: ["J", "K"], label: "move down / up (also ↓ ↑), into the next page too" },
      { keys: ["←", "→"], label: "previous / next page of 500" },
      { keys: ["S"], label: "change the sort" },
      { keys: ["O"], label: "open the release on discogs.com" },
      { keys: ["E"], label: "edit the note, on a record or a marked track" },
      { keys: ["A", "M", "C", "R", "L", "D"], label: "change the verdict (D is no audio)" },
      { keys: ["Y"], label: "search YouTube for the record" },
      { keys: commandKeys("V"), label: "attach a copied YouTube link to the record" },
      { keys: ["A", "C"], label: "on a want or grail missing from your Discogs wantlist: add it" },
      { keys: ["Enter"], label: "replay the selected record or marked track in Triage" },
      {
        keys: ["Shift", "Enter"],
        label: "replay from the selected record to the end of the shelf",
      },
      { keys: ["I"], label: "check your Discogs Maybe list again" },
      { keys: ["Z"], label: "undo the last change" },
    ],
  },
];

/** Inputs that take no typed text, so a focused one (after a click) keeps the shortcuts working. */
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "button", "submit", "reset"]);

/** True when the key press or paste belongs to a form field rather than to the shortcuts. */
export function isTyping(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Keys a focused native control needs for activation or changing its value. */
export function isControlKey(event: KeyboardEvent): boolean {
  if (isTyping(event)) return true;
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest("input, button, a[href], summary");
  if (!control) return false;
  if (control instanceof HTMLInputElement) {
    if (control.type === "range")
      return (
        event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)
      );
    if (control.type === "radio" && event.key.startsWith("Arrow")) return true;
    return event.key === " " || event.key === "Enter";
  }
  if (control.tagName === "A") return event.key === "Enter";
  return event.key === " " || event.key === "Enter";
}

/** A key pressed in an open dialog, which handles its own keys. */
export function isInDialog(event: Event): boolean {
  return event.target instanceof Element && event.target.closest("dialog[open]") !== null;
}

/** What a page says when the link pasted on it is not one it can attach. */
export const NOT_A_VIDEO_LINK = "That is not a YouTube link.";

/**
 * A link pasted outside a form field, which Digga attaches to a release when it is a YouTube
 * video link; null for anything else, such as text that is no link.
 */
export function pastedLink(event: ClipboardEvent): { url: string; isVideo: boolean } | null {
  if (isTyping(event)) return null;
  const url = event.clipboardData?.getData("text").trim() ?? "";
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  return { url, isVideo: youtubeIdFromUrl(url) !== null };
}

/**
 * The key a shortcut table looks up: a letter in lower case, any other key as typed, or null for
 * a letter held with Shift, which runs no letter shortcut. Shift with any other key still counts,
 * since some layouts (French AZERTY among them) need it to type `/` or the digits. No layout needs
 * Shift for Enter, so Shift+Enter is a shortcut of its own.
 */
export function shortcutKey(event: Pick<KeyboardEvent, "key" | "shiftKey">): string | null {
  if (event.key === "Enter" && event.shiftKey) return "Shift+Enter";
  if (event.key.length !== 1) return event.key;
  const lower = event.key.toLowerCase();
  const isLetter = lower !== event.key.toUpperCase();
  if (isLetter && event.shiftKey) return null;
  return lower;
}

/** Shortcuts are single keys; anything held with Cmd, Ctrl or Alt belongs to the browser. */
export function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** `navigator.platform` names Apple systems Mac…, iPhone or iPad. */
export function commandModifier(platform: string): "⌘" | "Ctrl" {
  return /^(Mac|iPhone|iPad)/.test(platform) ? "⌘" : "Ctrl";
}

/** A Cmd or Ctrl shortcut's caps: one ⌘V cap on Apple keyboards, Ctrl and V elsewhere. */
export function commandKeys(key: string, modifier = COMMAND_MODIFIER): string[] {
  return modifier === "⌘" ? [`⌘${key}`] : ["Ctrl", key];
}

/** The same shortcut as text: ⌘S, or Ctrl+S. */
export function commandShortcut(key: string, modifier = COMMAND_MODIFIER): string {
  return commandKeys(key, modifier).join("+");
}

/** Cmd+A on a Mac, Ctrl+A elsewhere. */
export function isSelectAll(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a";
}

export const SHOP_KEYS = { keep: "A", skip: "R", undo: "Z", refreshAudio: "P" } as const;

export const SHOP_KEY_GROUPS: KeyGroup[] = [
  {
    title: "Shopping",
    keys: [
      { keys: [SHOP_KEYS.keep], label: "shortlist or keep this copy, then next" },
      {
        keys: [SHOP_KEYS.skip],
        label: "skip or remove this copy, then next; leave the wantlist unchanged",
      },
      { keys: [SHOP_KEYS.undo], label: "undo the last shopping decision" },
      { keys: [SHOP_KEYS.refreshAudio], label: "refresh audio links from Discogs" },
      { keys: ["Space"], label: "play or pause" },
      { keys: ["J", "K"], label: "next or previous track" },
      { keys: ["←", "→"], label: "seek by the configured step" },
      { keys: ["1–9"], label: "jump to 10–90%" },
      { keys: ["O"], label: "open this copy on Discogs" },
    ],
  },
];
