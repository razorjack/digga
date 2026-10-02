# E2E scenarios

IDs are stable, so commits, reviews and failures can refer to them; new scenarios get new
numbers. Priority: **P0** is the smoke set. The planned CI schedule runs **P1** on every CI run
and **P2** nightly; today `vp run e2e` runs every implemented web test.
Target: **both** unless marked **web** or **electron**. Templates are named in brackets where it
matters.

**Gap** marks a scenario where the product does not yet do what `docs/FIRST_RUN.md` or this
document says. The scenario lists what the product does today, and a normal test asserts that.
The designed behaviour is a separate `test.fail` with the gap in its title: it runs, and the run
reports it as soon as the product catches up, which is when the gap is closed here and the test
becomes a normal one.

The P0 set covers the guard, startup and navigation, the first run from real defaults, playback,
a live verdict surviving reload and relaunch, undo and the wantlist push, sandbox isolation, and one
failed write: GUARD-01, GUARD-02, SHELL-01, SHELL-02, SETUP-01, TRI-02, TRI-07, TRI-10, TRI-12,
TRI-13, SBX-01, PER-01 and PER-04.

Read only the family relevant to the task. These specifications include planned scenarios;
a row does not mean its test has been implemented. See the [implementation plan](../PLAN.md).

- [Guard](guard.md)
- [Shell and navigation](shell.md)
- [First run](setup.md)
- [Triage](triage.md)
- [Sandbox](sandbox.md)
- [Twelves](twelves.md)
- [Settings](settings.md)
- [Persistence and lifecycle](persistence.md)
- [Accessibility](accessibility.md)
- [Electron only](electron.md)
- [Real-service contract checks](contracts.md)
