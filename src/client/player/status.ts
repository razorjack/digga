// A plain module, apart from the player's runes, so the end-to-end tests can import the copy.

/** What the Triage player is doing. */
export type PlayerStatus =
  | "starting"
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "no_audio"
  | "needs_gesture"
  | "unavailable";

/** How each status reads under the video. */
export const PLAYER_STATUS_COPY: Record<PlayerStatus, string> = {
  starting: "starting",
  idle: "",
  loading: "cueing up",
  playing: "playing",
  paused: "paused",
  ended: "end of the tracks",
  no_audio: "no audio",
  needs_gesture: "waiting for Space",
  unavailable: "player unavailable",
};
