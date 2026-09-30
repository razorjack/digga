import http from "node:http";
import net from "node:net";
import { TriagePage } from "../pages/triage.ts";
import { emptyGuardLog, guardContext } from "../support/browser-guard.ts";
import { expect, test } from "../support/test.ts";

/** A loopback listener the test owns, never Digga's port 3456; it counts who connects. */
interface CountingListener {
  port: number;
  connections(): number;
  close(): Promise<void>;
}

const guarded = test.extend<{ forbidden: CountingListener }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  forbidden: async ({}, use) => {
    const listener = await countingListener();
    await use(listener);
    await listener.close();
  },
  diggaOptions: async ({ diggaOptions, forbidden }, use) => {
    await use({
      ...diggaOptions,
      serviceUrls: { youtubeOembed: `http://127.0.0.1:${forbidden.port}/oembed` },
    });
  },
});

guarded(
  "GUARD-01 the server cannot reach a loopback port other than the fakes'",
  { tag: ["@GUARD-01", "@P0"] },
  async ({ app, forbidden }) => {
    const triage = new TriagePage(app);
    await app.open();
    const releaseId = await triage.record.getAttribute("data-release-id");
    const attached = app.page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/releases/${releaseId}/videos`,
    );

    await app.paste("https://www.youtube.com/watch?v=pastedvideo");

    const response = await attached;
    expect(response.ok()).toBe(true);
    await response.finished();
    expect(forbidden.connections()).toBe(0);
    expect(app.server.stderr).toContain(
      `digga-e2e guard: refused a connection to 127.0.0.1:${forbidden.port}`,
    );
  },
);

guarded(
  "GUARD-02 the browser reaches only the allowed origin: no other port, redirect or WebSocket",
  { tag: ["@GUARD-02", "@P0"] },
  async ({ browser, forbidden }) => {
    const allowed = await redirectingServer(forbidden.port);
    const log = emptyGuardLog();
    const context = await browser.newContext();
    await guardContext(context, allowed.origin, log);
    const page = await context.newPage();
    await page.goto(`${allowed.origin}/`);

    const outcomes = await page.evaluate(async (port) => {
      const load = (url: string) =>
        fetch(url).then(
          () => "loaded",
          () => "failed",
        );
      const openSocket = () =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(`ws://localhost:${port}/`);
          socket.onopen = () => resolve("open");
          socket.onclose = () => resolve("closed");
        });
      return {
        direct: await load(`http://localhost:${port}/`),
        redirect: await load("/redirect"),
        webSocket: await openSocket(),
      };
    }, forbidden.port);
    const navigation = await page.goto(`${allowed.origin}/redirect`).then(
      () => "loaded",
      () => "failed",
    );

    expect(outcomes).toEqual({ direct: "failed", redirect: "failed", webSocket: "closed" });
    expect(navigation).toBe("failed");
    expect(forbidden.connections()).toBe(0);
    expect(log.refused).toEqual([`http://localhost:${forbidden.port}/`]);
    expect(log.redirects).toHaveLength(2);
    expect(log.webSockets).toEqual([`ws://localhost:${forbidden.port}/`]);
    await context.close();
    await allowed.close();
  },
);

async function countingListener(): Promise<CountingListener> {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  const port = await listen(server);
  return { port, connections: () => connections, close: () => closeServer(server) };
}

/** A page, and a redirect to the forbidden port, as a server bug could send. */
async function redirectingServer(
  forbiddenPort: number,
): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect")
      response.writeHead(302, { location: `http://localhost:${forbiddenPort}/` }).end();
    else response.writeHead(200, { "content-type": "text/html" }).end("<title>allowed</title>");
  });
  const port = await listen(server);
  const close = () => {
    // A request still on its way would hold close() open.
    server.closeAllConnections();
    return closeServer(server);
  };
  return { origin: `http://localhost:${port}`, close };
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
