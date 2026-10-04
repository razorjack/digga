import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_USER_AGENT } from "../../src/server/discogs/transport.ts";
import type {
  DiscogsBasicInformation,
  DiscogsIdentity,
  DiscogsInventoryPage,
  DiscogsList,
  DiscogsRelease,
  DiscogsUser,
  DiscogsUserListsPage,
} from "../../src/server/discogs/types.ts";
import {
  ACCOUNTS,
  type FixtureAccount,
  releaseById,
  videoCatalogue,
} from "../../tests/e2e/fixtures/catalogue.ts";
import type { DumpCheckpoint, DumpFile } from "../../tests/e2e/fixtures/dump.ts";

/**
 * Stand-ins for the Discogs API, YouTube's oEmbed and data.discogs.com on one loopback port
 * (docs/E2E_TESTING.md, "The fake services"). The end-to-end harness starts one per test, on the
 * only port its network guard lets Digga reach, so its state, request log and faults belong to
 * that test. Run as a program, it serves the same fakes for a rehearsal by hand, with a dump
 * from disk; see USAGE below.
 */

/** The addresses Digga is started with in place of the real services. */
export interface ServiceUrls {
  discogsApi: string;
  youtubeOembed: string;
  dataDumps: string;
}

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
    ["GET /users/:user/inventory", inventoryPage],
    ["GET /users/:user/lists", userLists],
    ["GET /lists/:id", listItems],
    ["GET /releases/:id", marketRelease],
  ] satisfies [string, DiscogsHandler][]
).map(([pattern, handler]) => ({ pattern: compilePattern(pattern), handler }));

export interface FakeServicesOptions {
  /** 0, the default, picks a free port. */
  port?: number;
  /** Called with each request once it is answered, for a rehearsal's console. */
  onAnswered?: (request: FakeRequest) => void;
  /** Called with each problem as it is found, for a rehearsal's console. */
  onViolation?: (problem: string) => void;
}

export class FakeServices {
  readonly port: number;
  /** Problems a test must not hide: a real token, an unplanned request. */
  readonly violations: string[] = [];
  readonly wantlists = new Map<string, Map<number, string | null>>();
  readonly dumps = new FakeDataDumps();
  #server: http.Server;
  #options: FakeServicesOptions;
  #log: FakeRequest[] = [];
  #faults: Fault[] = [];

  private constructor(server: http.Server, options: FakeServicesOptions) {
    this.#server = server;
    this.#options = options;
    this.port = (server.address() as AddressInfo).port;
    for (const account of ACCOUNTS)
      this.wantlists.set(account.username, new Map(account.wantlist.map((id) => [id, null])));
  }

  static async start(options: FakeServicesOptions = {}): Promise<FakeServices> {
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
    const fakes = new FakeServices(server, options);
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
    if (logged.service === "dumps") await this.dumps.answer(logged, response);
    else await this.#answerApi(logged, response);
    logged.answeredAt = Date.now();
    this.#options.onAnswered?.(logged);
  }

  /** The Discogs API and oEmbed answer JSON, with Discogs' rate limit header. */
  async #answerApi(request: FakeRequest, response: http.ServerResponse): Promise<void> {
    const answer = await this.#route(request);
    response.writeHead(answer.status, {
      "content-type": "application/json",
      "x-discogs-ratelimit-remaining": "59",
    });
    response.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
  }

  #violation(problem: string): void {
    this.violations.push(problem);
    this.#options.onViolation?.(problem);
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
      this.#violation(`a Discogs request without Digga's User-Agent: ${logged.path}`);
    this.#log.push(logged);
    return logged;
  }

  #tokenUser(authorization: string | undefined): string | null {
    const token = /^Discogs token=(.+)$/.exec(authorization ?? "")?.[1];
    if (token === undefined) return null;
    if (!token.startsWith("e2e-")) this.#violation("a non-test token reached the fake");
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
    this.#violation(`an unplanned Discogs request: ${request.method} ${request.path}`);
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
 * A dump data.discogs.com lists: one the harness built in memory, with its checkpoints, or a file
 * on disk for a rehearsal, which may be 10 GB and is read a chunk at a time.
 */
export interface DumpSource {
  /** discogs_YYYYMMDD_releases.xml.gz */
  name: string;
  /** YYYY-MM-DD, the date in the name. */
  date: string;
  bytes: number;
  sha256: string;
  checkpoints: Record<string, DumpCheckpoint>;
  read(start: number, end: number): Promise<Buffer>;
}

/** The most a transfer writes at once, so a file is never read whole. */
const CHUNK_BYTES = 1024 * 1024;
/** At a set rate, a transfer writes this much of a second's bytes at a time. */
const PACED_CHUNK_SECONDS = 0.1;

/** A dump the harness built, served from memory. */
export function memoryDump(dump: DumpFile): DumpSource {
  return {
    name: dump.name,
    date: dump.date,
    bytes: dump.data.length,
    sha256: dump.sha256,
    checkpoints: dump.checkpoints,
    read: (start, end) => Promise.resolve(dump.data.subarray(start, end)),
  };
}

/**
 * A dump file on disk, read as the transfer goes; without a checksum it is hashed first. The file
 * stays open for as long as the program serves it.
 */
export async function fileDump(file: string, sha256?: string): Promise<DumpSource> {
  const name = path.basename(file);
  const date = /^discogs_(\d{4})(\d{2})(\d{2})_releases\.xml\.gz$/.exec(name);
  if (!date) throw new Error(`${name} is not named like discogs_YYYYMMDD_releases.xml.gz`);
  const handle = await fs.promises.open(file);
  return {
    name,
    date: `${date[1]}-${date[2]}-${date[3]}`,
    bytes: (await handle.stat()).size,
    sha256: sha256 ?? (await hashFile(file)),
    checkpoints: {},
    read: async (start, end) => {
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    },
  };
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * CHUNK_BYTES }))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * data.discogs.com as src/server/discogs/data-dumps.ts reads it: the listing pages with the
 * dump's size, CHECKSUM.txt, and the dump with its Content-Length. Nothing is listed until a test
 * lists a dump. A transfer can stop at a checkpoint until the test releases it, fail part way, or
 * keep to a byte rate, which is for realism and never for synchronisation.
 */
export class FakeDataDumps {
  #listed: DumpSource | null = null;
  #listedBytes: number | null = null;
  #holdAt: number | null = null;
  #failAfterBytes: number | null = null;
  #bytesPerSecond: number | null = null;
  #unavailableStatus: number | null = null;
  #contentLength: number | null = null;
  #wrongChecksums = 0;
  /** The transfer the hold applies to, counting from 1; null for every transfer. */
  #holdTransfer: number | null = null;
  #transfers = 0;
  #gate = Promise.withResolvers<void>();
  #sentBytes = 0;

  /** Lists the dump as the newest, with the size the listing shows; null shows none. */
  list(dump: DumpSource, options: { listedBytes?: number | null } = {}): void {
    this.#listed = dump;
    this.#listedBytes = options.listedBytes === undefined ? dump.bytes : options.listedBytes;
  }

  get listed(): DumpSource {
    if (!this.#listed) throw new Error("no dump is listed; set diggaOptions.listedDump");
    return this.#listed;
  }

  checkpoint(name: string): DumpCheckpoint {
    const checkpoint = this.listed.checkpoints[name];
    if (!checkpoint) throw new Error(`${this.listed.name} has no checkpoint ${name}`);
    return checkpoint;
  }

  /**
   * The transfer stops once it has sent the bytes before the checkpoint, until release(). With
   * `transfer`, only that transfer of the dump stops, counting from 1, such as the second
   * download after a checksum mismatch.
   */
  holdAt(name: string, options: { transfer?: number } = {}): void {
    this.#holdAt = this.checkpoint(name).offset;
    this.#holdTransfer = options.transfer ?? null;
  }

  /** Lets a held transfer go on: to the end, or to the next checkpoint when one is named. */
  release(next?: string): void {
    this.#holdAt = next === undefined ? null : this.checkpoint(next).offset;
    this.#gate.resolve();
    this.#gate = Promise.withResolvers();
  }

  /**
   * failAfterBytes closes the transfer's connection after that many bytes, as a dropped download
   * does; bytesPerSecond keeps each transfer to that rate; unavailableStatus answers every request
   * with that status, as the site does while it is down; contentLength is the size the transfer
   * announces instead of the dump's, which a downloader that checks for room reads first. Null
   * turns each off. wrongChecksums is how many of the next reads of CHECKSUM.txt name another
   * hash than the dump's, as when a download arrives corrupted.
   */
  set(options: {
    failAfterBytes?: number | null;
    bytesPerSecond?: number | null;
    unavailableStatus?: number | null;
    contentLength?: number | null;
    wrongChecksums?: number;
  }): void {
    if (options.failAfterBytes !== undefined) this.#failAfterBytes = options.failAfterBytes;
    if (options.bytesPerSecond !== undefined) this.#bytesPerSecond = options.bytesPerSecond;
    if (options.unavailableStatus !== undefined)
      this.#unavailableStatus = options.unavailableStatus;
    if (options.contentLength !== undefined) this.#contentLength = options.contentLength;
    if (options.wrongChecksums !== undefined) this.#wrongChecksums = options.wrongChecksums;
  }

  /** How many transfers of the dump have started. */
  get transfers(): number {
    return this.#transfers;
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
    if (this.#unavailableStatus !== null)
      return sendText(response, this.#unavailableStatus, "unavailable");
    if (!dump) return sendText(response, 404, "not found");
    const year = dump.date.slice(0, 4);
    if (prefix === "data/") return sendText(response, 200, rootPage(year));
    if (prefix === `data/${year}/`)
      return sendText(response, 200, yearPage(dump, this.#listedBytes));
    if (download === `data/${year}/${checksumFile(dump)}`)
      return sendText(response, 200, `${this.#checksumOf(dump)} ${dump.name}\n`);
    if (download === `data/${year}/${dump.name}`) return this.#transfer(dump, response);
    return sendText(response, 404, "not found");
  }

  #checksumOf(dump: DumpSource): string {
    if (this.#wrongChecksums === 0) return dump.sha256;
    this.#wrongChecksums -= 1;
    return "0".repeat(64);
  }

  async #transfer(dump: DumpSource, response: http.ServerResponse): Promise<void> {
    this.#transfers += 1;
    const transfer = this.#transfers;
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(this.#contentLength ?? dump.bytes),
    });
    const started = Date.now();
    this.#sentBytes = 0;
    while (this.#sentBytes < dump.bytes) {
      if (this.#sentBytes === this.#failAfterBytes) {
        response.destroy();
        return;
      }
      if (this.#sentBytes === this.#holdAt && this.#holds(transfer)) {
        await this.#gate.promise;
        continue;
      }
      const until = this.#nextStop(dump.bytes, transfer);
      await this.#keepPace(started, until);
      const bytes = await dump.read(this.#sentBytes, until);
      if (!(await writeBytes(response, bytes))) return;
      this.#sentBytes = until;
    }
    response.end();
  }

  #holds(transfer: number): boolean {
    return this.#holdTransfer === null || this.#holdTransfer === transfer;
  }

  /** The end, the next chunk's end, or the hold or failure point before them. */
  #nextStop(size: number, transfer: number): number {
    const holdAt = this.#holds(transfer) ? this.#holdAt : null;
    const stops = [holdAt, this.#failAfterBytes].filter(
      (stop): stop is number => stop !== null && stop > this.#sentBytes,
    );
    return Math.min(size, this.#sentBytes + this.#chunkBytes(), ...stops);
  }

  #chunkBytes(): number {
    if (this.#bytesPerSecond === null) return CHUNK_BYTES;
    const paced = Math.floor(this.#bytesPerSecond * PACED_CHUNK_SECONDS);
    return Math.max(1, Math.min(CHUNK_BYTES, paced));
  }

  /** Waits until the rate allows the bytes up to `until` to have left since the transfer started. */
  async #keepPace(started: number, until: number): Promise<void> {
    if (this.#bytesPerSecond === null) return;
    const dueMs = (until / this.#bytesPerSecond) * 1000 - (Date.now() - started);
    if (dueMs > 0) await sleep(dueMs);
  }
}

function rootPage(year: string): string {
  return `<pre><a href="?prefix=data%2F${year}%2F">${year}/</a></pre>`;
}

/** The year's page lists each file after its size, as data.discogs.com does. */
function yearPage(dump: DumpSource, listedBytes: number | null): string {
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

function checksumFile(dump: DumpSource): string {
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
  const account = accountNamed(request.params.user);
  if (!account) return { status: 404, body: { message: "User does not exist." } };
  const user: DiscogsUser = {
    id: 1,
    username: account.username,
    num_collection: account.collection.length,
    num_wantlist: fakes.wantlists.get(account.username)?.size ?? 0,
    curr_abbr: account.currency,
  };
  return { status: 200, body: user };
}

function collectionPage(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const account = accountNamed(request.params.user);
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

/** The seller's For Sale listings, all on one page. */
function inventoryPage(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const account = accountNamed(request.params.user);
  if (!account) return { status: 404, body: { message: "User does not exist." } };
  const listings = account.inventory.map((listing, index) => ({
    id: 70_000 + index,
    status: "For Sale",
    condition: listing.condition,
    sleeve_condition: listing.sleeveCondition,
    price: { value: listing.price, currency: account.currency },
    comments: listing.comments,
    release: { id: listing.releaseId },
  }));
  const page: DiscogsInventoryPage = { pagination: pagination(1, listings.length), listings };
  return { status: 200, body: page };
}

function accountNamed(username: string | undefined): FixtureAccount | undefined {
  return ACCOUNTS.find((candidate) => candidate.username === username);
}

function refuseOtherAccount(request: FakeRequest): FakeAnswer | null {
  if (!request.authenticatedAs) return { status: 401, body: { message: "You must authenticate." } };
  if (request.authenticatedAs !== request.params.user)
    return { status: 403, body: { message: "You don't have permission to access this resource." } };
  return null;
}

/** What the fake Discogs says of every release's market, in the currency asked for. */
export const MARKET = {
  lowestPrice: 12.5,
  numForSale: 3,
  have: 400,
  want: 900,
  rating: { average: 4.33, count: 27 },
};

function marketRelease(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const fixture = releaseById(Number(request.params.id));
  if (!fixture) return { status: 404, body: { message: "Release not found." } };
  const release: DiscogsRelease = {
    id: fixture.id,
    title: fixture.title,
    lowest_price: MARKET.lowestPrice,
    num_for_sale: MARKET.numForSale,
    community: { have: MARKET.have, want: MARKET.want, rating: MARKET.rating },
    videos: fixture.videos.map((video) => ({
      uri: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.title,
      duration: video.seconds,
      embed: video.embed,
    })),
  };
  return { status: 200, body: release };
}

/** The account's lists, its private ones only for its own token, all on one page. */
function userLists(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const account = accountNamed(request.params.user);
  if (!account) return { status: 404, body: { message: "User does not exist." } };
  const own = request.authenticatedAs === account.username;
  const lists = account.lists
    .filter((list) => list.public || own)
    .map((list) => ({ id: list.id, name: list.name, public: list.public }));
  const page: DiscogsUserListsPage = { pagination: pagination(1, lists.length), lists };
  return { status: 200, body: page };
}

/** A list and its releases; a private list is found only with its owner's token. */
function listItems(_fakes: FakeServices, request: FakeRequest): FakeAnswer {
  const id = Number(request.params.id);
  const owner = ACCOUNTS.find((account) => account.lists.some((list) => list.id === id));
  const list = owner?.lists.find((candidate) => candidate.id === id);
  if (!owner || !list || (!list.public && request.authenticatedAs !== owner.username))
    return { status: 404, body: { message: "The requested resource was not found." } };
  const body: DiscogsList = {
    id: list.id,
    name: list.name,
    public: list.public,
    items: list.items.map((releaseId) => listItem(releaseId)),
  };
  return { status: 200, body };
}

function listItem(releaseId: number): DiscogsList["items"][number] {
  const fixture = releaseById(releaseId);
  if (!fixture) throw new Error(`release ${releaseId} is not in the fixture catalogue`);
  return {
    id: releaseId,
    type: "release",
    display_title: `${fixture.artists.join(", ")} - ${fixture.title}`,
    comment: "",
  };
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

const USAGE = `usage: node tools/dev/fake-services.ts [<discogs_YYYYMMDD_releases.xml.gz>]
         [--port 4567] [--mbps 40] [--checksum <sha256>] [--wrong-checksums 0]

Serves the end-to-end tests' fakes on 127.0.0.1 for a rehearsal by hand: the Discogs API with
the test accounts (token e2e-token-dj for dj), YouTube's oEmbed, and data.discogs.com listing the
dump given, sent at --mbps MiB per second. Without --checksum the dump is hashed first; the first
--wrong-checksums reads of CHECKSUM.txt name another hash. Start Digga with the addresses printed
and a throwaway DIGGA_DATA_DIR and DIGGA_DUMPS_DIR.`;

/** Run as a program: the fakes until Ctrl-C, with each request and problem on the console. */
async function serveRehearsal(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string", default: "4567" },
      mbps: { type: "string", default: "40" },
      checksum: { type: "string" },
      "wrong-checksums": { type: "string", default: "0" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const port = positiveNumber(values.port, "--port");
  const bytesPerSecond = positiveNumber(values.mbps, "--mbps") * 1024 * 1024;
  const wrongChecksums = Number(values["wrong-checksums"]);
  if (!Number.isInteger(wrongChecksums) || wrongChecksums < 0)
    throw new Error(`--wrong-checksums ${values["wrong-checksums"]}: not a count\n\n${USAGE}`);
  const file = positionals[0];
  if (file && !values.checksum) console.log(`hashing ${path.basename(file)}…`);
  const dump = file ? await fileDump(file, values.checksum) : null;

  const fakes = await FakeServices.start({
    port,
    onAnswered: (request) => console.log(requestLine(request)),
    onViolation: (problem) => console.error(`problem: ${problem}`),
  });
  if (dump) {
    fakes.dumps.list(dump);
    fakes.dumps.set({ bytesPerSecond, wrongChecksums });
  }
  console.log(rehearsalSummary(fakes, dump, values.mbps));
}

/** "GET dumps /?download=data/2026/…" once the fake has answered, with the time it took. */
function requestLine(request: FakeRequest): string {
  const query = new URLSearchParams(request.query).toString();
  const target = query === "" ? request.path : `${request.path}?${decodeURIComponent(query)}`;
  const ms = (request.answeredAt ?? request.arrivedAt) - request.arrivedAt;
  return `${request.method} ${request.service} ${target} (${ms} ms)`;
}

function positiveNumber(text: string, option: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${option} ${text}: not a positive number\n\n${USAGE}`);
  return value;
}

function rehearsalSummary(fakes: FakeServices, dump: DumpSource | null, mbps: string): string {
  const { urls } = fakes;
  const listed = dump ? `${dump.name} (${listingSize(dump.bytes)}) at ${mbps} MiB/s` : "nothing";
  return [
    `fake services on http://127.0.0.1:${fakes.port}; data.discogs.com lists ${listed}`,
    `DIGGA_DUMPS_URL=${urls.dataDumps}`,
    `DIGGA_DISCOGS_API_URL=${urls.discogsApi}`,
    `DIGGA_YOUTUBE_OEMBED_URL=${urls.youtubeOembed}`,
  ].join("\n");
}

const runAsProgram =
  process.argv[1] !== undefined &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (runAsProgram) {
  serveRehearsal(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
