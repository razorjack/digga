# Code quality audit

Reviewed on 2026-09-28 at Digga commit `683b185`, against the readability changes in Setcast
commit `c18eae8`. This review covers the CLI, server routes, jobs, importers, database/query code,
shared logic, client API and sandbox, triage controllers, and page scripts. Tests were inspected
for relevant coverage and the full verification suite was run. Live Discogs and YouTube behavior
was not exercised.

Digga has explicit runtime boundaries and useful pure modules. Readability within those boundaries
is uneven: workflows mix abstraction levels, names often lose domain meaning, and some pages own
several independent behaviors. The highest-value work is to simplify those functions and preserve
their contracts. The existing architecture does not need replacing.

This change updates documentation only. The defects and refactorings below remain open.

## Confirmed defects

### High: a failed settings save changes the active configuration

In [server.ts](../src/server/server.ts#L89), `setConfig` assigns `config = next` before calling
`saveConfig`. If writing or renaming the file fails, the API returns `500` but the server has
already adopted the new settings. The client treats the save as failed, so client and server can
disagree about filters, account settings or sandbox mode.

Confirmed with an in-memory database and a temporary configuration path occupied by a directory:
a request changing `sandbox` from `true` to `false` returned `500`, while
`server.getConfig().sandbox` was already `false`. No owner configuration was used.

Persist the validated settings before publishing them in memory. Add a regression case in
`tests/server.test.ts` asserting that a failed save preserves both `GET /api/settings` and the
server's sandbox refusal behavior. This is an ordering defect, even though the callback is short.

### High: duplicate dump videos assign later videos to the wrong tracks

In [convert.ts](../tools/dump/convert.ts#L30), `dumpReleaseToWrite` matches the original video
array, removes duplicate video IDs with a stateful `filter`, then indexes the original matches
using the shortened array's indices.

Confirmed with tracks `A1: Alpha Signal`, `B1: Beta Frequency` and videos in this order:

| Video ID      | Title          | Returned position after conversion |
| ------------- | -------------- | ---------------------------------- |
| `aaaaaaaaaaa` | Alpha Signal   | `A1`                               |
| `aaaaaaaaaaa` | Alpha Signal   | Removed as a duplicate             |
| `bbbbbbbbbbb` | Beta Frequency | `A1`, expected `B1`                |

The incorrect position is stored with the video and feeds playlist selection and heard-track
tracking. Deduplicate before matching, or carry each match with its video before filtering. Use
named conversion steps with an explicit loop for deduplication. Add the duplicate-between-tracks
case to `tests/dump-load.test.ts`.

The related path in [enrich.ts](../src/server/jobs/enrich.ts#L33) retains the original index while
skipping duplicates. The two implementations should share the same conversion policy after their
different input shapes have been normalized, with parity tests for duplicate and invalid URLs.

### Medium: integer parsing accepts malformed identifiers and options

[app.ts](../src/server/app.ts#L116) and [digga.ts](../src/cli/digga.ts#L80) use `parseInt` as
validation. It accepts a numeric prefix, so suffixes and fractional text are silently discarded.
The release and list read routes also implement their own weaker checks instead of using the
existing `parseId` helper.

Confirmed through the in-process HTTP app: `GET /api/releases/1001garbage` returned `200` with
release `1001`. By the same parsing rule, CLI input such as `--ahead 12garbage` becomes `12`.

Validate the complete input and require a safe integer, with the range appropriate to the field.
Use one positive-ID parser for routes and explicit nonnegative/range rules for CLI options. Test
suffixes, fractional text, zero where forbidden, negative values and unsafe integers. Keep this
validation separate from resource setup and job execution.

## Refactoring priorities

### 1. Make CLI commands read as workflows

[cmdImport](../src/cli/digga.ts#L126) occupies 72 physical lines and combines argument parsing,
validation, database ownership, Discogs setup, job selection and output. Each branch repeats
setup and cleanup, then casts an `unknown` result back to the type the runner already knew.
`cmdDumpLoad` and `cmdEnrich` have the same pattern. Names such as `rt`, `opts` and `r` make the
workflow harder to scan.

Split parsing into typed command options, dispatch to named import operations, and give reporting
its own functions. Keep database ownership in one `try/finally`; currently `db.close()` runs only
after successful jobs. The command should read as parse, open, execute, report, close. Avoid a
generic command framework for the small fixed command set.

The Setcast command refactor is directly applicable here. Extract real operations, retaining
visible error and cleanup paths instead of merely relocating the original body.

### 2. Separate route registration from domain operations

[createApp](../src/server/app.ts#L181) spans 348 physical lines. Many individual handlers are
short, so length alone is not the issue. The closure also contains Twelves selection SQL,
release-detail assembly, dump-path resolution, import dispatch, account checks and Discogs
pagination. A change to one workflow requires reading through unrelated endpoints.

Make `createApp` register coherent route groups and error/static handling. Put Twelves selection
in a named database/query operation; put job preparation and import dispatch in focused helpers.
Keep handlers visibly responsible for validation, sandbox refusal, invoking the operation and
returning the response. Shared dependencies can remain explicit, with ordinary functions or Hono
sub-apps. A dependency-injection framework would add work without clarifying this code.

### 3. Give page workflows their own code

[Twelves.svelte](../src/client/pages/Twelves.svelte#L119) has a 434-line script that owns shelf
counts, filtering, sorting, selection, notes, verdict persistence, wantlist synchronization, undo,
job polling and keyboard dispatch. `visible` nests a filter and a sort switch; `write` also chooses
the next selection, writes a verdict, synchronizes Discogs, updates undo and refreshes data.

Extract pure shelf/filter/sort operations and a focused Twelves state controller with named
actions. Keep DOM focus, scrolling and bindings in the component. The existing Triage
session/player split provides a local pattern. Preserve Twelves' write serialization and its
distinction between a failed verdict write and a failed Discogs update.

[Settings.svelte](../src/client/pages/Settings.svelte#L86) combines the form with preview requests,
job polling, account checks and list loading. Separate these by responsibility, and move
`jobProgress` into a typed presentation helper. The full files are 892 and 974 lines respectively,
but their markup and CSS are not by themselves a reason to split them.

### 4. Replace compressed names and expressions where they obscure the algorithm

[match-videos.ts](../src/shared/match-videos.ts#L23) uses `nt`, `tt`, `at`, `nv`, `pv` and pairs
shaped as `{ v, t, score }`. These names span scoring, sorting and assignment. Use `trackTitle`,
`trackTokens`, `artistTokens`, `videoIndex`, `trackIndex` and `pair`. Keep the greedy matching
algorithm together unless named scoring/assignment steps improve it; a rewrite is unnecessary.

[parse.ts](../tools/dump/parse.ts#L113) similarly makes the reader carry the meanings of `c`, `t`
and `grand` across a large switch. `release`, `text` and `grandparent` are clearer. The SAX parser
is a coherent state machine: improve its names and extract release initialization before deciding
whether splitting its dispatch helps. Its length is less urgent than mixed workflow code.

[Twelves' null comparison](../src/client/pages/Twelves.svelte#L119),
[list entry conversion](../src/server/importers/list.ts#L136) and
[Triage's track-mark dispatch](../src/client/pages/Triage.svelte#L125) use nested ternaries.
Spell out the cases or use a small, meaningful lookup. Tiny callbacks such as `ids.map(x =>
String(x))` are not the problem. Domain objects and multi-step callbacks need domain names.

### 5. Preserve types through the job API

[JobFn and JobRunner](../src/server/jobs/runner.ts#L19) erase results to `unknown`.
`runAndWait` should be generic over the result it receives. That would remove the repeated
`as Awaited<ReturnType<...>>` casts in the CLI and let the compiler check reporting code.

`WorkerMessage` permits messages such as `{ type: "error" }` without an error message because
all payload properties are optional. Model progress, completion and error messages as a
discriminated union. Likewise, [Job.progress](../src/shared/types.ts#L141) has no relationship to
the job type, forcing [Settings](../src/client/pages/Settings.svelte#L237) to inspect a loosely
cast dictionary and [Twelves](../src/client/pages/Twelves.svelte#L390) to assume `ImportProgress`.
Decode persisted data at the database boundary, then use typed progress inside the app.

These changes remove information loss introduced by our own interfaces. They do not require
duplicating schemas for every internal object or replacing every database row assertion.

### 6. Make asynchronous state transitions easier to review before extracting them

[TriageSession.judge](../src/client/triage/session.svelte.ts#L114) interleaves queue/history updates,
optimistic counters, a serialized write, recovery and a delayed wantlist push. `undo` reverses
several of those effects through another inline callback. Name the persistence and recovery
operations so the public methods reveal the sequence. Preserve the separate verdict and wantlist
write queues; a slow Discogs request must not block the next verdict.

[TriagePlayer.#openRelease](../src/client/player/triage-player.svelte.ts#L237) combines clearing
the previous release, building a playlist, adopting the preloaded deck, starting playback and
initializing listen tracking. A named operation for adopting a usable preload would make the
branch easier to read. Keep player state ownership explicit instead of distributing it among
loosely coupled helpers.

There are seven session tests, mostly covering wantlist ordering, rounds and mode changes. There
are no direct tests of `TriagePlayer` or the Twelves workflows. Before refactoring these paths,
add behavioral cases for rejected writes, overlapping queue restarts, mode changes with work in
flight, preload reuse and late player events. Use controlled promises and a fake deck/clock where
needed. The existing playlist tests validate selection rules, not player lifecycle behavior.

## Preserve these existing choices

- `src/shared` contains pure domain functions, and the SQL builders separate query construction
  from execution. `buildQueueSql` and `rateSummary` already compose named operations clearly.
- Paths, secrets, native database access and client transport have explicit owners. Keep those
  boundaries during extraction.
- `seedRank` centralizes verdict precedence, and the sandbox already reuses it. Extend that pattern
  when duplicate domain policy appears; do not force HTTP and in-memory persistence into one model.
- The client documents and tests why verdict writes are serialized and API implementations are
  pinned. These comments explain constraints and should survive readability work.
- Schemas, row mappings and API method tables can be long while remaining straightforward. For
  example, the forwarding methods in `createAppApi` make its contract explicit. Do not replace
  them with dynamic proxies just to reduce lines.

## Enforcement and order of work

The new [AGENTS.md](../AGENTS.md#code-quality-binding) makes the readability rules binding for
changed code and gives an import workflow and a low-level comparison as concrete examples.
The numeric limits are review guidance; this change does not enable new lint rules or claim that
the existing code meets them.

[vite.config.ts](../vite.config.ts#L23) currently has no explicit function-complexity or readability
rules. A diagnostic run of `vp lint src tools -D eslint/no-nested-ternary --format json` reports
four violations, in `App.svelte`, `Triage.svelte`, `Twelves.svelte` and `importers/list.ts`. This also
confirms that the installed linter checks Svelte scripts. Lint alone will not judge naming or
whether a function tells a coherent story.

Suggested sequence:

1. Fix the three confirmed defects with focused regression tests.
2. Preserve job result types and refactor the CLI into readable workflows.
3. Separate route groups and extract domain operations from handlers.
4. Extract page calculations and workflows, adding the missing state-transition tests first.
5. Improve names in matching, parsing and touched persistence code.
6. Enable the Setcast-style lint rules after fixing their violations: `no-nested-ternary`,
   `no-else-return`, `max-params` at 4, `max-depth` at 3, `max-nested-callbacks` at 3, `complexity`
   at 15 and `max-lines-per-function` at 50 excluding blank lines and comments. Limit justified
   exceptions to the specific function. Exclude test suite containers from length/complexity
   limits, while retaining the naming and readability standards for test code.

## Verification

- `npm run verify`: passed, including all 118 tests in 23 files, formatting/lint/type checks,
  portability checks, and Svelte checks with zero errors or warnings. The first attempt could not
  bind localhost ports under the execution sandbox; the permitted rerun passed.
- `npm run build`: passed.
- Focused probes confirmed duplicate-video index drift, settings mutation after a failed save,
  and numeric-prefix acceptance in the release endpoint. They used synthetic data, temporary
  files and an in-memory database, with no external requests.

These results establish the current baseline. They do not cover the defects and missing lifecycle
cases identified above, and no production refactoring was included in this documentation change.
