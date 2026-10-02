# E2E scenarios

Read the family relevant to the task after the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [AUTHORING](../AUTHORING.md). Each ID is a stable acceptance specification, not a record
of a particular run. New scenarios get new IDs; keep existing IDs when moving documentation.

| Family                    | Specifications           | Current specs under `tests/e2e/specs/`                                                  |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| Guard                     | [GUARD](guard.md)        | `guard.e2e.ts`                                                                          |
| Shell and navigation      | [SHELL](shell.md)        | `shell.e2e.ts`                                                                          |
| First run                 | [SETUP](setup.md)        | `setup.e2e.ts`, `setup-steps.e2e.ts`, `setup-discogs.e2e.ts`                            |
| Triage                    | [TRI](triage.md)         | `triage.e2e.ts`, `triage-player.e2e.ts`, `triage-queue.e2e.ts`, `triage-discogs.e2e.ts` |
| Sandbox                   | [SBX](sandbox.md)        | `sandbox.e2e.ts`                                                                        |
| Twelves                   | [TWL](twelves.md)        | `twelves.e2e.ts`, `twelves-discogs.e2e.ts`                                              |
| Settings                  | [SET](settings.md)       | `settings.e2e.ts`, `settings-discogs.e2e.ts`                                            |
| Persistence and lifecycle | [PER](persistence.md)    | `persistence.e2e.ts`                                                                    |
| Accessibility             | [A11Y](accessibility.md) | `accessibility.e2e.ts`                                                                  |
| Electron                  | [ELEC](electron.md)      | Planned; also read [ELECTRON](../ELECTRON.md)                                           |
| Real-service contracts    | [CON](contracts.md)      | Planned; manual only, never CI                                                          |

## Priority and target

**P0** is the smoke set, which `vp run verify` runs. **P1** and **P2** are the rest of the suite.
[CI](../../E2E_TESTING.md#ci) runs every implemented web test, P0 through P2, on every push, as
`vp run e2e` does locally. The owner decided on 2026-10-02 against scheduled or nightly runs, and
on 2026-10-03 that burn-ins run locally, not in CI. Use the [current commands](../../E2E_TESTING.md#running);
Electron and contract scripts do not exist yet.

The target is shared web/Electron coverage unless a specification says web or Electron only.
Shared target describes the design; only the web host exists. Specs use tags such as
`{ tag: ["@TRI-12", "@P0"] }`; `@web` and `@electron` mark host restrictions.
Named templates and given state apply where stated. A scenario may need several tests for its
variants, so a test count is not a scenario count.

## Coverage states

- **Specified:** the behavior is documented but no test implements it yet. Remaining work
  belongs in [PLAN](../PLAN.md), not in a historical results paragraph.
- **Implemented:** a tagged spec exercises the required behavior. Inspect its assertions;
  the tag alone does not prove complete coverage. Passing status comes from a particular run.
- **Product gap:** a reproduced mismatch with the agreed design. The scenario describes the
  mismatch, a normal test covers today's behavior, and a separate `test.fail` names the gap
  and asserts the design. When that test unexpectedly passes, close the gap and make it normal.
- **Observation:** a finding that needs reproduction or a product decision. Keep it in the
  plan with evidence; do not silently turn it into a required change or an accepted behavior.

To inspect the runnable cases without starting an app:

```sh
npx playwright test --config tests/e2e/playwright.config.ts --list
```

Keep completion contracts with the relevant family and common synchronization rules in
AUTHORING. Preserve scenario preconditions, ordering, failure behavior and expected observations
when editing. Product requirements remain in [FIRST_RUN](../../FIRST_RUN.md),
[KEYMAP](../../KEYMAP.md) and the other product documents; link to them when a requirement is
shared instead of maintaining competing versions.
