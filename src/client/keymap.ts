import type { VerdictStatus } from "../shared/types.ts";

/** Verdicts the triage keys write. */
export type TriageStatus = Extract<
  VerdictStatus,
  "rejected" | "accepted" | "maybe" | "candidate" | "no_audio"
>;

export type StampTone = "paper" | "flyer" | "dust";

export interface VerdictKey {
  status: TriageStatus;
  key: string;
  copy: string;
  hint: string;
  tone: StampTone;
}

export const VERDICT_KEYS: VerdictKey[] = [
  { status: "rejected", key: "R", copy: "skip", hint: "not for the box", tone: "paper" },
  { status: "accepted", key: "A", copy: "want", hint: "onto the wantlist", tone: "flyer" },
  { status: "maybe", key: "M", copy: "maybe", hint: "hear it again later", tone: "paper" },
  {
    status: "candidate",
    key: "C",
    copy: "grail",
    hint: "the one you've been hunting",
    tone: "flyer",
  },
  { status: "no_audio", key: "D", copy: "no audio", hint: "off the queue, unjudged", tone: "dust" },
];

/** How each verdict status reads on screen. */
export const STATUS_COPY: Record<VerdictStatus, string> = {
  rejected: "skip",
  accepted: "want",
  maybe: "maybe",
  candidate: "grail",
  no_audio: "no audio",
  wantlist: "wantlist",
  collection: "owned",
  seen: "seen",
};

export const STATUS_TONE: Record<VerdictStatus, StampTone> = {
  rejected: "paper",
  accepted: "flyer",
  maybe: "paper",
  candidate: "flyer",
  no_audio: "dust",
  wantlist: "paper",
  collection: "paper",
  seen: "dust",
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
    { keys: ["T"], label: "triage" },
    { keys: ["W"], label: "twelves" },
    { keys: [","], label: "settings" },
    { keys: ["?"], label: "show or hide these keys" },
  ],
};

export function triageKeyGroups(seekStepSeconds: number): KeyGroup[] {
  return [
    {
      title: "Verdicts",
      keys: [
        ...VERDICT_KEYS.map((v) => ({ keys: [v.key], label: `${v.copy}: ${v.hint}` })),
        { keys: ["N"], label: "next: decide later, it stays in the queue" },
        { keys: ["Z"], label: "undo the last verdict or next" },
      ],
    },
    {
      title: "Player",
      keys: [
        { keys: ["Space"], label: "play / pause" },
        { keys: ["J", "K"], label: "next / previous track (J skips heard tunes)" },
        { keys: ["←", "→"], label: `seek ${seekStepSeconds} s` },
        { keys: ["1", "…", "9"], label: "jump to 10% … 90%" },
        { keys: ["O"], label: "open the release on discogs.com" },
        { keys: ["S"], label: "search YouTube for the release" },
      ],
    },
    {
      title: "Track marks",
      keys: [
        { keys: ["⇧K"], label: "keep the playing track" },
        { keys: ["⇧M"], label: "meh" },
        { keys: ["⇧C"], label: "grail" },
      ],
    },
  ];
}

export const TWELVES_KEY_GROUPS: KeyGroup[] = [
  {
    title: "Twelves",
    keys: [
      { keys: ["1", "…", "6"], label: "switch shelf" },
      { keys: ["J", "K"], label: "move down / up (also ↓ ↑)" },
      { keys: ["S"], label: "change the sort" },
      { keys: ["O"], label: "open the release on discogs.com" },
      { keys: ["E"], label: "edit the note" },
      { keys: ["A", "M", "C", "R"], label: "re-judge a triage verdict" },
      { keys: ["Z"], label: "undo the last change" },
    ],
  },
];

/** True when the key press belongs to a form field rather than to the shortcuts. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Shortcuts are single keys; anything held with Cmd, Ctrl or Alt belongs to the browser. */
export function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}
