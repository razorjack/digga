# Real-service contract checks (manual, never in CI)

Read this when working on real-service contract checks coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

The fakes encode assumptions about Discogs and YouTube. These checks and their separate
`tests/e2e/playwright.contract.config.ts` configuration are planned, not implemented. The
configuration must keep them out of ordinary commands. Run them manually before a release,
never in CI:

## CON-01

The real IFrame API loads on `localhost`, plays a known embeddable video in headed Chromium, and
emits the states the fake emits, with `getVideoData()`

## CON-02

With a token the developer supplies for the run, and a client that refuses anything but `GET`
(Discogs tokens cannot be limited to reading): identity, one release and one wantlist page have the
fields the fake serves

## CON-03

data.discogs.com's listing still parses to the newest dump and its size, without downloading it
