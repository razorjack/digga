# Code quality audit

All three confirmed defects and all six refactoring priorities from the 2026-09-28 audit are
resolved. The approved standards were committed first as `babfbce`. Each defect has its own
commit, followed by separate commits for the refactoring and additional recovery fixes.

The original review examined Digga at `683b185`, using Setcast `c18eae8` as the readability
reference. Its full findings remain available with `git show babfbce:docs/CODE_QUALITY_AUDIT.md`.
The review covered CLI commands, HTTP routes, jobs, importers, database/query code, shared logic,
client transport and sandbox state, triage controllers, and page scripts. The existing runtime
boundaries remain in place.

## Defects resolved

| Defect                                             | Resolution                                                                                                                     | Commit    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Failed settings saves changed active configuration | Persist configuration before publishing it. A failed save preserves the old settings and server sandbox refusal.               | `94d7d05` |
| Duplicate dump videos shifted track matches        | Deduplicate and normalize videos before matching. Dump conversion and API enrichment share the same pure preparation function. | `75ec19b` |
| Integer parsing accepted numeric prefixes          | Require complete, safe integers and field-specific ranges for HTTP IDs and CLI options.                                        | `b447413` |

Regression tests cover failed configuration writes, duplicate and invalid video URLs, conversion
to the same video rows through both input paths, malformed route IDs, and invalid CLI numbers.
They use synthetic data, temporary directories and in-memory databases.

## Refactoring completed

### CLI workflows and typed jobs

Commands parse typed options, acquire their dependencies, run an operation, report its result,
and close the database in `finally`. The command entry point only dispatches. Import selection,
reporting, and runtime setup have named functions. Enrichment also removes its signal listener
when it finishes.

`runAndWait` preserves each job's result type. Worker messages form a discriminated union, and
persisted job progress is decoded according to the job type at the database boundary. The client
uses typed progress for job presentation and Maybe-list completion.

Commits: `c168ed1`, `9cbf344`.

### Routes and domain operations

`createApp` registers route groups and error/static handling. Handlers validate requests, enforce
sandbox restrictions, invoke domain operations, and return responses. Release-detail assembly,
Twelves selection, dump-path resolution, import dispatch, and Discogs pagination have focused
functions outside route registration.

Discogs endpoint definitions are separate from transport serialization, rate-limit accounting,
retry delays, and response handling. The sandbox owns its in-memory state explicitly and exposes
typed API operations. It retains the existing seed precedence and read overlays.

Commits: `bd35f4e`, `fec75a1`, `3714b2b`.

### Page calculations and workflows

Twelves filtering, shelf counts, and sorting are pure functions. `TwelvesShelf` owns selection,
serialized changes, wantlist synchronization, undo, loading, and list checks. The component owns
bindings, focus, scrolling, and keyboard events. Writes use the API captured for the shelf's mode.
The page recreates its shelf when Settings selects a different mode, including the initial load.
Failed undo saves retain their history entry; successful writes remain visible if a reload fails.

Settings has separate state for filter previews, job polling, and Discogs account/list requests.
Previews discard stale responses and invalid drafts cancel pending previews. Polling waits for
each request to finish and stops on destruction. Lists reload for a changed saved username.
Job presentation uses the typed shared helper.

Commits: `cf20427`, `506bf88`.

### Algorithms and naming

Video matching uses explicit track/video indices and named scoring operations. The streaming
parser separates initialization and field assignment by release, artist, track, and video. Dump
loading separates reporting and batch writes while keeping the streaming loop and cleanup clear.

The Maybe-list import now implements the orchestration example in [AGENTS.md](../AGENTS.md).
History import separates profile discovery, copied-file ownership, URL aggregation, and seed
application. Enrichment separates request handling from persistence and saves currency with the
snapshot and videos in one transaction.

Long-lived locals and multi-step callback parameters use domain names. Loop indices and caught
errors are named explicitly. Nested ternaries were removed from scripts and Svelte markup;
keyboard actions have readable dispatch tables and named handlers.

Commits: `a9dc121`, `51eb27d`, `c154d9b`, `f717800`, `651cfb7`.

### Async recovery and resource ownership

Triage verdict and undo methods delegate persistence and recovery to named operations. Older
queue starts and completions from another API mode cannot replace current state. A failed undo
restores retryable history and does not remove a successfully pushed want. Detail requests from
an old mode no longer prevent the new mode from loading the same release.

Track marks retain the last saved value independently of queued optimistic changes. A failed
write restores that value without reverting another track's newer mark. Session destruction
clears flash and grace timers and invalidates pending completions.

Player release changes explicitly adopt a usable preload. Tests cover reuse without reloading,
suspended playback, late video errors, parked-deck events, and callbacks after destruction.

Server shutdown waits for async jobs and worker exit before closing SQLite. Workers remain owned
until exit, even after reporting completion. An unexpected nonzero worker exit is a failure;
explicit cancellation remains a separate outcome.

Commits: `c6152d1`, `ffdce41`, `27136b1`, `f225dc6`, `1d5422d`.
Queued API-mode isolation has additional coverage in both directions in `tests/twelves.test.ts`.

## Enforcement

[AGENTS.md](../AGENTS.md#code-quality-binding) defines the naming, workflow, state, and review
standards with examples implemented in the repository. Short descriptive commit titles are also
a recorded convention.

[vite.config.ts](../vite.config.ts) now enforces the Setcast-style limits: 50 nonblank/noncomment
lines per function, complexity 15, nesting depth 3, at most four parameters and three nested
callbacks, no nested ternaries, and no unnecessary `else` after a returning branch. Explicit
`any` is prohibited. Tests are exempt only from function length and complexity limits.
There are no production suppressions of these readability rules.

These checks cover TypeScript and Svelte scripts. Templates and meaningful naming still require
review; passing lint alone does not establish readability.

## Verification

- `npm run verify`: passes with 167 tests in 29 files, formatting, lint, TypeScript, portability,
  and Svelte checks. Svelte reports zero errors and warnings.
- `npm run build`: passes.
- `git diff --check`: passes.
- New behavioral tests cover all three defects, CLI execution and cleanup, typed job progress,
  failed and overlapping triage operations, track-mark recovery, Twelves write ordering and
  sandbox isolation, Settings request ownership, player lifecycle, and job shutdown.

No live Discogs writes or live YouTube playback were exercised. The tests use mocked transports
and decks for those integrations. The owner's configuration and sandbox setting were not changed.
