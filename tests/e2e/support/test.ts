import fs from "node:fs";
import path from "node:path";
import { test as base, type Browser, expect, type TestInfo } from "@playwright/test";
import { type Config, ConfigSchema } from "../../../src/shared/config.ts";
import type { DecisionsBackup } from "../../../src/shared/decisions-backup.ts";
import { labelsBesides } from "../fixtures/catalogue.ts";
import { writeDecisionsBackup } from "../fixtures/decisions.ts";
import {
  bulkDump,
  type DumpFile,
  type SmallDumpMonth,
  smallDump,
  writeDump,
} from "../fixtures/dump.ts";
import { FakeServices, memoryDump, type ServiceUrls } from "../../../tools/dev/fake-services.ts";
import type { DiggaHost } from "./app.ts";
import { ElectronApp, type HeldApp } from "./hosts/electron.ts";
import { WebApp } from "./hosts/web.ts";
import { type DiggaEnvironment, type DiggaLibrary, runDiggaOrThrow } from "./spawn.ts";
import { copyTemplate, type TemplateName, Templates, updateConfig } from "./templates.ts";

export { expect } from "@playwright/test";

/** Dumps the fake data.discogs.com can list as the newest. */
const LISTED_DUMPS: Record<"bulk" | "september", () => DumpFile> = {
  bulk: bulkDump,
  september: () => smallDump("september"),
};

/** Settings a test changes, section by section, on top of the template's config. */
export type ConfigOverride = {
  [Section in keyof Config]?: Partial<Config[Section]>;
};

export interface DiggaOptions {
  template: TemplateName;
  /** Written into the copied config before the server starts; ignored for `empty`. */
  config: ConfigOverride;
  /**
   * The only labels the queue digs: the config leaves every other label of the small catalogue
   * out (filters.excludeLabels), as X would. Null digs them all.
   */
  labels: string[] | null;
  /** A token saved through the API before the page opens. */
  savedToken: string | null;
  /** DISCOGS_TOKEN in the server's environment, which wins over a saved token; fake tokens only. */
  environmentToken: string | null;
  /** Replaces a service's address, as GUARD-01 does; the guard still allows only the fakes. */
  serviceUrls: Partial<ServiceUrls>;
  /** Installs Playwright's clock before the app starts, so the test can pause and run it. */
  clock: boolean;
  /** The dump data.discogs.com lists, from the app's first request on; none answers 404. */
  listedDump: keyof typeof LISTED_DUMPS | null;
  /** Small dumps in the library's dumps folder before the server starts. */
  dumpFiles: SmallDumpMonth[];
  /**
   * No DIGGA_DUMPS_DIR: the app takes the dumps folder chosen in it, else `dumps` in the data
   * folder, which library.dumpsDir then names (ELEC-15).
   */
  dumpsDirFromApp: boolean;
  /**
   * Decisions too many to give through the API, restored with `digga restore` before the server
   * starts, as the README says to restore: with the server stopped.
   */
  decisionsBackup: DecisionsBackup | null;
  /**
   * Electron only: runs while the window's first navigation is held, with the server running and
   * nothing loaded (ELEC-10, ELEC-13).
   */
  beforeRelease: ((held: HeldApp) => Promise<void>) | null;
}

const DEFAULT_OPTIONS: DiggaOptions = {
  template: "small",
  config: {},
  labels: null,
  savedToken: null,
  environmentToken: null,
  serviceUrls: {},
  clock: false,
  listedDump: null,
  dumpFiles: [],
  dumpsDirFromApp: false,
  decisionsBackup: null,
  beforeRelease: null,
};

/** Which host runs the app: a Chromium tab on `digga serve`, or the Electron app. */
export type HostName = "web" | "electron";

interface TestFixtures {
  /** What a test changes from DEFAULT_OPTIONS. */
  diggaOptions: Partial<DiggaOptions>;
  fakes: FakeServices;
  /** The test's folder in the run's temp root, deleted after the app has stopped. */
  testFolder: string;
  app: DiggaHost;
  /**
   * Another library in the test's folder, copied from a template with the default test config.
   * `app.cli(args, { library })` prepares it and `app.relaunch({ library })` moves the app to it
   * (PER-02).
   */
  newLibrary: (template: TemplateName) => Promise<DiggaLibrary>;
}

interface WorkerFixtures {
  host: HostName;
  /** The packaged app's executable the Electron host starts, or null for the repository's app. */
  electronExecutable: string | null;
  runRoot: string;
  templates: Templates;
  /** The worker's Chromium for the web host, launched on first use, so Electron workers have none. */
  webBrowser: () => Promise<Browser>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  diggaOptions: [{}, { option: true }],
  host: ["web", { option: true, scope: "worker" }],
  electronExecutable: [null, { option: true, scope: "worker" }],

  runRoot: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
    async ({}, use) => {
      const root = process.env.DIGGA_E2E_ROOT;
      if (!root) throw new Error("DIGGA_E2E_ROOT is not set; run the suite through its config");
      await use(root);
    },
    { scope: "worker" },
  ],

  templates: [
    async ({ runRoot }, use) => {
      const fakes = await FakeServices.start();
      await use(new Templates(runRoot, fakes));
      await fakes.stop();
    },
    { scope: "worker" },
  ],

  webBrowser: [
    async ({ playwright, browserName }, use) => {
      const launched: { browser?: Promise<Browser> } = {};
      // Playwright's own worker fixture gives this launch the project's launch options.
      await use(() => (launched.browser ??= playwright[browserName].launch()));
      if (launched.browser) await (await launched.browser).close();
    },
    { scope: "worker" },
  ],

  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  fakes: async ({}, use) => {
    const fakes = await FakeServices.start();
    await use(fakes);
    await fakes.stop();
  },

  testFolder: async ({ runRoot }, use) => {
    const folder = fs.mkdtempSync(path.join(runRoot, "test-"));
    await use(folder);
    fs.rmSync(folder, { recursive: true, force: true });
  },

  app: async (
    {
      host,
      electronExecutable,
      webBrowser,
      fakes,
      templates,
      runRoot,
      testFolder: folder,
      diggaOptions,
    },
    use,
    testInfo,
  ) => {
    const options = { ...DEFAULT_OPTIONS, ...diggaOptions };
    const environment = await prepareEnvironment(options, { folder, runRoot, fakes, templates });
    const app = await launchHost(host, {
      options,
      environment,
      folder,
      electronExecutable,
      webBrowser,
      testInfo,
    });
    await use(app);

    const problems = [...(await app.undeclaredProblems()), ...fakes.violations];
    if (problems.length > 0 || testInfo.status !== testInfo.expectedStatus)
      await attachArtifacts(app, fakes, testInfo);
    await app.close();
    expect(problems, "problems the test did not declare").toEqual([]);
  },

  newLibrary: async ({ templates, testFolder }, use) => {
    let count = 0;
    await use(async (template) => {
      count += 1;
      const folder = path.join(testFolder, `library-${count + 1}`);
      const library = copyTemplate(await templates.folder(template), folder);
      if (template !== "empty")
        updateConfig(library.configFile, (config) =>
          testConfig(config, { ...DEFAULT_OPTIONS, template }),
        );
      return library;
    });
  },
});

/**
 * The test's library from its template, its home and working folder, and the environment a Digga
 * process gets, with what the options put there before the app starts.
 */
async function prepareEnvironment(
  options: DiggaOptions,
  test: { folder: string; runRoot: string; fakes: FakeServices; templates: Templates },
): Promise<DiggaEnvironment> {
  const { folder, fakes } = test;
  const copied = copyTemplate(
    await test.templates.folder(options.template),
    path.join(folder, "library"),
  );
  const library = options.dumpsDirFromApp
    ? { ...copied, dumpsDir: path.join(copied.dataDir, "dumps") }
    : copied;
  if (options.template !== "empty")
    updateConfig(library.configFile, (config) => testConfig(config, options));
  for (const month of options.dumpFiles) writeDump(library.dumpsDir, smallDump(month));
  if (options.listedDump) fakes.dumps.list(memoryDump(LISTED_DUMPS[options.listedDump]()));
  const work = path.join(folder, "work");
  fs.mkdirSync(work);
  const home = path.join(folder, "home");
  const environment: DiggaEnvironment = {
    root: test.runRoot,
    cwd: work,
    home,
    library,
    allowedPort: fakes.port,
    serviceUrls: { ...fakes.urls, ...options.serviceUrls },
    token: checkedToken(options.environmentToken),
    dumpsDirFromApp: options.dumpsDirFromApp,
  };
  if (options.decisionsBackup) {
    const file = writeDecisionsBackup(path.join(folder, "given"), options.decisionsBackup);
    await runDiggaOrThrow(["restore", file], environment);
  }
  return environment;
}

/** The app on the project's host, prepared with the test's options (docs/e2e/HARNESS.md#the-app-host). */
async function launchHost(
  host: HostName,
  launch: {
    options: DiggaOptions;
    environment: DiggaEnvironment;
    folder: string;
    electronExecutable: string | null;
    webBrowser: () => Promise<Browser>;
    testInfo: TestInfo;
  },
): Promise<DiggaHost> {
  const { options, environment } = launch;
  if (host === "electron")
    return ElectronApp.launch({
      environment,
      executablePath: launch.electronExecutable,
      testFolder: launch.folder,
      savedToken: options.savedToken,
      clock: options.clock,
      beforeRelease: options.beforeRelease,
    });
  if (options.beforeRelease) throw new Error("beforeRelease applies to the Electron app only");
  return WebApp.launch({
    browser: await launch.webBrowser(),
    savedToken: options.savedToken,
    clock: options.clock,
    outputDir: launch.testInfo.outputDir,
    environment,
  });
}

/** Only a fake token may reach a Digga process (docs/e2e/HARNESS.md#secrets-and-the-discogs-token). */
function checkedToken(token: string | null): string | undefined {
  if (token === null) return undefined;
  if (!token.startsWith("e2e-")) throw new Error("only e2e- tokens reach a test's environment");
  return token;
}

/**
 * The test's settings on top of the template's config: the sections it changes and the labels it
 * digs. The schema parses the result, so a value the app would refuse fails here.
 */
function testConfig(config: Config, options: DiggaOptions): Config {
  const merged: Record<string, unknown> = { ...config };
  for (const [section, values] of Object.entries(options.config))
    merged[section] = { ...config[section as keyof ConfigOverride], ...values };
  const parsed = ConfigSchema.parse(merged);
  if (options.labels === null) return parsed;
  const filters = { ...parsed.filters, excludeLabels: labelsBesides(options.labels) };
  return { ...parsed, filters };
}

/** Text an agent can read without a trace viewer (docs/e2e/AUTHORING.md#failure-artifacts). */
async function attachArtifacts(
  app: DiggaHost,
  fakes: FakeServices,
  testInfo: TestInfo,
): Promise<void> {
  if (app.running) {
    const snapshot = await app.page
      .locator("body")
      .ariaSnapshot()
      .catch((error: unknown) => String(error));
    await testInfo.attach("aria-snapshot.yml", { body: snapshot, contentType: "text/yaml" });
  }
  const serverLogs = app.servers.map(
    (server, index) => `--- launch ${index + 1} ---\n${server.stdout}${server.stderr}`,
  );
  await testInfo.attach("server.log", { body: serverLogs.join("\n"), contentType: "text/plain" });
  await testInfo.attach("fake-services.json", {
    body: JSON.stringify(fakes.log, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("page-api-requests.txt", {
    body: app.log.apiRequests.join("\n"),
    contentType: "text/plain",
  });
  if (app.log.guard.fetchFailures.length > 0)
    await testInfo.attach("harness-fetch-failures.txt", {
      body: app.log.guard.fetchFailures.join("\n"),
      contentType: "text/plain",
    });
  await app.attachFailureArtifacts(testInfo);
}
