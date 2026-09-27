# Design brief

This is a brief for the design session, not a design system. Every concrete choice (type, palette,
layout, motion, iconography) belongs to that session. The constraints below are the ones that must
survive it.

## What the screen is for

A person sits with Digga for hours, listening to a few seconds of every track on thousands of
records, deciding with one key per record. The screen must let them read the facts of a release in
one glance, keep the player always present, and never make them reach for the mouse. Two goals
compete for attention: finding a handful of tunes remembered from pirate radio (the ID hunt, where
`candidate` marks a maybe-match) and building a DJ wantlist (accept = wheel up). Both must feel
fast and safe: every action is undoable with `Z`.

## Hard constraints

- Dark mode only. Off-black surfaces, never pure black; off-white text, never pure white. Low
  glare, no flashing, no autoplaying motion. Respect `prefers-reduced-motion`.
- Built for very long sessions: comfortable sizes for the facts read at a glance, clear hierarchy
  between the one thing being judged and everything else.
- Keyboard-first: every action shows its key. The mouse is optional. See `docs/KEYMAP.md`.
- The player is always present. It plays a YouTube embed (IFrame API) starting mid-track; the
  design must accept that the embed is a black rectangle we do not control. A hidden second player
  preloads the next release.
- Release facts readable in one glance: artist, title, label + catalogue number, year, country,
  format, styles, lowest price + number for sale, have/want counts, and the tracklist showing which
  tracks have a video and which are already heard (greyed).
- A visible session counter ("4,312 rinsed"), remaining count and ETA.
- States that need a treatment: normal, `no_audio` (no videos, offer the YouTube search fallback),
  video failed to embed, loading the next release, undo confirmation, end of queue.
- Must work unchanged inside an Electron window: no reliance on browser chrome, room for a custom
  title bar, no hover-only affordances.

## Aesthetic direction

Minimal but dirty, in a techstep way. Raw form that fits jungle, techstep and neurofunk: white
labels and test pressings, stamped and hand-written catalogue numbers, deadwax etchings,
photocopied flyers, grain and distortion used sparingly, industrial or monospace type, one harsh
accent colour. Slightly courageous and whimsical: the app should have a personality and one or two
signature elements that make it distinct and fun. The whimsy lives in copy and micro-details
(verdict copy speaks MC: skip, wheel up, bo!), not in motion that costs attention.

Avoid: generic SaaS cards, gradients, glassmorphism, rounded pastel, neon-cyberpunk clichés, anything
that reads as a music streaming app. Ergonomics win every tie.

## Pages

- **Triage** (`#/triage`): the release under judgement, the player, the tracklist, the verdict keys,
  the counter. Everything else recedes.
- **Twelves** (`#/twelves`): what has been accepted, wanted, owned, plus maybes and candidates; a
  list that reads like a record box, sortable, with notes.
- **Settings** (`#/settings`): universe (styles, load years), filters, strategy, Discogs account,
  player defaults, and the jobs panel (load dump, import seeds, enrich) with progress.

## What exists already

The API contracts in `src/shared/api.ts` and the placeholder pages in `src/client/pages/` show the
data available to the UI. `src/client/api.ts` is the only way pages talk to the server.
