import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type TestInfo } from "@playwright/test";
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
import { WebApp } from "./hosts/web.ts";
import { type DiggaEnvironment, runDiggaOrThrow } from "./spawn.ts";
import { copyTemplate, type TemplateName, Templates, updateConfig } from "./templates.ts";

export { expect } from "@playwright/test";

/** Dumps the fake data.discogs.com can list as the newest. */
const LISTED_DUMPS: Record<"bulk" | "september", () => DumpFile> = {
  bulk: bulkDump,
  september: () => smallDump("september"),
};

/** Settings a test changes, section by section, on top of the template's config. */
export type ConfigOverride = {
  [Section in Exclude<keyof Config, "sandbox">]?: Partial<Config[Section]>;
};

export interface DiggaOptions {
  template: TemplateName;
  /** Ignored for `empty`, which starts with the schema defaults, the sandbox on. */
  sandbox: boolean;
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
   * Decisions too many to give through the API, restored with `digga restore` before the server
   * starts, as the README says to restore: with the server stopped.
   */
  decisionsBackup: DecisionsBackup | null;
}

const DEFAULT_OPTIONS: DiggaOptions = {
  template: "small",
  sandbox: false,
  config: {},
  labels: null,
  savedToken: null,
  environmentToken: null,
  serviceUrls: {},
  clock: false,
  listedDump: null,
  dumpFiles: [],
  decisionsBackup: null,
};

interface TestFixtures {
  /** What a test changes from DEFAULT_OPTIONS. */
  diggaOptions: Partial<DiggaOptions>;
  fakes: FakeServices;
  app: WebApp;
}

interface WorkerFixtures {
  runRoot: string;
  templates: Templates;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  diggaOptions: [{}, { option: true }],

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

  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  fakes: async ({}, use) => {
    const fakes = await FakeServices.start();
    await use(fakes);
    await fakes.stop();
  },

  app: async ({ browser, fakes, templates, runRoot, diggaOptions }, use, testInfo) => {
    const options = { ...DEFAULT_OPTIONS, ...diggaOptions };
    const folder = fs.mkdtempSync(path.join(runRoot, "test-"));
    const library = copyTemplate(
      await templates.folder(options.template),
      path.join(folder, "library"),
    );
    if (options.template !== "empty")
      updateConfig(library.configFile, (config) => testConfig(config, options));
    for (const month of options.dumpFiles) writeDump(library.dumpsDir, smallDump(month));
    if (options.listedDump) fakes.dumps.list(memoryDump(LISTED_DUMPS[options.listedDump]()));
    const work = path.join(folder, "work");
    fs.mkdirSync(work);
    const environment: DiggaEnvironment = {
      root: runRoot,
      cwd: work,
      home: path.join(folder, "home"),
      library,
      allowedPort: fakes.port,
      serviceUrls: { ...fakes.urls, ...options.serviceUrls },
      token: checkedToken(options.environmentToken),
    };
    if (options.decisionsBackup) {
      const file = writeDecisionsBackup(path.join(folder, "given"), options.decisionsBackup);
      await runDiggaOrThrow(["restore", file], environment);
    }
    const app = await WebApp.launch({
      browser,
      savedToken: options.savedToken,
      clock: options.clock,
      outputDir: testInfo.outputDir,
      environment,
    });

    await use(app);

    const problems = [...app.log.undeclared(), ...fakes.violations];
    if (problems.length > 0 || testInfo.status !== testInfo.expectedStatus)
      await attachArtifacts(app, fakes, testInfo);
    await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
    expect(problems, "problems the test did not declare").toEqual([]);
  },
});

/** Only a fake token may reach a Digga process (docs/E2E_TESTING.md, "Secrets"). */
function checkedToken(token: string | null): string | undefined {
  if (token === null) return undefined;
  if (!token.startsWith("e2e-")) throw new Error("only e2e- tokens reach a test's environment");
  return token;
}

/**
 * The test's settings on top of the template's config: the sandbox, the sections it changes and
 * the labels it digs. The schema parses the result, so a value the app would refuse fails here.
 */
function testConfig(config: Config, options: DiggaOptions): Config {
  const merged: Record<string, unknown> = { ...config, sandbox: options.sandbox };
  for (const [section, values] of Object.entries(options.config))
    merged[section] = { ...config[section as keyof ConfigOverride], ...values };
  const parsed = ConfigSchema.parse(merged);
  if (options.labels === null) return parsed;
  const filters = { ...parsed.filters, excludeLabels: labelsBesides(options.labels) };
  return { ...parsed, filters };
}

/** Text an agent can read without a trace viewer (docs/E2E_TESTING.md, "Failure artifacts"). */
async function attachArtifacts(
  app: WebApp,
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
}
