import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "../../../src/server/config-file.ts";
import type { Config } from "../../../src/shared/config.ts";
import { DJ, SMALL } from "../fixtures/catalogue.ts";
import { writeDump } from "../fixtures/dump.ts";
import type { FakeServices } from "./fakes.ts";
import { type DiggaEnvironment, type DiggaLibrary, runDigga } from "./spawn.ts";

/**
 * Libraries built once per run with the real CLI, which each test copies (docs/E2E_TESTING.md,
 * "Libraries"). A template is built the first time a test asks for it, in a folder of its own,
 * and renamed into place; a worker that finds it there already discards its copy.
 */

export type TemplateName = "empty" | "small" | "small-account";

const BUILDERS: Record<
  TemplateName,
  (templates: Templates, environment: DiggaEnvironment) => Promise<void>
> = {
  // Nothing, not even a config file: the first start creates it, as for a new user.
  empty: async () => {},
  small: buildSmall,
  "small-account": buildSmallAccount,
};

export class Templates {
  readonly root: string;
  readonly fakes: FakeServices;

  constructor(root: string, fakes: FakeServices) {
    this.root = root;
    this.fakes = fakes;
  }

  /** The template's folder, built now unless another worker or test has built it. */
  async folder(name: TemplateName): Promise<string> {
    const target = path.join(this.root, "templates", name);
    if (fs.existsSync(target)) return target;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const build = fs.mkdtempSync(path.join(this.root, "templates", `.build-${name}-`));
    await BUILDERS[name](this, this.#buildEnvironment(build));
    publish(build, target);
    return target;
  }

  #buildEnvironment(build: string): DiggaEnvironment {
    const work = fs.mkdtempSync(path.join(this.root, "work-"));
    return {
      root: this.root,
      cwd: work,
      home: path.join(work, "home"),
      library: libraryIn(build),
      allowedPort: this.fakes.port,
      serviceUrls: this.fakes.urls,
    };
  }
}

/** The library in a template or test folder: the data folder with its config, and the dumps. */
export function libraryIn(folder: string): DiggaLibrary {
  const dataDir = path.join(folder, "data");
  return {
    dataDir,
    dumpsDir: path.join(folder, "dumps"),
    configFile: path.join(dataDir, "digga.config.json"),
  };
}

/** A test's own copy of a template. */
export function copyTemplate(template: string, folder: string): DiggaLibrary {
  fs.cpSync(template, folder, { recursive: true });
  return libraryIn(folder);
}

export function updateConfig(configFile: string, change: (config: Config) => Config): void {
  saveConfig(configFile, change(loadConfig(configFile)));
}

async function buildSmall(templates: Templates, environment: DiggaEnvironment): Promise<void> {
  const dump = path.join(templates.root, "fixtures", "discogs_20260901_releases.xml.gz");
  writeDump(dump, SMALL);
  await runOrThrow(["dump", "load", dump], environment);
}

async function buildSmallAccount(
  templates: Templates,
  environment: DiggaEnvironment,
): Promise<void> {
  fs.cpSync(await templates.folder("small"), path.dirname(environment.library.dataDir), {
    recursive: true,
  });
  updateConfig(environment.library.configFile, (config) => ({
    ...config,
    discogs: { ...config.discogs, username: DJ.username },
  }));
  // The token reaches these imports only; templates keep no credentials.
  const withToken = { ...environment, token: `e2e-token-${DJ.username}` };
  await runOrThrow(["import", "collection"], withToken);
  await runOrThrow(["import", "wantlist"], withToken);
}

async function runOrThrow(args: string[], environment: DiggaEnvironment): Promise<void> {
  const run = await runDigga(args, environment);
  if (run.code !== 0)
    throw new Error(`digga ${args.join(" ")} failed (${run.code}):\n${run.stdout}${run.stderr}`);
}

function publish(build: string, target: string): void {
  try {
    fs.renameSync(build, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
    fs.rmSync(build, { recursive: true, force: true });
  }
}
