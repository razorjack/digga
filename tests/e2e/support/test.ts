import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type TestInfo } from "@playwright/test";
import { FakeServices } from "./fakes.ts";
import { WebApp } from "./hosts/web.ts";
import type { ServiceUrls } from "./spawn.ts";
import { copyTemplate, type TemplateName, Templates, updateConfig } from "./templates.ts";

export { expect } from "@playwright/test";

export interface DiggaOptions {
  template: TemplateName;
  sandbox: boolean;
  /** A token saved through the API before the page opens. */
  savedToken: string | null;
  /** Replaces a service's address, as GUARD-01 does; the guard still allows only the fakes. */
  serviceUrls: Partial<ServiceUrls>;
  /** Installs Playwright's clock before the app starts, so the test can pause and run it. */
  clock: boolean;
}

const DEFAULT_OPTIONS: DiggaOptions = {
  template: "small",
  sandbox: false,
  savedToken: null,
  serviceUrls: {},
  clock: false,
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
    updateConfig(library.configFile, (config) => ({ ...config, sandbox: options.sandbox }));
    const work = path.join(folder, "work");
    fs.mkdirSync(work);
    const app = await WebApp.launch({
      browser,
      savedToken: options.savedToken,
      clock: options.clock,
      environment: {
        root: runRoot,
        cwd: work,
        home: path.join(folder, "home"),
        library,
        allowedPort: fakes.port,
        serviceUrls: { ...fakes.urls, ...options.serviceUrls },
      },
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
}
