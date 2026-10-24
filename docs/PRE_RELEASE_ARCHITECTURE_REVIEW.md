# Pre release architecture and data model review

This document records a review of Digga's architecture and persistent data before its first public
release. It is context for a separate session to investigate and decide changes. It is not an
implementation plan or an approved replacement schema.

This is a historical review of commit `87d4eb1`, not a list of current defects. The owner's
decisions are recorded at the end; later implementation decisions are in [DECISIONS.md](DECISIONS.md).

The application structure is suitable for the product. The main concerns are whether saved user
intent survives catalogue changes, restore, concurrent use, and interrupted operations. Schema
changes remain possible after release; information already discarded or incorrectly combined is
much harder to recover.

## Scope and evidence

The review examined commit `87d4eb1` on 2026-10-03. It was read-only: no source changes, real-library
access, or external-service writes. Additional probes used in-memory databases and direct Hono
requests. The probes were executed during the review but were not saved as repository tests.

This document uses three evidence levels:

- **Reproduced:** an executed probe demonstrated the stated result. The scope and limitations of
  that probe are recorded with the finding.
- **Code observation:** the implementation has the described behavior or structure, but the
  broader failure scenario was not executed.
- **Hypothesis:** a possible consequence that needs verification before fixing. It must not be
  treated as a demonstrated defect.

The document uses only evidence collected in the two reviews described here. No additional
investigation was performed while writing it. References identify source files and functions at the
reviewed commit; later work may have changed them.

### Second review

A second, independent review examined the same commit on the same day without access to the first
review's findings. Its results were merged into this document afterwards. It was also read-only. It
read the migrations, the database modules, the backup and restore code, the server wiring and the
routes. It executed one probe, `heardKeyFor()` through Node, and it listed the file names and sizes
in the owner's library folder without opening the database. Everything else from it is a code
observation or a hypothesis and is labelled so.

Text marked **Second review** records what that review adds. Where both reviews reached the same
conclusion independently, the finding says so; that agreement is a reason to give the finding more
weight. Where the two reviews lean in different directions, the finding has a **Disagreement between
the reviews** paragraph. The implementing session should analyze those and ask the owner to decide
instead of picking a side.

## Architecture to retain

The server factory, shared domain logic, isolated native database dependency, worker-based dump
loading, and single client transport are appropriate boundaries. They support the planned Electron
wrapper without requiring a backend rewrite. Keeping the queue as a query avoids another persistent
representation that would need reconciliation.

Existing protections include transactional migrations, a database snapshot before migration,
atomic backup-file replacement, decision logs with stable event IDs, listening snapshots, and
separate storage for user-attached videos. These are useful foundations. The findings below identify
where their guarantees are incomplete.

Nothing found establishes a need to replace SQLite, introduce an ORM or microservices, normalize
every catalogue JSON array, or adopt a generic event-sourcing framework.

## Findings for release review

### F01 Mutable master membership can change or hide active decisions

**Evidence: reproduced.**

`verdicts.key` is both the primary key of an active decision and the current grouping derived from
Discogs: `m:{master_id}` or `r:{release_id}`. Dump writes update release keys and then move verdicts
to those keys. When a destination already has a verdict, the move merges the two.

The review simulated two releases exchanging master assignments. After the catalogue changes, the
input to `moveVerdictsToReleaseKeys()` was equivalent to:

| Release | Saved verdict key | New release key | Saved status |
| ------- | ----------------- | --------------- | ------------ |
| 1       | `m:1`             | `m:2`           | `candidate`  |
| 2       | `m:2`             | `m:1`           | `rejected`   |

Calling `moveVerdictsToReleaseKeys(db, [1, 2])` produced only:

```text
[{ key: 'm:2', release_id: 1, status: 'candidate' }]
```

Both decisions should have distinct destinations, but sequential movement merges them before the
second move can preserve its original decision. The probe exercised the reconciliation helper with
the catalogue already changed, not an entire streamed dump. Decision logs may retain the displaced
history; the demonstrated loss is from active verdict state.

A separate direct HTTP probe created release 2 with current key `m:99`, then posted a verdict with
`releaseId: 2` and obsolete key `r:2`. The endpoint returned `200` and stored `r:2`. It does not
validate the relationship between the supplied key and release. Since the queue checks current
release keys, this verdict does not exclude the current `m:99` group.

**Hypothesis to verify:** a tab holding a release from before a dump update can trigger the stale-key
case through normal use. The direct endpoint behavior is demonstrated; the UI timing was not tested.

**Second review (code observation):** it noticed the same missing validation independently.
`VerdictInputSchema` checks `key` against `TRIAGE_KEY_PATTERN` and `releaseId` as a positive integer,
and nothing relates the two before `upsertVerdict()` stores them.

**Problem to resolve:** a catalogue correction must not silently combine unrelated user decisions
or make a saved decision ineffective. Define which identity owns a decision and how master merges,
splits, reassignment, and master-only history evidence affect its current interpretation.

References: [verdict-keys.ts](../src/server/db/verdict-keys.ts),
`moveVerdictsToReleaseKeys()` and `moveVerdict()`;
[releases.ts](../src/server/db/releases.ts), `writeReleases()`;
[verdicts route](../src/server/routes/verdicts.ts), `saveVerdict()`;
[queue query](../src/server/queue/query.ts), `undecidedClause()`.

### F02 Heard keys collapse distinct tunes

**Evidence: reproduced.**

`heardKeyFor()` uses normalized artist display text and title. Normalization removes everything
outside ASCII letters and digits after diacritic handling. Artist display also removes Discogs
disambiguation suffixes.

The following calls returned these values:

| Artist       | Title      | Heard key             |
| ------------ | ---------- | --------------------- |
| `東京`       | `青空`     | `" - "`               |
| `大阪`       | `夜`       | `" - "`               |
| `Signal (2)` | `Untitled` | `"signal - untitled"` |
| `Signal (3)` | `Untitled` | `"signal - untitled"` |

These are identity collisions, not just imperfect search results. Heard keys are used for heard
status, skipping already-heard tunes, pooling videos across pressings, and reconciling track marks.
The probe demonstrated the collisions; it did not separately exercise every downstream behavior.

**Second review (reproduced): two independent reviews arrived at this finding.** Its own probe of
`heardKeyFor()` returned:

| Artist           | Title          | Heard key                     |
| ---------------- | -------------- | ----------------------------- |
| `Кино`           | `Группа крови` | `" - "`                       |
| `坂本龍一`       | `千のナイフ`   | `" - "`                       |
| `Unknown Artist` | `Untitled`     | `"unknown artist - untitled"` |

The probes show three separate causes, which may need separate answers:

- **Script.** `normalizeText()` ends with `.replace(/[^a-z0-9]+/g, " ")`, so any artist and title
  written entirely in a non-Latin script produce the same key, across the whole library.
- **Disambiguation.** Distinct Discogs artists with the same name share a key (the `Signal` rows).
- **Generic names.** The key has no release component, so every `Unknown Artist` / `Untitled` track
  is one tune. White labels credited this way are common in the owner's own styles, so this cause
  does not depend on other users or other scripts. The same applies to one artist's several
  `Untitled` tracks on different releases.

**Hypothesis to verify:** with `player.skipHeard` on, hearing one such track makes the player skip
the others. The second review inferred this from the collisions and did not run the player.

The key is stored in `tracks`, `heard_tracks`, `track_verdicts`, `listen_log` and in every decisions
backup, and nothing records which normalization rules produced a stored key. `tracks` is rewritten
by each dump load, so its keys follow the current rules, while the personal tables keep the old
ones. A change of rules after release therefore needs a way to tell old keys from new ones and to
rebuild them.

**Problem to resolve:** decide how durable tune references differ from heuristic cross-release
matching. A matching-policy change must not invalidate historical evidence, and uncertain matches
must not establish that an unrelated tune was heard. Preserve enough original identity information
to revisit matching later. Existing listening and mark snapshots help, but not all older rows have
that context.

References: [normalize.ts](../src/shared/normalize.ts), `normalizeText()`, `heardKeyFor()` and
`artistDisplay()`; [track identity](../src/shared/track-identity.ts);
[release details](../src/server/queue/detail.ts); [videos](../src/shared/videos.ts).

### F03 Track marks are identified by a mutable position

**Evidence: code observation; existing tests exercise the conflict protection.**

`track_verdicts` has primary key `(release_id, position)`. The saved tune snapshot and
`assertTrackIdentity()` protect an old mark when a refreshed tracklist assigns a different tune to
the same position. `trackForMark()` can follow a moved tune when its heard key has one unambiguous
match.

Those protections do not give the old and replacement tunes separate mark identities. The
conflicting new mark is refused with a message asking the user to review the old mark. The current
key cannot retain both as active marks at the same release position.

**Second review (code observation):** `TrackVerdictInputSchema` and `BackupTrackMarkSchema` both
require a non-empty `position`, while `tracks.position` defaults to `''` and the schema allows the
same position twice in one release. `trackTune()` and migration 7 resolve a position to the first
track by `seq`. **Hypothesis to verify:** real dump data contains playable tracks with an empty or
repeated position; neither review checked a dump for them.

**Problem to resolve:** define the lifecycle of a mark when positions are renamed, reused, empty,
or duplicated. Decide whether position is a locator or identity, and what reviewing a conflict
must preserve. No replacement schema was validated in this review.

References: [initial schema](../src/server/db/migrations/0001_init.sql), `track_verdicts`;
[verdicts.ts](../src/server/db/verdicts.ts), `setTrackVerdict()` and `writeTrackMark()`;
[track-identity.ts](../src/shared/track-identity.ts);
[track identity tests](../tests/track-identity.test.ts).

### F04 Restore does not consistently preserve newer local work

**Evidence: reproduced.**

Three independent cases were demonstrated through `readBackedUpData()` and
`restoreBackedUpData()`:

1. **A newer track-note edit is overwritten.** A `keep` mark with an old `decided_at` and note
   `old note` was backed up. Its note was changed to `new note` while keeping the mark. Restoring
   the backup changed the note back to `old note`. `writeTrackMark()` deliberately preserves
   `decided_at` for note-only edits, while restore uses that date to detect newer work. The probe
   assigned the historical date directly in the in-memory fixture before taking its snapshot.
2. **A deleted verdict returns.** A `candidate` verdict was backed up, deleted, and then restored
   from that backup. The active verdict became `candidate` again. Restore checks current rows;
   it does not use the later deletion recorded in history to preserve absence.
3. **A merged master can lose its grail.** The source backup had an older `candidate` for `r:1`
   and a newer `rejected` verdict for `r:2`, both predating the backup. In the target library,
   both releases belonged to `m:1`. Restore left `m:1` as `rejected`. Backup rows were applied in
   order without the precedence used by dump reconciliation.

The first probe used a 2020 decision date and a 2021 backup cutoff, with the note edit and deletion
performed during the review. The merge probe likewise used decisions older than the backup, so
neither should have been protected as a post-backup edit.

**Second review (code observation):** the history that a merge-based restore would rely on is
incomplete for verdicts. `verdict_log` has no `dug_at` column: the triggers of migrations 8 and 11
do not store it, and the update trigger's `WHEN` clause does not list it, so a write that changes
only `dug_at` is not logged. `dug_at` reaches a backup only through the active `verdicts` section.
The log alone cannot reconstruct when a record was judged in Digga.

**Problem to resolve:** specify whether restore merges history and state or replaces a snapshot,
then make conflict handling consistent with that contract. Decision time, last modification time,
and deletion time have different meanings. Release-note null rows already preserve a cleared note;
equivalent semantics are not established for all personal entities. Decide whether the decision
logs must hold every column of the rows they describe.

References: [user-data.ts](../src/server/db/user-data.ts), `restoreVerdicts()` and
`restoreTrackMarks()`; [verdicts.ts](../src/server/db/verdicts.ts), `writeTrackMark()`;
[notes.ts](../src/server/db/notes.ts); [history restore](../src/server/db/history-backup.ts).

### F05 Catalogue cleanup and restore can discard personal attachments

**Evidence: reproduced for cleanup; code observation for restore.**

`forgetUnfinishedLoads()` preserves releases with a verdict on their current key. It does not
protect a release merely because the user attached a video to it.

The probe created an unfinished dump-load row, a release attributed to that load, and a
`user_videos` row for the release, with no verdict. Calling `forgetUnfinishedLoads()` returned one
deleted release. The attached-video count became zero because the foreign key cascades deletion.
This was a direct database-helper probe, not an end-to-end test of setup's "Change your picks".

Separately, `addAttachedVideos()` skips a backed-up attachment if the target library lacks its
release. It reports this as `withoutRelease`; it does not retain an unresolved attachment.

**Hypothesis to verify:** rebuilding a library with different universe settings can omit releases
needed by personal attachments. The skip behavior is visible in code, but that complete recovery
workflow was not executed.

**Second review (code observation): two independent reviews flagged the cascade.** It read
`user_videos.release_id ... REFERENCES releases (id) ON DELETE CASCADE` in migration 2 and treated it
as a future risk, because it did not find `forgetUnfinishedLoads()` and believed nothing deleted
releases yet. The first review's probe shows the loss is reachable today. The second review adds
one more path to plan for: `docs/ROADMAP.md` lists "releases a load no longer finds stay in the
library" as a known gap. Any later feature that prunes those releases deletes their attached videos
through the same cascade unless the reference is changed first.

**Problem to resolve:** define a personal reference's lifetime independently of whether full
catalogue data is currently loaded. Cleanup must account for every kind of personal data, not only
verdicts. A portable backup needs sufficient evidence to preserve and identify references that a
new dump or narrower universe does not supply.

References: [dump-loads.ts](../src/server/db/dump-loads.ts), `forgetUnfinishedLoads()`;
[setup route](../src/server/routes/setup.ts), `forgetFirstLoad()`;
[user video schema](../src/server/db/migrations/0002_no_audio.sql);
[user-data.ts](../src/server/db/user-data.ts), `addAttachedVideos()`.

### F06 Compatibility checks do not cover all persistent formats

**Evidence: reproduced for the migration runner; code observation for config and sessions.**

Setting an in-memory database's `meta.schema_version` to `999` and calling `applyMigrations()`
returned `[]` without error. The recorded version remained `999`. The runner skips migrations
below the recorded version without rejecting a library newer than the executable understands.

**Hypothesis to verify:** an older executable can then make incompatible writes to a newer
library. The missing rejection is demonstrated; no actual pair of released executable versions
was tested.

Other persistent formats also need a compatibility contract:

- Config has no explicit format version. Historical config is parsed through the current
  `ConfigSchema`, including when embedded in a backup.
- Sessions record a database schema version, but their JSON payload is parsed through current
  schemas without a separate payload-version dispatcher.
- `restoreSessions()` validates each session inside the same transaction as personal-data
  restoration. An unparseable session can fail the entire restore.

**Hypothesis to verify:** future config or session changes could make otherwise useful old backups
unrestorable. Current defaults accommodate several additions, so incompatibility must not be
assumed for every schema change.

**Second review (code observations): two independent reviews arrived at both parts of this
finding**, the missing rejection of a newer database and the strict parsing of historical config.
It adds these details:

- `DecisionsBackupSchema` declares `config: ConfigSchema.nullable().default(null)`, so a config
  that fails validation fails the parse of the whole file in `readDecisionsBackup()`, before any
  decision is read. This is a second path besides the session rows.
- The comment in `restoreSessions()` states the behavior as intended: "Parsing the JSON columns
  refuses a backup whose sessions this version cannot resume."
- `latestSession()` and `getSession()` parse the stored row with `sessionFromRow()` and do not
  catch a failure. **Hypothesis to verify:** after a config change that an old session's
  `config_json` no longer satisfies, `GET /api/sessions/latest` answers `500` when Triage opens.
- The schema has needed such a change once already: `queue.strategy` has a `preprocess` that maps
  the removed value `popular` to `label_sweep`. Without that shim, configs, sessions and backups
  holding `popular` would have stopped parsing.
- `ConfigSchema` objects drop unknown keys. **Hypothesis to verify:** an older executable that
  loads and saves a newer config silently removes the settings it does not know.
- The backup `version` is a union of the literals `1` and `2`. A file with a later version fails
  with a generic schema message that does not say a newer Digga wrote it.

**Problem to resolve:** state which versions can read, write, migrate, restore, or ignore each
persistent format. A database schema newer than the executable should be rejected before mutation.
Decide whether an unsupported session cursor should block recovery of decisions and notes.

References: [db.ts](../src/server/db/db.ts), `openDb()` and `applyMigrations()`;
[config.ts](../src/shared/config.ts); [backup schema](../src/shared/decisions-backup.ts);
[session schemas](../src/shared/digging-session.ts);
[session restore](../src/server/db/digging-sessions.ts).

### F07 Library ownership and concurrent writes are not fully defined

**Evidence: reproduced for stale-job recovery; code observations and hypotheses for other cases.**

`createServer()` calls `failStaleJobs()` before starting its listener. The probe created one server,
inserted a running `dump_load` job, and created a second server over the same injected in-memory
database. The job became `failed` although the first server had not stopped. The probe used two
server instances in one process, not two OS processes.

**Hypothesis to verify:** starting a second ordinary server can mark the first server's live jobs
as interrupted even if the second subsequently fails to bind its port. The initialization order
supports this scenario, but the full two-process sequence was not executed.

**Second review (code observation): two independent reviews arrived at this finding.** It found no
lock file, no single-instance check and no `busy_timeout` in `src` or `tools`, and it noted that
`failStaleJobs()` updates every `queued` or `running` row without identifying the process that owns
it. It adds that each server over the same library also starts its own `startDailyBackups()`, so two
servers write and prune the same backups folder.

CLI commands independently open the library through `withDatabase()`. No per-library ownership
protocol was found in the reviewed entry points. Job checks and SQLite transactions do not by
themselves establish which process owns startup recovery, migration, or configuration changes.

Within the browser, verdict writes and undo are serialized per session, while the server accepts
unconditional writes and deletes.

**Hypothesis to verify:** one tab's undo can remove or replace a newer decision from another tab
or an import. No two-tab reproduction was performed. Cross-process migration races and stale
configuration behavior likewise remain hypotheses.

**Problem to resolve:** define supported combinations of server, CLI, workers, and browser tabs.
Startup recovery must distinguish abandoned jobs from another owner's live work. Undo needs a
defined policy when the underlying decision changed after the original action.

References: [server.ts](../src/server/server.ts), `createServer()`;
[jobs database](../src/server/db/jobs.ts), `failStaleJobs()`;
[CLI runtime](../src/cli/runtime.ts), `withDatabase()`;
[job coordination](../src/server/jobs/start.ts);
[triage session](../src/client/triage/session.svelte.ts), `#saveVerdict()` and `#saveUndo()`.

### F08 The server does not enforce its documented local trust boundary

**Evidence: reproduced at the application boundary; network and browser exploitation untested.**

A direct Hono request to `/api/verdicts` with the following headers and a valid JSON string body
returned `200` and saved the verdict:

```text
Content-Type: text/plain
Origin: https://untrusted.example
Host: untrusted.example
```

The test used an injected in-memory database, live mode, persistence of config disabled, and a
fetch implementation that refused network access. It did not exercise browser private-network
restrictions, DNS rebinding, CORS behavior, or a real network listener.

`ConfigSchema` also accepted `server.host: "0.0.0.0"`. `HttpListener.start()` passes the hostname
to the listener without enforcing loopback. The probe checked config acceptance; it did not bind
an externally accessible socket.

**Second review (code observation): two independent reviews arrived at this finding.** A search of
`src/server` found no check of `Origin`, `Host`, `Sec-Fetch-*` or the request content type, and no
CORS handling. `parseJson()` reads the body as text and parses it whatever the content type is. It
adds an assessment of which routes matter most, based on standard browser rules and not on a test:

- **Hypothesis to verify:** a page on any website can send a `POST` with a `text/plain` body to
  `http://localhost:3456` without a preflight. The `POST` routes include `/api/verdicts`,
  `/api/track-verdicts`, `/api/listen-log`, `/api/backups`, the `/api/jobs/*` routes and
  `/api/discogs/wantlist/:id`. The last one writes to the user's Discogs account, so the effect is
  not limited to the local library. `/api/jobs/import/history` accepts a `path` in its body.
- **Hypothesis to verify:** the `PUT` and `DELETE` routes (settings, token, sessions, verdict
  delete, dump delete) are protected from such pages only because the browser's preflight fails.
- **Hypothesis to verify:** DNS rebinding makes the page same-origin with the server, which removes
  the preflight protection and also allows reading responses such as `/api/export/*` and
  `/api/settings`. A `Host` check is the usual defence; none exists.

**Problem to resolve:** enforce the advertised loopback restriction and define how the API
recognizes authorized local clients. Do not depend on a particular browser blocking unwanted
requests. Origin, Host, content type, request authentication or CSRF protection, and body-size
limits need an explicit policy that also accommodates development and the future Electron host.

Reference for the distinction between CORS and preventing simple cross-origin writes:
[OWASP CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Code references: [request.ts](../src/server/routes/request.ts), `parseJson()`;
[app.ts](../src/server/app.ts); [config.ts](../src/shared/config.ts), `server.host`;
[http.ts](../src/server/http.ts), `HttpListener.start()`.

### F09 A saved response has a limited crash durability guarantee

**Evidence: code observation and SQLite documentation; no power-loss test.**

`openDb()` sets `synchronous = NORMAL`. SQLite documents that a committed transaction in WAL mode
with this setting can roll back after power loss or an OS crash, while preserving database
consistency. This is distinct from an ordinary application crash.

**Problem to resolve:** decide what Digga promises when it reports a personal write as saved.
Catalogue loading and irreplaceable user decisions share the database. Daily backups and
checkpoints do not preserve every write since their last successful run.

`FULL` is a candidate setting to evaluate, not a measured performance recommendation from this
review. Any durability policy must account for all writing connections, including workers.

References: [db.ts](../src/server/db/db.ts), `openDb()`;
[SQLite synchronous documentation](https://sqlite.org/pragma.html#pragma_synchronous).

## Data model decisions to settle

### F10 Personal judgment and Discogs membership share one active verdict

**Evidence: code observation; product semantics require a decision.**

`collection`, `wantlist`, and personal judgments compete in the same ranked verdict. Collection
outranks a grail, while wantlist import can replace an accepted verdict's source and date. The
history preserves earlier decisions, and `dug_at` preserves some local progress, but the active
row no longer independently describes both personal judgment and external membership.

Related observations:

- Collection and wantlist importers upsert returned items. A completed import does not reconcile
  seed rows absent from the response.
- `seed_items` is keyed by `(kind, release_id)` without an account identifier.
- The configured username can change while the existing seed data remains in the library.
- Notes are stored both in `release_notes`, keyed by release, and on master-grouped verdicts, with
  synchronization through triggers and `saveReleaseNote()`.

**Hypotheses to verify:** external removals can leave stale membership; switching accounts can
mix membership evidence; note synchronization can couple notes belonging to different pressings.
These complete workflows were not reproduced in this review.

**Second review (code observation):** it saw the same structure and the same unreconciled imports:
`importWantlist()` only applies the items Discogs returns and removes nothing.

**Disagreement between the reviews; needs the owner's decision.** The first review lists this as a
decision to settle before release. The second review judged it acceptable to release as is, on the
argument that `seed_items` keeps the Discogs membership facts and `verdict_log` keeps the earlier
personal judgments, so a later migration could split the combined status. Two observations in this
document weaken that argument, and the second review did not weigh them at the time:

- `verdict_log` does not record `dug_at` (F04), and its rows before migration 8 are `existing`
  snapshots without earlier history.
- `seed_items` has no account identifier and is not reconciled against removals, so it is not a
  reliable record of current membership.

The implementing session should establish what a later split could and could not recover from the
data stored today, and present that to the owner. It should not assume either position.

**Problem to resolve:** decide whether personal interest, ownership, external wantlist membership,
and notes are independent facts. Specify what buying a grail or removing a Discogs want should
change locally. Even a one-account library needs an explicit account-change policy. Decide which
entity owns each note before changing synchronization behavior.

References: [data model](DATA_MODEL.md), verdict precedence;
[seed handling](../src/server/importers/seeds.ts), `applySeedItem()` and `recordSeedItem()`;
[collection import](../src/server/importers/collection.ts);
[wantlist import](../src/server/importers/wantlist.ts);
[notes.ts](../src/server/db/notes.ts);
[release note triggers](../src/server/db/migrations/0012_release_notes.sql).

### F11 External synchronization and submission identity depend on the tab

**Evidence: code observation; interruption scenarios are hypotheses.**

The client saves a verdict, then starts a separate wantlist request. Wantlist retries and their
timers live in the triage session. There is no durable server-side record of the pending action
created atomically with the verdict.

**Hypotheses to verify:** closing the tab after saving a verdict but before sending its wantlist
request leaves an unsent want; closing during retry waits abandons those retries. Twelves can
expose and retry unsynchronized wants, so these cases do not imply that the local verdict is lost.
No crash or tab-close reproduction was performed during this review.

For listens, `ListenLogInputSchema` has no submission event ID. Each inserted row receives a new
server-generated history event ID. Those IDs deduplicate overlapping backup histories, but do
not identify a repeated HTTP submission. `playbackId` groups a playback and can legitimately be
shared by multiple logged segments.

**Hypothesis to verify before adding retries:** resubmitting a listen whose first response was lost
can add its seconds twice. The review did not reproduce this scenario or establish that the current
client automatically retries listens.

**Problem to resolve:** decide which pending operations must survive closing the browser or
restarting the server, how undo supersedes them, and how a repeated request is recognized. A small
durable outbox is one possible implementation for Discogs writes; no implementation was evaluated.

References: [triage session](../src/client/triage/session.svelte.ts), `#saveVerdict()`,
`#pushWithRetries()` and wantlist serialization;
[Discogs routes](../src/server/routes/discogs.ts), `pushWantlist()`;
[API schemas](../src/shared/api.ts), `ListenLogInputSchema`;
[listen persistence](../src/server/db/verdicts.ts), `logListen()`;
[history event migration](../src/server/db/migrations/0011_backup_history.sql).

### F12 Portable backup consistency and growth need validation

**Evidence: code observation; concurrency and performance effects are hypotheses.**

`readBackedUpData()` reads history, sessions, verdicts, marks, heard tunes, attachments, and
no-audio records with separate statements and no enclosing read transaction. These reads are
synchronous on one thread, but other database connections can write concurrently.

**Hypothesis to verify:** a dump worker or CLI process can commit between sections, producing a
portable backup whose sections describe different database states. No concurrent backup probe was
performed. SQLite read transactions provide snapshot isolation, which is the relevant mechanism
to consider: [SQLite isolation documentation](https://sqlite.org/isolation.html).

Checkpoint generation also reads all personal history into memory and serializes it. Comparing
against the previous checkpoint synchronously reads, decompresses, parses, and formats previous
backup data. The checkpoint schedule repeats every fifteen minutes. Compression of the new file
is asynchronous, but much of the preparation and comparison is not.

**Hypothesis to verify:** long-lived libraries with large listen and decision histories can cause
visible server pauses or excessive memory use during checkpoints. No representative long-history
benchmark was run. Do not redesign storage or introduce retention that discards personal history
without measuring this first.

The backup scheduler logs failures. A useful follow-up is to check whether the user can reliably
discover that scheduled backups have stopped succeeding; the review did not validate that UI
workflow.

**Second review (code observations): two independent reviews identified the checkpoint cost.**
Neither measured it. It adds these observations about what makes the cost grow and about the file
format:

- Every decisions backup and every checkpoint is a full snapshot that includes all of `listen_log`,
  `verdict_log`, `track_mark_log` and `digging_sessions`. Up to 30 daily files and 48 checkpoints
  are kept, so the same history is stored up to 78 times.
- `listen_log` gets one or two rows per play. Nothing deletes rows from it or from the two decision
  logs, which is intended: they are evidence.
- `digging_sessions` is never pruned either; no `DELETE` on it exists. Each row stores a complete
  config in `config_json` and a state with up to 50,000 `passedIds`.
- `readDecisionsBackup()` gunzips the file and calls `JSON.parse` on it as one string, and
  `formatDecisionsBackup()` builds one string. The format has one entry per line but is one JSON
  document, so it cannot be read or written as a stream as it stands.
- The work described above runs on the server thread, which rule 6 in `AGENTS.md` ("heavy work
  never blocks the server thread") is meant to prevent.
- The sections use two naming styles: `verdicts`, `trackMarks`, `heardTunes`, `attachedVideos` and
  `noAudioVideos` have camelCase fields, while `listenLog`, `verdictLog`, `trackMarkLog`,
  `releaseNotes` and `sessions` hold database rows with snake_case columns.

**Disagreement between the reviews; needs the owner's decision.** The first review says not to
redesign storage or introduce retention before measuring. The second review recommended settling
the backup file layout before the first release even without a benchmark, because files written by
released versions must stay restorable, so the layout is harder to change afterwards than the
schema. It also recommended retention for `digging_sessions`. The two positions agree that
decisions, marks and listening evidence must not be discarded. They differ on two points:

- whether the file layout should change before release without a measurement, and
- whether session rows are personal history that the first review's caution covers, or resumable
  cursors that may be pruned.

A measurement on a library with a long synthetic history would inform the first point. The second
is a product question.

References: [user-data.ts](../src/server/db/user-data.ts), `readBackedUpData()`;
[decisions-backup.ts](../src/server/decisions-backup.ts), `checkpointDecisions()`,
`checkpointUnchanged()` and `formatDecisionsBackup()`;
[daily-backups.ts](../src/server/daily-backups.ts).

### F13 Stored timestamps do not share one format

**Evidence: code observation, second review only. The effect on real data is a hypothesis.**

Timestamps are stored as text. Those Digga creates come from `nowIso()` or from
`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` in the triggers, so they are UTC with a `Z` suffix and sort
correctly as strings. Seed imports are the exception: `applySeedItem()` writes
`decidedAt: item.dateAdded ?? nowIso()`, and the collection and wantlist importers pass Discogs'
`date_added` through unchanged. The test fixtures contain both `2020-01-02T00:00:00-08:00` and the
bare date `2020-01-02`. `seed_items.date_added` stores the same text.

Code that compares these values in JavaScript uses `Date.parse()` and is unaffected by the offset
(`preferredVerdict()`, `restoreVerdicts()`). SQL compares them as strings: `listVerdicts()` orders
by `decided_at DESC`, `readVerdicts()` orders the backup by `decided_at`, and `verdicts_decided_at`
indexes the column.

**Hypotheses to verify:**

- The live Discogs API returns `date_added` with a non-UTC offset. The second review saw this only
  in fixtures.
- Twelves or another reader shows seed verdicts and Digga verdicts in a slightly wrong order
  because of the mixed formats. No ordering was checked.
- `VerdictInputSchema` accepts `decidedAt` with any offset (`z.iso.datetime({ offset: true })`), so
  a client could also store a non-UTC value. The current client was not checked for this.

**Problem to resolve:** decide whether every stored timestamp has one format. If it does,
normalizing at the write boundary is simple before release; afterwards it also needs a migration of
the stored rows and a rule for values in existing backups.

References: [seed handling](../src/server/importers/seeds.ts), `applySeedItem()`;
[wantlist import](../src/server/importers/wantlist.ts);
[verdicts.ts](../src/server/db/verdicts.ts), `listVerdicts()`;
[user-data.ts](../src/server/db/user-data.ts), `readVerdicts()`;
[API schemas](../src/shared/api.ts), `VerdictInputSchema`.

### F14 Hidden labels are stored by name

**Evidence: code observation, second review only.**

`filters.excludeLabels` holds label names, compared with `releases.label_name`, the name of a
release's first label. `labelClause()` matches a name case-insensitively and also matches
`Name (%`, to cover Discogs' bracketed variants such as `Name (2)` and
`Not On Label (Artist Self-released)`. Label scopes in the same query module use the Discogs label
id (`ON_LABEL`), and `labels_json` stores the id of every label on a release.

**Hypotheses to verify:**

- A label renamed on Discogs returns to the queue after the next dump load, because the saved name
  no longer matches.
- The `Name (%` rule hides labels the user did not choose: hiding `Signal` also hides `Signal (2)`,
  a different label. This follows from the SQL but was not executed.

The setting lives in `digga.config.json`, in every session's `config_json` and in every backup's
`config`, so its shape is one of the persistent formats F06 discusses.

**Problem to resolve:** decide whether a hidden label is identified by its Discogs id or by its
name, and whether hiding applies to the first label only. The answer affects a stored format, which
is why it belongs before the release.

References: [config.ts](../src/shared/config.ts), `excludeLabels` and `withLabelExcluded()`;
[queue query](../src/server/queue/query.ts), `labelClause()` and `ON_LABEL`.

### F15 Restoring a database copy is a manual file operation

**Evidence: code observation, second review only. The failure is a hypothesis.**

`digga restore` restores a decisions backup into an existing library. For the daily
`digga-YYYY-MM-DD.sqlite` copies and the `before-migration-<version>.sqlite` copies,
`docs/ARCHITECTURE.md` gives the procedure as "copying a backup over `digga.sqlite` while the server
is stopped". No command performs it. The library runs in WAL mode, and the owner's library folder
contained `digga.sqlite-wal` and `digga.sqlite-shm` beside the database when the second review
listed it.

**Hypothesis to verify:** a user who copies a backup over `digga.sqlite` and leaves the old `-wal`
and `-shm` files in place gets a damaged database or loses the restored state. SQLite's handling of
a WAL file that does not belong to its database was not tested or looked up.

The pre-migration copy is the recovery path for a failed or unwanted schema upgrade, so this
procedure matters most right after a release that ships a migration.

**Problem to resolve:** decide whether restoring a database copy is a supported operation, and if
so, how it is done safely and how the documentation describes it.

References: [db.ts](../src/server/db/db.ts), `backupBeforeMigration()`;
[backup.ts](../src/server/db/backup.ts); [architecture](ARCHITECTURE.md), "Backups and exports";
[CLI commands](../src/cli/commands.ts), the `restore` command.

## Release housekeeping

These came from the second review. They are not architecture findings, and they are cheap to check.

- **License.** The repository has no `LICENSE` file and `package.json` has no `license` field, while
  `AGENTS.md` describes the project as open source. Which license to use is the owner's decision.
- **Backup retention in the docs.** `src/server/db/backup.ts` keeps seven database copies
  (`BACKUPS_KEPT = 7`) and `DATA_MODEL.md` says seven. `ARCHITECTURE.md` says "keeps the newest two",
  and `ROADMAP.md` says "five kept". `ARCHITECTURE.md` also says the backup check runs every hour,
  while `daily-backups.ts` uses fifteen minutes.

## Verification already performed

The second review ran no tests. Its one executed probe is recorded under F02.

The original review ran:

```sh
npx vp test tests/backup.test.ts tests/decisions-backup.test.ts \
  tests/verdict-keys.test.ts tests/track-identity.test.ts \
  tests/listening-context.test.ts tests/decision-log.test.ts \
  tests/importers.test.ts tests/server.test.ts tests/digging-sessions.test.ts
```

The first run passed 58 of 59 tests. The localhost listener test failed because the sandbox refused
the bind with `EPERM`. Rerunning `tests/server.test.ts` with permission to bind a temporary port
passed all 22 tests in that file. Across the runs, all 59 distinct targeted tests passed.

The additional in-memory probes demonstrated failures not covered by those passing tests. No
full `verify` run, browser exploit test, power-loss test, large-history benchmark, or two-process
concurrency test was performed. The real library was not used.

## Follow-up scope

Two independent reviews reached the same conclusion on F02, F05, F06, F07, F08 and the checkpoint
cost in F12, and both noticed the unvalidated verdict key in F01. F10 and F12 each contain a
disagreement that needs the owner's decision before work starts. F13, F14 and F15 come from the
second review alone.

Recheck findings against the current branch before changing behavior, especially if another review
or implementation session has modified the same code. Convert reproduced cases into focused
regression tests when their fixes are undertaken. Verify each hypothesis before treating it as a
defect, and settle product semantics before selecting a new schema.

The highest-value release work is preserving the meaning and recoverability of personal data.
Broad frontend refactoring, database replacement, full multi-account support, cloud synchronization,
and additional media providers can wait. Preserve enough identity, provenance, and format-version
information now that those later choices remain possible.

## Owner's decisions (2026-10-03)

The implementing session analyzed the findings against `87d4eb1` and the owner settled these.
General rule from the owner: keep the code clean and avoid overengineering. Reliable means no
crashes and expected behaviour in normal use, not guarantees against power loss or disk failure.

- **F01:** a record decision stays keyed by record (`m:`/`r:`) and remembers its release. Key
  moves become one set-based pass resolved with the existing precedence; the merged-away decision
  stays in the log. The server derives the key from `releaseId`; clients undo by the returned key.
  Master-only history hits stay on their master key.
- **F02:** Unicode-aware normalization; keys from the canonical Discogs artist name with its `(n)`
  suffix instead of the ANV. A tune with an unknown artist or a generic title is identified by its
  record (master, or release without one) and position. `heard_tracks` is rebuilt from
  `listen_log`; the key version is stored.
- **F03:** position is a locator; a mark is identified by release and tune; empty positions allowed.
- **F04:** restore merges: each item keeps whichever side changed last, and a deletion after the
  backup counts as a change. Logs store every column (`dug_at` included); rows get a last-modified
  time separate from the decision time. Point-in-time rollback uses a database copy (F15).
- **F05:** no cascade from releases to `user_videos`; attachments survive without a loaded release;
  "Change your picks" does not delete releases that have personal data.
- **F06:** refuse a database newer than the executable before writing anything; a clear error for
  a backup from a newer Digga; a backup's config is validated only for `--config`; unparseable
  sessions are skipped and reported, also by `latestSession()`. No config format version: shape
  changes use a `preprocess` shim, as `popular` did.
- **F07:** one process owns a library through a lock file. `serve` and writing commands take it;
  read-only commands (stats, backup, export) run alongside. Startup recovery and scheduled backups
  run only in the owner. Several tabs may write; undo and Twelves changes carry the state they
  expect and are refused with a message when the decision changed meanwhile.
- **F08:** loopback only, enforced; `Host` allowlist; `Origin`/`Sec-Fetch-Site` check on writes;
  JSON content type for bodies; a body-size limit. No per-launch token.
- **F09:** keep `synchronous = NORMAL`; one sentence in `DATA_MODEL.md`.
- **F10:** split Discogs membership (collection, wantlist, Maybe list) from judgments made in
  Digga. Verdicts hold judgments (and history `seen`); membership has its own table, reconciled on
  each import. A release that leaves the wantlist or collection outside Digga stays out of the
  queue and leaves the Want, Grail and Owned shelves; Twelves stops offering to push it again.
  One account per library: a different username (or a token for another user) is refused while
  another account's membership is stored, until the user forgets that data explicitly. Notes
  belong to the release only. Twelves shelves become filters: Want and Grail hold judgments,
  Discogs wantlist and Owned hold membership, owning ends the hunt, Everything lists each record
  once.
- **F11:** keep the tab-owned wantlist retries. No listen event id: the client does not retry
  listens.
- **F12:** backup format v3 restructures too: one record per line, one naming style, a cheap
  unchanged-check, serialization off the server thread if a benchmark shows pauses; v1 and v2
  stay restorable. All sections are read in one read transaction. Sessions are cursors: keep the
  newest 20 and any touched in the last 90 days. Settings shows failed scheduled backups.
- **F13:** every stored Digga timestamp is UTC with `Z`, normalized at the write boundary and
  migrated; `seed_items.date_added` stays raw.
- **F14:** hidden labels are stored by Discogs id (with the name), matching the first label; keep
  a name rule only for the Not On Label family if its variants have separate ids.
- **F15:** `digga restore` also accepts a `.sqlite` copy; it refuses while a server holds the
  library, keeps a copy of the current database and removes stale `-wal`/`-shm` files.
- **Housekeeping:** MIT license; back to two daily database copies (decision 103), and the docs
  fixed to match (two copies, fifteen-minute checks).
- The session may analyze a copy of the owner's library and read the cached dump; the original
  stays untouched and the copy is deleted afterwards.
