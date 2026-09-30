import http from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_USER_AGENT } from "../../../src/server/discogs/transport.ts";
import type {
  DiscogsBasicInformation,
  DiscogsIdentity,
  DiscogsRelease,
  DiscogsUser,
} from "../../../src/server/discogs/types.ts";
import { ACCOUNTS, releaseById, videoCatalogue } from "../fixtures/catalogue.ts";
import type { ServiceUrls } from "./spawn.ts";

/**
 * Stand-ins for the Discogs API, YouTube's oEmbed and data.discogs.com on one loopback port, the
 * only port the network guard lets Digga reach. Each test gets its own instance, so its state,
 * request log and faults belong to that test (docs/E2E_TESTING.md, "The fake services").
 */

export type FakeService = "discogs" | "youtube" | "dumps" | "unknown";

/** `e2e-token-<username>` names that account; this one Discogs refuses. */
const REFUSED_TOKEN = "e2e-token-refused";

export interface FakeRequest {
  service: FakeService;
  method: string;
  /** The path within the service, such as /users/dj/wants/1201 for the Discogs API. */
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  /** The account the token names, or null without a token. */
  authenticatedAs: string | null;
  body: unknown;
  arrivedAt: number;
  answeredAt: number | null;
}

interface FakeAnswer {
  status: number;
  body?: unknown;
}

interface Fault {
  pattern: CompiledPattern;
  fail?: { status: number; times: number };
  delayMs?: number;
  hold?: PromiseWithResolvers<void> & { arrived: PromiseWithResolvers<void> };
}

interface CompiledPattern {
  method: string;
  regex: RegExp;
  keys: string[];
}

type DiscogsHandler = (fakes: FakeServices, request: FakeRequest) => FakeAnswer;

const SERVICE_PREFIXES: [FakeService, string][] = [
  ["discogs", "/discogs"],
  ["youtube", "/youtube"],
  ["dumps", "/dumps"],
];

const DISCOGS_ROUTES = (
  [
    ["GET /oauth/identity", identity],
    ["GET /users/:user", profile],
    ["GET /users/:user/collection/folders/0/releases", collectionPage],
    ["GET /users/:user/wants", wantlistPage],
    ["PUT /users/:user/wants/:id", addWant],
    ["DELETE /users/:user/wants/:id", removeWant],
    ["GET /users/:user/lists", noLists],
    ["GET /releases/:id", marketRelease],
  ] satisfies [string, DiscogsHandler][]
).map(([pattern, handler]) => ({ pattern: compilePattern(pattern), handler }));

export class FakeServices {
  readonly port: number;
  /** Problems a test must not hide: a real token, an unplanned request. */
  readonly violations: string[] = [];
  readonly wantlists = new Map<string, Map<number, string | null>>();
  #server: http.Server;
  #log: FakeRequest[] = [];
  #faults: Fault[] = [];

  private constructor(server: http.Server) {
    this.#server = server;
    this.port = (server.address() as AddressInfo).port;
    for (const account of ACCOUNTS)
      this.wantlists.set(account.username, new Map(account.wantlist.map((id) => [id, null])));
  }

  static async start(): Promise<FakeServices> {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const fakes = new FakeServices(server);
    server.on("request", (request, response) => void fakes.#answer(request, response));
    return fakes;
  }

  /** The addresses Digga is started with, in place of the real services. */
  get urls(): ServiceUrls {
    const origin = `http://127.0.0.1:${this.port}`;
    return {
      discogsApi: `${origin}/discogs`,
      youtubeOembed: `${origin}/youtube/oembed`,
      dataDumps: `${origin}/dumps/`,
    };
  }

  /** Discogs requests matching a pattern such as "PUT /users/:user/wants/:id", in order. */
  requests(pattern: string): FakeRequest[] {
    const compiled = compilePattern(pattern);
    const matches: FakeRequest[] = [];
    for (const request of this.#log) {
      if (request.service !== "discogs") continue;
      const params = matchPattern(compiled, request.method, request.path);
      if (params) matches.push({ ...request, params });
    }
    return matches;
  }

  get log(): readonly FakeRequest[] {
    return this.#log;
  }

  fail(pattern: string, options: { status: number; times: number }): void {
    this.#faults.push({ pattern: compilePattern(pattern), fail: { ...options } });
  }

  delay(pattern: string, options: { ms: number }): void {
    this.#faults.push({ pattern: compilePattern(pattern), delayMs: options.ms });
  }

  /** Holds the next matching request until release(); `received` resolves when it arrives. */
  hold(pattern: string): { received: Promise<void>; release: () => void } {
    const hold = { ...Promise.withResolvers<void>(), arrived: Promise.withResolvers<void>() };
    this.#faults.push({ pattern: compilePattern(pattern), hold });
    return { received: hold.arrived.promise, release: () => hold.resolve() };
  }

  async stop(): Promise<void> {
    for (const fault of this.#faults) fault.hold?.resolve();
    this.#server.closeAllConnections();
    await new Promise((resolve) => this.#server.close(resolve));
  }

  async #answer(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake");
    const logged = await this.#record(request, url);
    const answer = await this.#route(logged);
    logged.answeredAt = Date.now();
    response.writeHead(answer.status, {
      "content-type": "application/json",
      "x-discogs-ratelimit-remaining": "59",
    });
    response.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
  }

  async #record(request: http.IncomingMessage, url: URL): Promise<FakeRequest> {
    let text = "";
    for await (const chunk of request) text += String(chunk);
    const [service, prefix] = SERVICE_PREFIXES.find(([, start]) =>
      url.pathname.startsWith(`${start}/`),
    ) ?? ["unknown", ""];
    const logged: FakeRequest = {
      service,
      method: request.method ?? "GET",
      path: url.pathname.slice(prefix.length),
      query: Object.fromEntries(url.searchParams),
      params: {},
      authenticatedAs: this.#tokenUser(request.headers.authorization),
      body: text === "" ? null : (JSON.parse(text) as unknown),
      arrivedAt: Date.now(),
      answeredAt: null,
    };
    if (service === "discogs" && request.headers["user-agent"] !== DEFAULT_USER_AGENT)
      this.violations.push(`a Discogs request without Digga's User-Agent: ${logged.path}`);
    this.#log.push(logged);
    return logged;
  }

  #tokenUser(authorization: string | undefined): string | null {
    const token = /^Discogs token=(.+)$/.exec(authorization ?? "")?.[1];
    if (token === undefined) return null;
    if (!token.startsWith("e2e-")) this.violations.push("a non-test token reached the fake");
    if (token === REFUSED_TOKEN || !token.startsWith("e2e-token-")) return null;
    return token.slice("e2e-token-".length);
  }

  async #route(request: FakeRequest): Promise<FakeAnswer> {
    if (request.service === "youtube" && request.path === "/oembed") return oembed(request.query);
    if (request.service !== "discogs") return { status: 404, body: { message: "Not found" } };
    const faulted = await this.#applyFaults(request);
    if (faulted) return faulted;
    for (const route of DISCOGS_ROUTES) {
      const params = matchPattern(route.pattern, request.method, request.path);
      if (params) return route.handler(this, { ...request, params });
    }
    this.violations.push(`an unplanned Discogs request: ${request.method} ${request.path}`);
    return { status: 404, body: { message: "The requested resource was not found." } };
  }

  async #applyFaults(request: FakeRequest): Promise<FakeAnswer | null> {
    for (const fault of this.#faults) {
      if (!matchPattern(fault.pattern, request.method, request.path)) continue;
      if (fault.hold) {
        fault.hold.arrived.resolve();
        await fault.hold.promise;
      }
      if (fault.delayMs) await new Promise((resolve) => setTimeout(resolve, fault.delayMs));
      if (fault.fail && fault.fail.times > 0) {
        fault.fail.times -= 1;
        return { status: fault.fail.status, body: { message: "The fake failed on purpose." } };
      }
    }
    return null;
  }
}

function identity(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  if (!request.authenticatedAs) return { status: 401, body: { message: "You must authenticate." } };
  return {
    status: 200,
    body: { id: 1, username: request.authenticatedAs } satisfies DiscogsIdentity,
  };
}

function profile(fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const account = ACCOUNTS.find((candidate) => candidate.username === request.params.user);
  if (!account) return { status: 404, body: { message: "User does not exist." } };
  const user: DiscogsUser = {
    id: 1,
    username: account.username,
    num_collection: account.collection.length,
    num_wantlist: fakes.wantlists.get(account.username)?.size ?? 0,
    curr_abbr: "EUR",
  };
  return { status: 200, body: user };
}

function collectionPage(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const account = ACCOUNTS.find((candidate) => candidate.username === request.params.user);
  if (!account) return { status: 404, body: { message: "User does not exist." } };
  const releases = account.collection.map((id, index) => ({
    id,
    instance_id: 5000 + index,
    date_added: "2026-01-10T12:00:00-08:00",
    basic_information: basicInformation(id),
  }));
  return { status: 200, body: { pagination: pagination(1, releases.length), releases } };
}

function wantlistPage(fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const wants = fakes.wantlists.get(request.params.user ?? "");
  if (!wants) return { status: 404, body: { message: "User does not exist." } };
  const items = [...wants].map(([id, notes]) => ({
    id,
    notes: notes ?? "",
    date_added: "2026-01-11T12:00:00-08:00",
    basic_information: basicInformation(id),
  }));
  return { status: 200, body: { pagination: pagination(1, items.length), wants: items } };
}

function addWant(fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const refused = refuseOtherAccount(request);
  if (refused) return refused;
  const notes = (request.body as { notes?: string } | null)?.notes ?? null;
  fakes.wantlists.get(request.params.user ?? "")?.set(Number(request.params.id), notes);
  return { status: 201, body: { id: Number(request.params.id), notes } };
}

function removeWant(fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const refused = refuseOtherAccount(request);
  if (refused) return refused;
  const removed = fakes.wantlists.get(request.params.user ?? "")?.delete(Number(request.params.id));
  return removed ? { status: 204 } : { status: 404, body: { message: "Release not in wantlist." } };
}

function refuseOtherAccount(request: FakeRequest): FakeAnswer | null {
  if (!request.authenticatedAs) return { status: 401, body: { message: "You must authenticate." } };
  if (request.authenticatedAs !== request.params.user)
    return { status: 403, body: { message: "You don't have permission to access this resource." } };
  return null;
}

function marketRelease(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const fixture = releaseById(Number(request.params.id));
  if (!fixture) return { status: 404, body: { message: "Release not found." } };
  const release: DiscogsRelease = {
    id: fixture.id,
    title: fixture.title,
    lowest_price: 12.5,
    num_for_sale: 3,
    community: { have: 400, want: 900 },
    videos: fixture.videos.map((video) => ({
      uri: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.title,
      duration: video.seconds,
      embed: true,
    })),
  };
  return { status: 200, body: release };
}

function noLists(): FakeAnswer {
  return { status: 200, body: { pagination: pagination(1, 0), lists: [] } };
}

function oembed(query: Record<string, string>): FakeAnswer {
  const watchUrl = query.url ?? "";
  const videoId = new URL(watchUrl, "https://www.youtube.com").searchParams.get("v") ?? "";
  const video = videoCatalogue()[videoId];
  if (!video) return { status: 404 };
  return { status: 200, body: { title: video.title, type: "video" } };
}

function basicInformation(id: number): DiscogsBasicInformation {
  const fixture = releaseById(id);
  if (!fixture) throw new Error(`release ${id} is not in the fixture catalogue`);
  return {
    id,
    master_id: fixture.master?.id ?? null,
    title: fixture.title,
    year: fixture.year ?? 0,
    artists: fixture.artists.map((name, index) => ({ id: index + 1, name })),
    labels: [{ id: fixture.label.id, name: fixture.label.name, catno: fixture.label.catno }],
    formats: [{ name: "Vinyl", qty: "1", descriptions: ['12"'] }],
    genres: ["Electronic"],
    styles: [...fixture.styles],
  };
}

function pagination(pages: number, items: number) {
  return { page: 1, pages, per_page: 100, items };
}

function compilePattern(pattern: string): CompiledPattern {
  const [method, path] = pattern.split(" ") as [string, string];
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { method, regex: new RegExp(`^${source}$`), keys };
}

function matchPattern(
  pattern: CompiledPattern,
  method: string,
  path: string,
): Record<string, string> | null {
  if (pattern.method !== method) return null;
  const match = pattern.regex.exec(path);
  if (!match) return null;
  return Object.fromEntries(
    pattern.keys.map((key, index) => [key, decodeURIComponent(match[index + 1]!)]),
  );
}
