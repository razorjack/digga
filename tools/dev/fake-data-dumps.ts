/**
 * A stand-in for data.discogs.com that offers one releases dump from disk, at a set speed, so
 * the first run can be rehearsed without downloading 10 GB from Discogs:
 *
 *   node tools/dev/fake-data-dumps.ts ~/Downloads/discogs_20260901_releases.xml.gz --mbps 40
 *   DIGGA_DATA_DIR=/tmp/digga-rehearsal DIGGA_DUMPS_URL=http://127.0.0.1:4567/ npm run digga -- serve
 *
 * It serves the listing pages, CHECKSUM.txt and the file the way data.discogs.com does.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "4567" },
    mbps: { type: "string", default: "40" },
    checksum: { type: "string" },
  },
});

const file = positionals[0];
if (!file)
  throw new Error(
    "usage: node tools/dev/fake-data-dumps.ts <dump.xml.gz> [--mbps 40] [--port 4567]",
  );
const name = path.basename(file);
const match = /discogs_(\d{4})(\d{2})(\d{2})_releases\.xml\.gz$/.exec(name);
if (!match) throw new Error(`${name} is not named like discogs_YYYYMMDD_releases.xml.gz`);
const year = match[1]!;
const bytes = fs.statSync(file).size;
const bytesPerSecond = Number(values.mbps) * 1024 * 1024;

console.log(values.checksum ? "using the given checksum" : `hashing ${name}…`);
const checksum = values.checksum ?? (await sha256(file));

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const prefix = url.searchParams.get("prefix");
  const download = url.searchParams.get("download");
  if (prefix === "data/") return send(response, `<a href="?prefix=data%2F${year}%2F">${year}/</a>`);
  if (prefix === `data/${year}/`) return send(response, yearPage());
  if (download === `data/${year}/${name.replace("_releases.xml.gz", "_CHECKSUM.txt")}`)
    return send(response, `${checksum} ${name}\n`);
  if (download === `data/${year}/${name}`) return void serveDump(response);
  response.writeHead(404).end("not found");
});
server.listen(Number(values.port), "127.0.0.1", () =>
  console.log(`data.discogs.com stand-in on http://127.0.0.1:${values.port}/, ${values.mbps} MB/s`),
);

function yearPage(): string {
  const size = `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `<pre>${match![1]}-${match![2]}-${match![3]} 19:21:51   ${size}   <a href="?download=data%2F${year}%2F${name}">${name}</a></pre>`;
}

function send(response: http.ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html" }).end(body);
}

/** The file at the set speed: a chunk, then a pause that keeps the average there. */
async function serveDump(response: http.ServerResponse): Promise<void> {
  response.writeHead(200, { "content-length": String(bytes) });
  const started = Date.now();
  let sent = 0;
  for await (const chunk of fs.createReadStream(file!, { highWaterMark: 1024 * 1024 })) {
    if (response.destroyed) return;
    if (!response.write(chunk)) await new Promise((resolve) => response.once("drain", resolve));
    sent += (chunk as Buffer).length;
    const due = (sent / bytesPerSecond) * 1000 - (Date.now() - started);
    if (due > 0) await sleep(due);
  }
  response.end();
}

async function sha256(dump: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(dump, { highWaterMark: 4 * 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
