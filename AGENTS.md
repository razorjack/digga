# Digga

Digga is a local-first app for exhaustively digging Discogs vinyl by ear. **Digga is the app, your
twelves are what it finds.** _Digga_ is the tool and the triage flow; _Twelves_ is the view of
everything the user has accepted, wants, or owns.

The owner uses it for drum & bass (techstep, early neurofunk) released 1998–2002: listen to every
release in that set through the YouTube links Discogs attaches to releases, a few seconds per track,
keyboard-driven, to (1) identify a handful of tunes heard on rave radio around 2000–2002 and (2)
build a DJ wantlist. Other people will use it for other styles and years, so **nothing about DnB or
1998–2002 is hardcoded outside `digga.config.json`**. Year range and formats are query-time filters
that change without reloading data.

## Delivery shape

- **Now (v1):** a Node process bound to 127.0.0.1:3456 serving a Svelte app, opened in a browser at
  `http://localhost:3456` (YouTube refuses some embeds on IP-address origins).
- **Sandbox mode:** `sandbox` in `digga.config.json`, on by default and switched in Settings (the
  header's sandbox stamp links there). While it is on, the UI fakes the digging writes in memory
  (`src/client/sandbox.ts`): verdicts, track marks, listens, wantlist pushes and the Maybe list
  import. Settings and the other jobs are real. The server refuses those writes with `409` too.
  Never turn the owner's sandbox off (or edit their config) to test; use a throwaway data dir.
- **Library:** the database, backups, `digga.config.json` and the saved token live in the per-user
  app folder (`~/Library/Application Support/Digga` on macOS), dumps in the OS cache folder
  (`~/Library/Caches/Digga/dumps`). Every `digga` command opens that real library unless
  `DIGGA_DATA_DIR` points elsewhere, so experiments set it to a throwaway folder.
- **Later:** an Electron app. Its main process imports `createServer` from `src/server/server.ts`,
  starts it on a free localhost port, opens a `BrowserWindow` at it, and exposes the CLI jobs as
  menu items. That must be packaging work only, never a rewrite. See `docs/ELECTRON_PLAN.md`.

## Commands

```sh
npm install                      # Node >= 22.18 (runs .ts directly, no build step for the server)
vp dev                           # Vite dev server on :5173, proxies /api to :3456
npm run digga -- serve           # Hono server on 127.0.0.1:3456, open http://localhost:3456 (serves dist/ after vp build)
npm run digga -- serve --port 0  # pick a free port
vp build                         # build the client into dist/
vp check                         # format + lint + type check (oxfmt, oxlint, tsgolint)
vp test                          # vitest, tests/**/*.test.ts
vp run check:portability         # Electron-ready rules, see below
vp run check:svelte              # svelte-check for .svelte files
vp run verify                    # all four of the above, then vp run e2e:smoke (about 20 s)
```

`vp` is the Vite+ CLI. The global `vp` delegates to the project-local `vite-plus`; without it use
`npx vp <cmd>` or the `npm run` scripts. Every command above must be green before a commit.
`verify` runs the end-to-end smoke set, so it needs Playwright's Chromium (below).

### End-to-end tests

Playwright drives the built app in Chromium against fake Discogs and YouTube services
([docs/E2E_TESTING.md](docs/E2E_TESTING.md)). When writing or debugging E2E tests, read its
binding rules and follow the task router to the relevant documents. Load the implementation
plan only when continuing E2E project work, and history only when investigating earlier findings.
Install the browser once with `npx playwright install chromium`.

```sh
vp run e2e                       # vp build, then every scenario in tests/e2e/specs/
vp run e2e:smoke                 # vp build, then the P0 scenarios (part of vp run verify)
npx playwright test --config tests/e2e/playwright.config.ts --grep "@TRI-12\b"   # one scenario, after vp build
npx playwright test --config tests/e2e/playwright.config.ts --repeat-each=10     # a new or changed spec, before its commit
```

The tests start every Digga process through `spawnDigga()` with a throwaway library in a temp
folder; they never touch the real library, and they use only fake `e2e-token-*` tokens.

### Loading a real dump and seeding

```sh
# 1. The newest discogs_YYYYMMDD_releases.xml.gz from https://data.discogs.com/, into the dumps folder
npm run digga -- dump download                                                    # >10 GB, checksum verified
npm run digga -- dump update                                                      # download unless there, then load
npm run digga -- dump load ~/Library/Caches/Digga/dumps/discogs_20250901_releases.xml.gz   # ~10 GB gz, streams
npm run digga -- dump load path/to/discogs_20250901_releases.xml.gz --limit 500 --dry-run
gzip -dc path/to/discogs_20250901_releases.xml.gz | npm run digga -- dump load -  # from stdin
# 2. Seeds (needs discogs.username in digga.config.json, created on first run, and a Discogs token,
#    saved in Settings or set as DISCOGS_TOKEN in the environment or .env)
npm run digga -- import collection
npm run digga -- import wantlist
npm run digga -- import history --browser brave        # Brave on macOS; also chrome, firefox, --path
npm run digga -- import list                           # releases on your Discogs Maybe list (discogs.maybeListId)
npm run digga -- import seller <username>              # what a seller has for sale, for F in Triage
npm run digga -- stats
npm run digga -- backup                                # copy the database and write the decisions backup now
npm run digga -- restore decisions-2026-09-30.json.gz  # bring decisions back into a library rebuilt from a dump
npm run digga -- dump census path/to/discogs_YYYYMMDD_releases.xml.gz  # refresh the shipped style census, see docs/STYLE_CENSUS.md
```

## Layout

```
digga.config.example.json  the schema defaults a new digga.config.json starts with
.env.example           DIGGA_DATA_DIR, DIGGA_DUMPS_DIR, DIGGA_CONFIG_FILE, DISCOGS_TOKEN (copy to .env, gitignored)
docs/                  ARCHITECTURE DATA_MODEL DISCOGS_NOTES DESIGN_BRIEF KEYMAP ROADMAP DECISIONS ELECTRON_PLAN
                       FIRST_RUN (the setup's design) STYLE_CENSUS (what it is, how to refresh the shipped one)
                       E2E_TESTING (commands, rules and task routes), e2e/ (task-specific references and scenarios)
scripts/check-portability.ts
src/shared/            types, config schema, API contracts, pure logic (normalize, match-videos, discogs-urls,
                       triage-key, youtube, formats, playlist, rate, display, integer, videos), typed jobs,
                       the decisions backup format (decisions-backup), the style census format (style-census).
                       Imports nothing from Node.
src/server/            server.ts (createServer), http.ts (listener), app.ts (route registration), routes/,
                       context.ts, paths.ts, secrets.ts, logger.ts, stats.ts, static.ts, export.ts,
                       attach-video.ts, youtube.ts (oEmbed titles), enrich.ts (one release, for Triage),
                       dump-files.ts, decisions-backup.ts and daily-backups.ts (the daily backups),
                       setup.ts (what the first run needs), style-census.ts + style-census.json (shipped)
                       db/ (db.ts wrapper, migrations/*.sql, releases.ts, verdicts.ts, jobs.ts, backup.ts,
                       export.ts, no-audio.ts, sellers.ts, dump-loads.ts, user-data.ts, seed-tally.ts,
                       style-census.ts)
                       discogs/ (client, transport, types, lists, data-dumps), importers/ (collection, wantlist,
                       history, list, seller, seeds)
                       jobs/ (start, dump-download, dump-load, runner, worker, dump-load-worker, index),
                       queue/ (query, scopes, detail, twelves, coverage)
src/cli/               digga.ts (dispatch), args.ts + options.ts (parsing), commands.ts, runtime.ts, report.ts, help.ts
src/client/            Svelte 5 app: api.ts (the transport seam), sandbox.ts (fake writes), router.svelte.ts
                       (hash router) + routes.ts (the pages and their keys),
                       stores.svelte.ts, keymap.ts, load-status.svelte.ts (the running dump job), styles.css
                       (tokens), components/ (Key, Stamp, Flash, HelpOverlay, LoadIndicator), setup/ (the first run),
                       player/ (YouTube decks, status copy), triage/ (session + components), twelves/ (shelf + pure model),
                       settings/ (preview, jobs, Discogs state), pages/
tools/dump/            streaming loader (parse.ts, convert.ts, load.ts, growing.ts), worker-compatible; census.ts
tools/dev/             fake-services.ts: the fake Discogs API, oEmbed and data.discogs.com, which the E2E harness
                       imports and `node tools/dev/fake-services.ts <dump>` serves to rehearse the setup
tests/ fixtures/       vitest unit tests + fixtures/releases-sample.xml(.gz)
tests/e2e/             Playwright end-to-end suite (docs/E2E_TESTING.md): playwright.config.ts;
                       specs/*.e2e.ts (scenarios, tagged with their IDs and priority); pages/ (page objects:
                       triage, header, twelves, settings, setup, dialogs); fixtures/ (catalogue.ts, the one source of releases,
                       videos and accounts, the generated bulk records included, dump.ts, which writes them
                       as dumps with gzip checkpoints, and decisions.ts, decisions backups for `digga restore`);
                       support/ (test.ts fixtures, app.ts the host interface,
                       hosts/web.ts, spawn.ts, templates.ts, fake-youtube.ts, guard.ts and browser-guard.ts,
                       browser-log.ts, fault-routes.ts, live-regions.ts, global-setup.ts); the fake services are
                       tools/dev/fake-services.ts
data/                  gitignored, for DIGGA_DATA_DIR=./data; the library is in the app folder by default
```

## Conventions

- Strict TypeScript, no `any`. Node runs the `.ts` sources directly (type stripping), so use only
  erasable syntax (no enums, namespaces, parameter properties) and import with `.ts` extensions.
- Tests for all pure logic and for the SQL builders (`tests/`, fixture-driven). Run `vp test`.
- Schema changes only via a new numbered file in `src/server/db/migrations/`; never edit an applied one.
- DnB defaults live only in `digga.config.example.json` and the matching schema defaults in
  `src/shared/config.ts` (a test keeps them equal). `digga.config.json` is per-user and lives in
  the library folder: it holds the Discogs username and whatever `PUT /api/settings` writes. Never
  commit one.
- Comments explain constraints, not what the code says. No em dashes; en dash with spaces in prose.
- Formatting and lint are owned by `vp check --fix`.
- Prefer short, descriptive commit titles that explain the change without a commit body.
- Push only when the owner asks, and never after each commit. Every push runs the whole suite on
  GitHub Actions (about five minutes), which GitHub provides free for open-source projects, so
  commit locally and push finished work together. Burn-ins (`--repeat-each`) run locally, never
  in CI ([CI](docs/E2E_TESTING.md#ci)).

## Code quality (binding)

Code should be simple enough to read once and understand. High-level functions tell the reader
what happens, in order; lower-level functions implement one named responsibility. Formatting and
passing tests are necessary, but neither makes a difficult function acceptable. Apply these rules
to TypeScript, Svelte scripts and templates, and tests when writing or changing them.

### Names

- Prefer short, unambiguous names: `release`, `verdict`, `track`, `options`, `response`, `row`.
  Use the same domain terms as the types and UI. Do not shorten them to `r`, `v`, `t`, `opts`,
  `res` or `rt` in a function that the reader has to follow.
- One-letter names are acceptable only in tiny, obvious callbacks, such as
  `ids.map(x => String(x))`. Use domain names in callbacks with branching, several statements or
  nested callbacks. Name loop indices `index`, `videoIndex` or `trackIndex`; caught errors are
  `error`, keyboard events are `event`.
- Keep established terms such as `db`, `api`, `id`, `url` and SQL aliases. Use a qualifier when
  values compete: `releaseId` and `videoId`, `savedVerdict` and `nextVerdict`. Include units when
  they matter: `elapsedSeconds`, `delayMs`.
- Function names state the operation and its subject: `parseImportOptions`, `saveVerdict`,
  `matchVideos`. Avoid vague names such as `handleThing`, `processData`, `runStep` or `doWork`.
  Generic names such as `value` or `result` are fine for generic code; use a domain name when one
  exists. Do not hide an effect behind a name that sounds like a pure calculation.

### Function bodies

- Keep one level of abstraction per function. A command coordinates parsing, execution and
  reporting through named operations. A route validates the request, calls the operation and
  constructs the response. Neither implements SQL, matching rules or presentation details inline.
  Use blank lines to separate phases so the sequence is visible at a glance.
- Make the normal path readable from top to bottom. Use guard clauses for invalid input, missing
  values and completed work. Prefer ordinary `if` statements and named intermediate values over
  nested ternaries, conditional object spreads or expressions combining branching, formatting
  and I/O. A simple ternary or nullish default is fine when both outcomes are obvious.
- Keep callbacks to one expression or a few straightforward statements. Use a loop when building
  a collection needs branching or mutation. Do not put state changes inside `filter` predicates
  or rely on parallel arrays retaining the same indices through filtering and sorting.
- Extract by responsibility, not line count. A helper must name an operation the reader would
  recognize. Do not add forwarding layers, generic workflow engines, classes or configuration
  tables merely to make a function shorter. Keep helpers in the same file until reuse or a real
  module boundary warrants moving them. Put the workflow before its implementation helpers.
- Separate pure transformations from HTTP, SQLite, filesystem and player I/O. Keep SQL and row
  conversion in the database/query modules, HTTP parsing in routes, and transport in `api.ts`.
  Share domain policy between live and sandbox implementations through pure functions when the
  policy is the same; keep their different storage behavior explicit.
- Parse and validate at the boundary, then pass valid domain values inward. A type assertion is
  not validation. Preserve known types through helpers: a generic job runner should retain its
  result type instead of returning `unknown` and making every caller cast it back. Use a
  discriminated union when a job or message kind determines its payload.
- Use an options object beyond four parameters, or earlier when positional booleans or numbers
  would make a call ambiguous. Pass the dependencies an operation needs; do not introduce a
  service locator to avoid arguments.
- Production functions normally stay within 50 nonblank, noncomment lines, cyclomatic complexity
  15 and three levels of control-flow nesting. These are review limits, not extraction targets.
  A cohesive parser dispatch, a declarative mapping or a factory grouping short closures may
  exceed the line limit when that keeps related code understandable. Keep the exception local
  and explain the constraint. A factory containing several workflows does not qualify merely
  because they share a closure. `vite.config.ts` enforces these limits, at most four parameters
  and three nested callbacks, no nested ternaries, and no `else` after a returning branch.
  Tests are exempt from function length and complexity limits; the other rules still apply.
  Svelte templates also require review because lint checks their scripts, not all markup expressions.

### State and Svelte

- Components own presentation, bindings and short event handlers. Move independent sorting,
  filtering and formatting into pure helpers. A page that also implements persistence, undo
  and job polling needs focused state/workflow code, as Triage has in its session and player.
  Split components by a visible responsibility, not by a file-length quota.
- Keep `$derived` calculations pure and `$effect` bodies focused on one synchronization task.
  Templates should display prepared values and call named actions; avoid nested decisions and
  substantial data manipulation inside markup.
- Make asynchronous ownership explicit. Capture the API mode before queueing writes, reject stale
  completions after a session or mode change, and keep related writes in their required order.
  Extract helpers without moving these checks away from the operations they protect.
- Make success, failure and cleanup paths visible. Publish saved state after persistence succeeds;
  optimistic updates need an explicit recovery path. Close owned resources in `finally`, and keep
  timer/listener cleanup with their lifecycle. Preserve transaction boundaries, cancellation and
  sandbox behavior when simplifying code.

### Canonical orchestration shape

The Maybe-list import in `src/server/importers/list.ts` follows this shape. `applyListEntries`
owns the transaction that inserts stubs and applies seed verdicts.

```ts
export async function importList(
  deps: ListImportDeps,
  options: ListImportOptions,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ListImportResult> {
  const list = await deps.discogs.getList(options.listId);
  const entries = await resolveListEntries(deps, list.items, options);

  const progress = applyListEntries(deps.db, entries);
  onProgress?.({ ...progress });

  deps.logger.info(
    `list "${list.name}": ${progress.processed} items, ${progress.verdictsWritten} verdicts written`,
  );
  return { kind: "list", listName: list.name, ...progress };
}
```

The workflow is visible: fetch the list, resolve its entries, apply them, report the outcome.
Each called operation has a specific responsibility. The transaction and seed precedence can be
reviewed in the helper that applies entries without obscuring this sequence.

Low-level code should be just as direct. The nullable comparison in `src/client/twelves/model.ts`
has one job and spells out its cases without a nested ternary:

```ts
function compareNullable(left: number | null, right: number | null, direction: 1 | -1): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}
```

### Before finishing a change

Read every changed function from top to bottom. Its names and control flow must explain the
operation without mentally expanding dense expressions or opening every helper. Check that each
helper has one responsibility, effects occur in the right order, and failures leave coherent state.
Keep comments for constraints and reasons; replace comments that narrate a block with clearer code.
Test behavior at the affected boundary, including failure/order cases for asynchronous changes.
Passing lint does not waive these rules. Improve the functions the task touches without turning an
unrelated change into a repository-wide rewrite.

## Web platform and accessibility (binding)

Use what the browser already provides before writing an equivalent. Native elements and APIs come
with keyboard behavior, focus handling, accessibility semantics and form integration that
hand-rolled code has to reproduce and often gets partly wrong. Apply these rules to Svelte markup,
client TypeScript and CSS.

### Native first

- Use the native element when one fits: `<dialog>` opened with `showModal()` for modal content,
  the `popover` attribute for non-modal overlays, `<details>`/`<summary>` for disclosure,
  `<input type="range">` for sliders, `<progress>` and `<meter>` for progress and gauges,
  `<output>` for computed values, radio inputs for one-of-many choices, `<fieldset>`/`<legend>`
  for groups of controls, `<table>` for tabular data, `<time>` for dates and `<kbd>` for keys.
- Use `<form>` submission, `<label>` association and constraint validation (`min`, `max`,
  `required`, `setCustomValidity`, `:user-invalid`) before custom form plumbing. Shared validation
  such as `validateConfig` still decides; the platform reports the result on the field.
- Prefer platform APIs to helpers: `inert` to take content out of focus, pointer input and the
  accessibility tree; the `hidden` attribute to hide content; `Intl` for formatting;
  `AbortController` for cancellation; `Promise.withResolvers()`; `structuredClone()`.
- Prefer CSS to script for presentation and state styling: `:focus-visible`, `:user-invalid`,
  `:has()`, `accent-color`, container and media queries, `prefers-reduced-motion`.
- Features that are Baseline newly available or better need no polyfill or library. A feature
  missing from current Firefox or Safari needs a fallback that keeps the behavior correct.
- A custom widget is the exception. When no native element fits, implement the WAI-ARIA Authoring
  Practices pattern completely (roles, states, keyboard interaction, focus) and state in a comment
  why the native element did not fit. A role without its keyboard behavior is worse than no role.

### Accessibility

- Every control has an accessible name, from visible text where possible: `<label>` first, then
  `aria-labelledby`, then `aria-label`. A label holds the name only; help text and errors are
  attached with `aria-describedby`, and invalid fields carry `aria-invalid`.
- Expose state with ARIA attributes, not classes alone: `aria-current`, `aria-selected`,
  `aria-pressed`, `aria-expanded`, `aria-busy`. Style from those attributes so the visible state
  and the announced state cannot disagree.
- A control that has a shortcut declares it with `aria-keyshortcuts`, using the keys in
  `src/client/keymap.ts`.
- Live regions are in the DOM before their text changes; a region inserted together with its
  text is usually not announced. Routine messages use `role="status"`; `role="alert"` is for
  errors that must interrupt.
- Decorative glyphs are `aria-hidden`; a glyph that carries meaning has a text alternative.
- The app stays keyboard-first. A button that duplicates a shortcut may leave the tab order
  (`tabindex="-1"`), but nothing focusable may take the page keys away: embeds are `inert`.
- Each route sets the document title.
- Fix Svelte's `a11y_*` warnings instead of suppressing them. A `svelte-ignore` needs a comment
  explaining why the warning does not apply.

## Electron-ready rules (enforced by `vp run check:portability`)

1. **Server is a function.** `createServer({ config, paths, secrets, logger })` returns
   `{ app, start(port, host), stop() }`. The CLI is one caller; Electron will be another. 127.0.0.1 only.
2. **One transport seam.** `src/client/api.ts` is the only file in `src/client` that may call `fetch`.
3. **One place for paths.** `src/server/paths.ts` resolves data dir, db file, config, dumps, temp, dist,
   by default in the per-user app folder Electron's `userData` names. The CLI passes
   `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR` and `DIGGA_CONFIG_FILE` from the environment or a `.env` in
   its cwd. No `process.cwd()` outside `src/cli/`.
4. **One place for secrets.** `src/server/secrets.ts` (`secrets.env` in the library / `DISCOGS_TOKEN`
   now, `safeStorage` later).
   No other `process.env` reads outside `paths.ts`, `secrets.ts`, `src/cli/`.
5. **Jobs are library functions** in `src/server/jobs/` taking `{ db, discogs, logger }`, options and
   `onProgress`; status goes to the `jobs` table through `jobs/runner.ts`.
6. **Heavy work never blocks the server thread.** `POST /api/jobs/dump-load` runs the loader in a
   `worker_threads` Worker with its own DB connection and serialisable arguments; the network-bound
   jobs are async and cancellable through `AbortSignal`.
7. **Frontend is environment-agnostic.** `src/shared` imports nothing from Node; `src/client` reads no
   env, filesystem, or `window.location` beyond the hash router. Vite `base: './'`, hash routing only.
   The YouTube IFrame API needs an http(s) origin, which the localhost server provides.
8. **Native modules stay isolated.** Only `db/db.ts` imports `better-sqlite3`; only
   `importers/history.ts` touches browser profile files.
9. **Logging goes through `src/server/logger.ts`.**
10. **Enforce it.** `scripts/check-portability.ts` fails the build on violations of 2, 3, 4, 7, 8.

## Where to go next

- `docs/CODE_QUALITY_AUDIT.md` for the completed readability audit, fixes and verification.
- `docs/ROADMAP.md` for the session plan (design + triage UI next).
- `docs/DESIGN_BRIEF.md` and `docs/KEYMAP.md` for the UI session.
- `docs/FIRST_RUN.md` for the first run (the setup) being built, and `docs/STYLE_CENSUS.md` for
  refreshing the style census it ships.
- `docs/ELECTRON_PLAN.md` for packaging.
- [docs/E2E_TESTING.md](docs/E2E_TESTING.md) for E2E commands, binding rules and task-specific
  document routes; [docs/e2e/PLAN.md](docs/e2e/PLAN.md) when continuing the E2E implementation.
- `docs/DECISIONS.md` for why things are the way they are.
