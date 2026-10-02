# Guard

Read this when working on guard coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

## GUARD-01

Priority: **P0**.

`DIGGA_YOUTUBE_OEMBED_URL` points at a loopback listener the test owns, on a port other than the
fakes': `app.paste()` of a YouTube link; the listener saw no connection, and the guard reported the
refused connection on the server's stderr

## GUARD-02

Priority: **P0**.

A context prepared for a small server the test owns: a request to another loopback port, a redirect
from the allowed origin to it, and a WebSocket to it all fail, and that port's listener saw nothing
