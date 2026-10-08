import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ServiceUrls } from "../../../tools/dev/fake-services.ts";

/**
 * Starts every Digga process the harness needs, with the same isolation: the repository's CLI
 * under the running Node, a working directory without a .env, an environment built from nothing,
 * paths checked against the run's temp root, and the network guard loaded before the app
 * (docs/e2e/HARNESS.md#launching-processes).
 */

const CLI = fileURLToPath(new URL("../../../src/cli/digga.ts", import.meta.url));
const GUARD = pathToFileURL(fileURLToPath(new URL("./guard.ts", import.meta.url))).href;
const STOP_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 15_000;

/** Parent variables a child may need: finding programs, and the display on Linux or Windows. */
const INHERITED = [
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "DISPLAY",
  "XAUTHORITY",
  "WAYLAND_DISPLAY",
];

export interface DiggaLibrary {
  dataDir: string;
  dumpsDir: string;
  configFile: string;
}

export interface DiggaEnvironment {
  /** The run's temp root; every path Digga is given must lie inside it. */
  root: string;
  /** The working directory, which holds no .env. */
  cwd: string;
  home: string;
  library: DiggaLibrary;
  /** The fake services' port, the only one the guard lets Digga reach. */
  allowedPort: number;
  serviceUrls: ServiceUrls;
  /** DISCOGS_TOKEN, for the "token from the environment" state and template imports. */
  token?: string;
  /**
   * Leaves DIGGA_DUMPS_DIR out, so Digga resolves the dumps folder itself: the one chosen in the
   * app, else `dumps` in the data folder, which library.dumpsDir names (ELEC-15).
   */
  dumpsDirFromApp?: boolean;
}

export interface DiggaRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function spawnDigga(
  args: string[],
  environment: DiggaEnvironment,
  options: { ipc?: boolean } = {},
): ChildProcess {
  checkPaths(args, environment);
  const stdio = options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"];
  return spawn(process.execPath, [CLI, ...args], {
    cwd: environment.cwd,
    env: { ...diggaVariables(environment), NODE_OPTIONS: `--import=${GUARD}` },
    stdio: stdio as ("ignore" | "pipe" | "ipc")[],
  });
}

/** Runs a command such as `dump load` to the end. */
export async function runDigga(args: string[], environment: DiggaEnvironment): Promise<DiggaRun> {
  const child = spawnDigga(args, environment);
  const output = collectOutput(child);
  const code = await exited(child);
  return { code, stdout: output.stdout(), stderr: output.stderr() };
}

/** Runs a command to the end; one that does not exit with 0 throws with its output. */
export async function runDiggaOrThrow(
  args: string[],
  environment: DiggaEnvironment,
): Promise<DiggaRun> {
  const run = await runDigga(args, environment);
  if (run.code !== 0)
    throw new Error(`digga ${args.join(" ")} failed (${run.code}):\n${run.stdout}${run.stderr}`);
  return run;
}

/** `digga serve` on a free port, or on the one given, once it answers /api/health. */
export async function startDiggaServer(
  environment: DiggaEnvironment,
  options: { port?: number } = {},
): Promise<DiggaServer> {
  const port = String(options.port ?? 0);
  const child = spawnDigga(["serve", "--port", port], environment, { ipc: true });
  const output = collectOutput(child);
  try {
    const lines = await servingLines(child, output);
    if (lines.library !== environment.library.dataDir)
      throw new Error(`digga serve opened ${lines.library}, not ${environment.library.dataDir}`);
    const server = new DiggaServer(child, output, lines.origin);
    await server.waitForHealth();
    return server;
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

export class DiggaServer {
  readonly origin: string;
  readonly port: number;
  #child: ChildProcess;
  #output: CollectedOutput;

  constructor(child: ChildProcess, output: CollectedOutput, origin: string) {
    this.#child = child;
    this.#output = output;
    this.origin = origin;
    this.port = Number(new URL(origin).port);
  }

  get stdout(): string {
    return this.#output.stdout();
  }

  get stderr(): string {
    return this.#output.stderr();
  }

  async waitForHealth(): Promise<void> {
    const health = `http://127.0.0.1:${this.port}/api/health`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await fetch(health, { redirect: "error" }).catch(() => null);
      if (response?.ok) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`digga serve did not answer ${health}:\n${this.#output.all()}`);
  }

  /** A graceful stop over IPC: running jobs end cancelled, the database closes. */
  async stop(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    // Ctrl-C reaches the server directly, so its channel may already be closed.
    if (this.#child.connected) this.#child.send("shutdown");
    const code = await Promise.race([exited(this.#child), timeout(STOP_TIMEOUT_MS)]);
    if (code === "timeout") {
      this.#child.kill("SIGKILL");
      throw new Error(`digga serve did not stop within ${STOP_TIMEOUT_MS / 1000} s`);
    }
  }

  /** A crash: running jobs stay running until the next start marks them interrupted. */
  async crash(): Promise<void> {
    this.#child.kill("SIGKILL");
    await exited(this.#child);
  }
}

/**
 * A Digga process's whole environment, built from nothing; the guard's allowed port is in it, but
 * how the guard is loaded is the launcher's part.
 */
export function diggaVariables(environment: DiggaEnvironment): NodeJS.ProcessEnv {
  const inherited = INHERITED.filter((name) => process.env[name] !== undefined).map(
    (name) => [name, process.env[name]] as const,
  );
  const { home, library, serviceUrls } = environment;
  return {
    ...Object.fromEntries(inherited),
    DIGGA_DATA_DIR: library.dataDir,
    DIGGA_CONFIG_FILE: library.configFile,
    DIGGA_DISCOGS_API_URL: serviceUrls.discogsApi,
    DIGGA_YOUTUBE_OEMBED_URL: serviceUrls.youtubeOembed,
    DIGGA_DUMPS_URL: serviceUrls.dataDumps,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    DIGGA_LOG_LEVEL: "debug",
    DIGGA_E2E_ALLOWED_PORT: String(environment.allowedPort),
    ...(environment.token === undefined ? {} : { DISCOGS_TOKEN: environment.token }),
    ...(environment.dumpsDirFromApp ? {} : { DIGGA_DUMPS_DIR: library.dumpsDir }),
  };
}

/** The check that keeps the real library safe: it runs before the process exists. */
export function checkPaths(args: string[], environment: DiggaEnvironment): void {
  const { root, cwd, home, library } = environment;
  const named = { cwd, home, ...library };
  for (const [name, value] of Object.entries(named)) assertInside(root, value, name);
  for (const arg of args) if (path.isAbsolute(arg)) assertInside(root, arg, "an argument");
  if (args[0] === "dump" && args[1] === "census" && !args.includes("--out"))
    throw new Error("digga dump census without --out writes the shipped census in the repository");
}

export function assertInside(root: string, value: string, name: string): void {
  const relative = path.relative(root, value);
  if (!path.isAbsolute(value) || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${name} (${value}) is not inside the run's temp root ${root}`);
}

export interface CollectedOutput {
  stdout(): string;
  stderr(): string;
  all(): string;
}

export function collectOutput(child: ChildProcess): CollectedOutput {
  const streams = { stdout: "", stderr: "", all: "" };
  child.stdout?.on("data", (chunk) => {
    streams.stdout += String(chunk);
    streams.all += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    streams.stderr += String(chunk);
    streams.all += String(chunk);
  });
  return { stdout: () => streams.stdout, stderr: () => streams.stderr, all: () => streams.all };
}

/** Reads `digga serving on <url>` and `library: <dir>`; log lines may come between them. */
async function servingLines(
  child: ChildProcess,
  output: CollectedOutput,
): Promise<{ origin: string; library: string }> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lines = output.stdout().split("\n");
    const origin = lineAfter(lines, "digga serving on ");
    const library = lineAfter(lines, "library: ");
    if (origin && library) return { origin, library };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`digga serve did not start:\n${output.all()}`);
}

/** The rest of the first line that starts with the prefix. */
function lineAfter(lines: string[], prefix: string): string | undefined {
  return lines
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

export function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

export function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}
