/**
 * The fused release build's health check (docs/e2e/ELECTRON.md#product-integration-requirements):
 * Playwright cannot attach to a build without the inspector, so this starts the app with no
 * preload and no hold, on an empty library in a new temp folder, with the fake services' URLs and
 * an environment built from nothing. It passes when the app logs "listening on", answers
 * GET /api/health and stops on SIGTERM. `vp run electron:package` runs it after packaging:
 *
 *   node scripts/electron-health-check.ts [path/to/Digga.app]
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { HOST_RESOLVER_RULES } from "../tests/e2e/support/browser-guard.ts";
import { FakeServices } from "../tools/dev/fake-services.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_APP = path.join(ROOT, "release", "mac-arm64", "Digga.app");
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
const STARTED = performance.now();

interface Launch {
  executable: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  logFile: string;
}

const app = path.resolve(process.argv[2] ?? RELEASE_APP);
const executable = path.join(app, "Contents", "MacOS", "Digga");
if (!fs.existsSync(executable))
  throw new Error(`${executable} does not exist; run \`vp run electron:package\` first`);

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "digga-health-")));
const fakes = await FakeServices.start();
try {
  const launch = isolatedLaunch(executable, folder, fakes);
  refuseOutside(launch, folder);
  printLaunch(launch);
  await checkHealth(launch);
  if (fakes.violations.length > 0) throw new Error(`the fakes saw: ${fakes.violations.join("; ")}`);
  console.log(`electron-health-check: ${app} started, answered /api/health and stopped`);
  fs.rmSync(folder, { recursive: true, force: true });
} catch (error) {
  console.error(`electron-health-check: failed; the run's folder is ${folder}`);
  throw error;
} finally {
  await fakes.stop();
}

/** Every path the app is given lies in the run's folder; the services are the fakes. */
function isolatedLaunch(executable: string, folder: string, fakes: FakeServices): Launch {
  const inFolder = (name: string) => path.join(folder, name);
  for (const name of ["home", "tmp", "library", "cwd"]) fs.mkdirSync(inFolder(name));
  return {
    executable,
    args: [
      `--user-data-dir=${inFolder("user-data")}`,
      "--use-mock-keychain",
      "--password-store=basic",
      HOST_RESOLVER_RULES,
    ],
    env: {
      PATH: "/usr/bin:/bin",
      HOME: inFolder("home"),
      TMPDIR: `${inFolder("tmp")}/`,
      LANG: "en_US.UTF-8",
      TZ: "UTC",
      DIGGA_DATA_DIR: inFolder("library"),
      DIGGA_DUMPS_DIR: inFolder("dumps"),
      DIGGA_CONFIG_FILE: path.join(inFolder("config"), "digga.config.json"),
      DIGGA_DUMPS_URL: fakes.urls.dataDumps,
      DIGGA_DISCOGS_API_URL: fakes.urls.discogsApi,
      DIGGA_YOUTUBE_OEMBED_URL: fakes.urls.youtubeOembed,
    },
    cwd: inFolder("cwd"),
    logFile: path.join(inFolder("user-data"), "digga.log"),
  };
}

/**
 * With productName "Digga" the app's default userData and library are the owner's, so nothing
 * starts unless every path it gets is in the run's folder and each URL is a loopback one.
 */
function refuseOutside(launch: Launch, folder: string): void {
  const userData = launch.args.find((arg) => arg.startsWith("--user-data-dir="));
  const paths: Record<string, string | undefined> = {
    "--user-data-dir": userData?.slice("--user-data-dir=".length),
    cwd: launch.cwd,
    HOME: launch.env.HOME,
    TMPDIR: launch.env.TMPDIR,
    DIGGA_DATA_DIR: launch.env.DIGGA_DATA_DIR,
    DIGGA_DUMPS_DIR: launch.env.DIGGA_DUMPS_DIR,
    DIGGA_CONFIG_FILE: launch.env.DIGGA_CONFIG_FILE,
  };
  for (const [name, value] of Object.entries(paths)) {
    const relative = value === undefined ? ".." : path.relative(folder, value);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`refused to start: ${name} (${value}) is not inside ${folder}`);
  }
  for (const [name, value] of Object.entries(launch.env))
    if (name.endsWith("_URL") && new URL(value).hostname !== "127.0.0.1")
      throw new Error(`refused to start: ${name} (${value}) is not a loopback address`);
}

function printLaunch(launch: Launch): void {
  console.log("electron-health-check: environment");
  for (const [name, value] of Object.entries(launch.env)) console.log(`  ${name}=${value}`);
  console.log(`electron-health-check: in ${launch.cwd}, running`);
  console.log(`  ${[launch.executable, ...launch.args].join(" ")}`);
}

/** Starts the app, waits for its server, asks for its health and stops it, killing it on a failure. */
async function checkHealth(launch: Launch): Promise<void> {
  const child = spawn(launch.executable, launch.args, {
    env: launch.env,
    cwd: launch.cwd,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  try {
    const origin = await waitForListening(launch.logFile, child);
    const health: unknown = await (await fetch(`${origin}/api/health`)).json();
    if (JSON.stringify(health) !== JSON.stringify({ ok: true, name: "digga" }))
      throw new Error(`GET /api/health answered ${JSON.stringify(health)}`);
    console.log(
      `electron-health-check: ${origin}/api/health answered ${JSON.stringify(health)} after ${elapsed()}`,
    );
    await stop(child, launch.logFile);
  } catch (error) {
    child.kill("SIGKILL");
    const log = fs.existsSync(launch.logFile) ? fs.readFileSync(launch.logFile, "utf8") : "";
    console.error(`--- digga.log\n${log}--- stderr\n${stderr}`);
    throw error;
  }
}

/** The packaged app logs to userData/digga.log only; its first line names the server's address. */
async function waitForListening(logFile: string, child: ChildProcess): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the app exited with ${child.exitCode}`);
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    const listening = /listening on (http:\/\/127\.0\.0\.1:\d+)$/m.exec(log);
    if (listening) return listening[1]!;
    await sleep(POLL_MS);
  }
  throw new Error(`the app logged no "listening on" within ${START_TIMEOUT_MS / 1000} s`);
}

/** SIGTERM quits through before-quit, which stops the server; the log then says "stopped". */
async function stop(child: ChildProcess, logFile: string): Promise<void> {
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(STOP_TIMEOUT_MS, "timeout" as const)]);
  if (code === "timeout")
    throw new Error(`the app did not exit within ${STOP_TIMEOUT_MS / 1000} s`);
  if (!/\] stopped$/m.test(fs.readFileSync(logFile, "utf8")))
    throw new Error(`the app exited with ${code} without logging "stopped"`);
  console.log(`electron-health-check: the app stopped and exited with ${code} after ${elapsed()}`);
}

function elapsed(): string {
  return `${((performance.now() - STARTED) / 1000).toFixed(1)} s`;
}
