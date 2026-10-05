# Design brief

This is a brief for the design session, not a design system. Every concrete choice (type, palette,
layout, motion, iconography) belongs to that session. The constraints below are the ones that must
survive it.

## What the screen is for

A person sits with Digga for hours, listening to a few seconds of every track on thousands of
records, deciding with one key per record. The screen must let them read the facts of a release in
one glance, keep the player always present, and never make them reach for the mouse. Two goals
compete for attention: finding a handful of tunes remembered from pirate radio (the ID hunt, where
`candidate` marks a maybe-match) and building a DJ wantlist (accept = want). Both must feel
fast and safe: every action is undoable with `Z`.

## Hard constraints

- Dark and light schemes, following the system unless Settings picks one. Never pure black or
  pure white: the dark scheme has off-black surfaces and off-white text, the light one warm
  paper and ink. Low glare, no
  flashing, no autoplaying motion. Respect `prefers-reduced-motion`.
- Built for very long sessions: comfortable sizes for the facts read at a glance, clear hierarchy
  between the one thing being judged and everything else.
- Keyboard-first: every action shows its key. The mouse is optional. See `docs/KEYMAP.md`.
- The player is always present. It plays a YouTube embed (IFrame API) starting mid-track; the
  design must accept that the embed is a black rectangle we do not control. A hidden second player
  preloads the next release.
- Release facts readable in one glance: artist, title, label + catalogue number, year, country,
  format, styles, lowest price + number for sale, have/want counts, and the tracklist showing which
  tracks have a video and which are already heard (greyed).
- A visible session counter ("4,312 dug"), remaining count and ETA.
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
(verdict copy: skip, want, maybe, grail, snooze), not in motion that costs attention.

Avoid: generic SaaS cards, gradients, glassmorphism, rounded pastel, neon-cyberpunk clichés, anything
that reads as a music streaming app. Ergonomics win every tie.

## Pages

- **Triage** (`#/triage`): the release under judgement, the player, the tracklist, the verdict keys,
  the counter. Everything else recedes.
- **Twelves** (`#/twelves`): what has been accepted, wanted, owned, plus maybes and candidates; a
  list that reads like a record box, sortable, with notes.
- **Settings** (`#/settings/<tab>`): five tabs. Digging holds the filters, the order and the
  player defaults; Library the counts, the universe (styles, load years) and the dump jobs;
  Discogs the account, the imports and the seller shop; Backups the backups and exports; General
  the appearance. Each tab lists its own recent jobs with progress.

## The design as built (session 2)

Tokens live in `src/client/styles.css`; the reasons are in `docs/DECISIONS.md` (30 to 38).

- **Palette** (dark; the token for each role in brackets): ground `#161618` (`--bg`), sleeve `#1d1d20`
  (`--surface`, raised bars), groove `#323238` (`--rule`), dust `#8e897d` (`--fg-faint`, heard,
  disabled), faded `#a8a294` (`--fg-muted`, secondary text), paper `#ebe5d4` (`--fg`, primary
  text), flyer `#ffd21a` (`--accent`, used as a fill) on flyer-ink `#17150d` (`--on-accent`).
  The flyer also draws bars, underlines, outlines and progress (`--accent-mark`) and sets
  accented text (`--fg-accent`). A static photocopy grain covers the page at low opacity.
- **Light palette:** paper `#eee9dc` ground, a darker sleeve `#e4dece`, rules `#cbc4b2`, ink
  `#1c1a15` text with `#4f4b42` for secondary and `#605c53` for faint text. The flyer stays the
  fill under flyer-ink; marks and accented text turn dark amber `#855000`, since yellow is 1.2:1
  on paper. The grain darkens paper where it lightens the dark ground.
- **Type:** Michroma for artist names, page titles, counters, verdict copy and stamps; Martian
  Mono (87.5% width) for everything else. Sizes run 10 / 11 / 12.5 / 14 / 17 / 22 / 30 / 40 /
  64 px.
- **Triage layout:** top bar (wordmark, pages with keys, dug / to go / ETA / session count); left column with the catalogue-number stamp, label, artist, title, facts,
  market line, other versions and the scrolling tracklist; right column with the player, the
  now-playing line and progress bar (the start point is marked), player keys, the slip with the
  last verdict and "up next"; a verdict bar pinned to the bottom with filled key caps for
  R / A / M / C and outlined ones for N / D / Z / ?. Below 980 px the columns stack.
- **Tracklist rows:** position, a glyph (▶ playing, ● has a video, × won't embed, blank for no
  video), `artist – title` for compilation credits, notes (heard, played, no embed), the track
  mark as a small stamp, and the duration. Heard tunes are set in dust; the playing row gets the
  flyer bar.
- **States:** loading, "Space: start listening" before the first gesture, no videos / none will
  play (with `S` and `D`), a notice for a skipped embed, pending, retried and done wantlist pushes on
  the slip, undo ("undone" stamp), queue failed (`Enter` retries), no releases loaded, filters
  that match nothing, and the end of the queue: a large ALL DUG stamp with a way to go round the
  releases passed with `N` or to hear the snoozed records again. A round of snoozed records shows
  a strip above the desk (sleeve, with the flyer bar) counting what is left, with `Esc` back.
- **Twelves** reads like a record box: one row per record with catalogue number, artist and
  title, note, label and year, market, a verdict stamp and the day it was decided. Wants missing
  from the Discogs wantlist and maybes missing from the Maybe list carry a small marker, with a
  dashed banner above the shelf.
- **Settings** has a list of its tabs on the left, marked like a selected Twelves row, and the
  tab's sections beside it. Digging, Library and Discogs each render the part of the settings
  form they hold. A sticky save bar appears at the bottom only with a problem, a message or
  unsaved changes, and saves all of them from any tab; a tab with unsaved fields carries a small
  flyer dot.

## What exists already

The API contracts in `src/shared/api.ts` show the data available to the UI. `src/client/api.ts`
is the only way pages talk to the server.
