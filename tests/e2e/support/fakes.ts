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
import type { DumpCheckpoint, DumpFile } from "../fixtures/dump.ts";
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
  readonly dumps = new FakeDataDumps();
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
    this.dumps.stop();
    this.#server.closeAllConnections();
    await new Promise((resolve) => this.#server.close(resolve));
  }

  async #answer(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake");
    const logged = await this.#record(request, url);
    if (logged.service === "dumps") {
      await this.dumps.answer(logged, response);
      logged.answeredAt = Date.now();
      return;
    }
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

/**
 * data.discogs.com as src/server/discogs/data-dumps.ts reads it: the listing pages with the
 * dump's size, CHECKSUM.txt, and the dump with its Content-Length. Nothing is listed until a test
 * lists a dump. A transfer can stop at a checkpoint until the test releases it, or fail part way.
 */
export class FakeDataDumps {
  #listed: DumpFile | null = null;
  #listedBytes: number | null = null;
  #holdAt: number | null = null;
  #failAfterBytes: number | null = null;
  #gate = Promise.withResolvers<void>();
  #sentBytes = 0;

  /** Lists the dump as the newest, with the size the listing shows; null shows none. */
  list(dump: DumpFile, options: { listedBytes?: number | null } = {}): void {
    this.#listed = dump;
    this.#listedBytes = options.listedBytes === undefined ? dump.data.length : options.listedBytes;
  }

  get listed(): DumpFile {
    if (!this.#listed) throw new Error("no dump is listed; set diggaOptions.listedDump");
    return this.#listed;
  }

  checkpoint(name: string): DumpCheckpoint {
    const checkpoint = this.listed.checkpoints[name];
    if (!checkpoint) throw new Error(`${this.listed.name} has no checkpoint ${name}`);
    return checkpoint;
  }

  /** The transfer stops once it has sent the bytes before the checkpoint, until release(). */
  holdAt(name: string): void {
    this.#holdAt = this.checkpoint(name).offset;
  }

  /** Lets a held transfer go on: to the end, or to the next checkpoint when one is named. */
  release(next?: string): void {
    this.#holdAt = next === undefined ? null : this.checkpoint(next).offset;
    this.#gate.resolve();
    this.#gate = Promise.withResolvers();
  }

  /** The transfer closes its connection after this many bytes, as a dropped download does. */
  set(options: { failAfterBytes: number | null }): void {
    this.#failAfterBytes = options.failAfterBytes;
  }

  /** The bytes of the dump the last transfer has sent so far. */
  get sentBytes(): number {
    return this.#sentBytes;
  }

  stop(): void {
    this.#holdAt = null;
    this.#gate.resolve();
  }

  async answer(request: FakeRequest, response: http.ServerResponse): Promise<void> {
    const dump = this.#listed;
    const { prefix, download } = request.query;
    if (!dump) return sendText(response, 404, "not found");
    const year = dump.date.slice(0, 4);
    if (prefix === "data/") return sendText(response, 200, rootPage(year));
    if (prefix === `data/${year}/`)
      return sendText(response, 200, yearPage(dump, this.#listedBytes));
    if (download === `data/${year}/${checksumFile(dump)}`)
      return sendText(response, 200, `${dump.sha256} ${dump.name}\n`);
    if (download === `data/${year}/${dump.name}`) return this.#transfer(dump, response);
    return sendText(response, 404, "not found");
  }

  async #transfer(dump: DumpFile, response: http.ServerResponse): Promise<void> {
    const size = dump.data.length;
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(size),
    });
    this.#sentBytes = 0;
    while (this.#sentBytes < size) {
      if (this.#sentBytes === this.#failAfterBytes) {
        response.destroy();
        return;
      }
      if (this.#sentBytes === this.#holdAt) {
        await this.#gate.promise;
        continue;
      }
      const until = this.#nextStop(size);
      if (!(await writeBytes(response, dump.data.subarray(this.#sentBytes, until)))) return;
      this.#sentBytes = until;
    }
    response.end();
  }

  /** The end, or the hold or failure point before it. */
  #nextStop(size: number): number {
    const stops = [this.#holdAt, this.#failAfterBytes].filter(
      (stop): stop is number => stop !== null && stop > this.#sentBytes,
    );
    return Math.min(size, ...stops);
  }
}

function rootPage(year: string): string {
  return `<pre><a href="?prefix=data%2F${year}%2F">${year}/</a></pre>`;
}

/** The year's page lists each file after its size, as data.discogs.com does. */
function yearPage(dump: DumpFile, listedBytes: number | null): string {
  const year = dump.date.slice(0, 4);
  const checksum = checksumFile(dump);
  const size = listedBytes === null ? "" : `${listingSize(listedBytes)}   `;
  return [
    "<pre>",
    `${dump.date} 19:20:02   0.3 KB   <a href="?download=data%2F${year}%2F${checksum}">${checksum}</a>`,
    `${dump.date} 19:21:51   ${size}<a href="?download=data%2F${year}%2F${dump.name}">${dump.name}</a>`,
    "</pre>",
  ].join("\n");
}

function checksumFile(dump: DumpFile): string {
  return dump.name.replace("_releases.xml.gz", "_CHECKSUM.txt");
}

/** "79.3 KB": powers of 1024, one decimal, as the listing prints sizes. */
function listingSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (bytes >= 1024 ** (unit + 1) && unit < units.length - 1) unit += 1;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${units[unit]}`;
}

function sendText(response: http.ServerResponse, status: number, text: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(text);
}

/** Writes with backpressure; false once the client has gone. */
function writeBytes(response: http.ServerResponse, bytes: Buffer): Promise<boolean> {
  if (response.destroyed) return Promise.resolve(false);
  if (response.write(bytes)) return Promise.resolve(true);
  return new Promise((resolve) => {
    response.once("drain", () => resolve(true));
    response.once("close", () => resolve(false));
  });
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
      embed: video.embed,
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
