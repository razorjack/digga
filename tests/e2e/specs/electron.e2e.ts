import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SettingsTab } from "../../../src/client/settings/tabs.ts";
import { homeRelative } from "../../../src/client/setup/model.ts";
import type { JobsResponse } from "../../../src/shared/api.ts";
import { type Config, DEFAULT_CONFIG } from "../../../src/shared/config.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { discogsReleaseUrl } from "../../../src/shared/discogs-urls.ts";
import type { DumpLoadProgress } from "../../../src/shared/types.ts";
import { youtubeSearchUrl } from "../../../src/shared/youtube.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { DJ, FIRST_RECORD, SECOND_RECORD, triageKeyOf } from "../fixtures/catalogue.ts";
import { bulkDump, writeDump } from "../fixtures/dump.ts";
import { SettingsPage } from "../pages/settings.ts";
import { SetupPage } from "../pages/setup.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { ElectronApp } from "../support/hosts/electron.ts";
import { type CountingListener, countingListener } from "../support/listener.ts";
import { test as base, expect } from "../support/test.ts";

/** The Electron app's own scenarios (docs/e2e/scenarios/electron.md), on the Electron host only. */
const test = base.extend<{ electron: ElectronApp }>({
  electron: async ({ app }, use) => {
    if (!(app instanceof ElectronApp)) throw new Error("the ELEC scenarios need the Electron host");
    await use(app);
  },
});

test(
  "ELEC-01 the app serves on a free port bound to 127.0.0.1 and opens its window at localhost",
  { tag: ["@ELEC-01", "@P0", "@electron"] },
  async ({ electron }) => {
    const triage = new TriagePage(electron);
    const windowUrl = new URL(electron.windowUrl);

    expect(windowUrl.hostname).toBe("localhost");
    expect(electron.server.stdout).toContain(`listening on http://127.0.0.1:${windowUrl.port}`);
    // The system chose the port; the config's is where a `digga serve` may already listen.
    expect(Number(windowUrl.port)).not.toBe(DEFAULT_CONFIG.server.port);
    const address = otherInterfaceAddress();
    if (address) expect(await connects(address, Number(windowUrl.port))).toBe(false);

    await electron.open();
    await expect(triage.record).toBeVisible();
    expect(new URL(electron.page.url()).origin).toBe(windowUrl.origin);
  },
);

test.describe("with a saved token", () => {
  test.use({ diggaOptions: { savedToken: "e2e-token-dj" } });

  test(
    "ELEC-02 the library is the one the environment names, userData the one --user-data-dir names, and nothing is written in the home folder",
    { tag: ["@ELEC-02", "@P1", "@electron"] },
    async ({ electron, testFolder }) => {
      const triage = new TriagePage(electron);
      await electron.open();
      await expect(triage.record).toBeVisible();
      const userData = fs.realpathSync(electron.userDataDir);
      const { dataDir, dumpsDir } = electron.library;

      expect(
        await electron.electronApp.evaluate(({ app }) => ({
          userData: app.getPath("userData"),
          sessionData: app.getPath("sessionData"),
          crashDumps: app.getPath("crashDumps"),
        })),
      ).toEqual({
        userData,
        sessionData: path.join(userData, "Chromium"),
        crashDumps: path.join(userData, "Crashpad"),
      });
      expect(fs.readdirSync(userData).sort()).toEqual(["Chromium", "Crashpad", "digga.log"]);
      const log = fs.readFileSync(path.join(userData, "digga.log"), "utf8");
      expect(log).toContain(`library: ${dataDir}, dumps: ${dumpsDir}`);
      // The token file is the library's (decision 152); Chromium's files stay in userData.
      expect(fs.readdirSync(dataDir).sort()).toEqual([
        "backups",
        "digga.config.json",
        "digga.lock",
        "digga.sqlite",
        "digga.sqlite-shm",
        "digga.sqlite-wal",
        "secrets.env",
      ]);
      const secrets = fs.readFileSync(path.join(dataDir, "secrets.env"), "utf8");
      expect(secrets).toMatch(/^DISCOGS_TOKEN_ENCRYPTED=/m);
      expect(secrets).not.toContain("e2e-token-dj");
      expect(writtenInHomeFolder(electron, testFolder)).toEqual([]);
    },
  );
});

test.describe("with records in Twelves", () => {
  test.use({
    diggaOptions: { savedToken: "e2e-token-dj", config: { discogs: { username: DJ.username } } },
  });

  test(
    "ELEC-04 O, S, Y and the discogs.com link go to shell.openExternal and open no window",
    { tag: ["@ELEC-04", "@P1", "@electron"] },
    async ({ electron }) => {
      const triage = new TriagePage(electron);
      const twelves = new TwelvesPage(electron);
      const second = triageKeyOf(SECOND_RECORD);
      await electron.given.verdicts(datedVerdicts([{ release: SECOND_RECORD, status: "maybe" }]));
      await electron.open();
      const firstSearch = youtubeSearchUrl(
        `${FIRST_RECORD.artists.join(", ")} ${FIRST_RECORD.title}`,
      );

      expect(await triage.openOnDiscogs()).toBe(discogsReleaseUrl(FIRST_RECORD.id));
      expect(await triage.searchYouTube()).toBe(firstSearch);
      await twelves.open();
      await twelves.select(second);
      expect(await twelves.searchYouTube()).toBe(
        youtubeSearchUrl(`${SECOND_RECORD.artists.join(", ")} ${SECOND_RECORD.title}`),
      );
      const link = twelves.record(second).getByRole("link");
      expect(await electron.expectExternalOpen(() => link.click())).toBe(
        discogsReleaseUrl(SECOND_RECORD.id),
      );

      expect(electron.electronApp.windows()).toEqual([electron.page]);
      expect(
        await electron.electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      ).toBe(1);
      expect(electron.page.url()).toMatch(/#\/twelves$/);
      const opened = [...electron.server.stdout.matchAll(/\] opening (\S+) in the browser$/gm)];
      expect(opened.map((match) => match[1])).toEqual([
        discogsReleaseUrl(FIRST_RECORD.id),
        firstSearch,
        youtubeSearchUrl(`${SECOND_RECORD.artists.join(", ")} ${SECOND_RECORD.title}`),
        discogsReleaseUrl(SECOND_RECORD.id),
      ]);
    },
  );
});

test(
  "ELEC-05 an export saves through will-download into the folder set for it and completes",
  { tag: ["@ELEC-05", "@P1", "@electron"] },
  async ({ electron }) => {
    const settings = new SettingsPage(electron);
    await electron.given.verdict({
      key: triageKeyOf(FIRST_RECORD),
      status: "candidate",
      releaseId: FIRST_RECORD.id,
    });
    await settings.open("backups");

    const csv = await electron.expectDownload(() =>
      settings.exports.getByRole("link", { name: "verdicts (CSV)" }).click(),
    );

    expect(csv.path).toBe(path.join(electron.downloadsDir, csv.name));
    expect(fs.readFileSync(csv.path, "utf8")).toContain(triageKeyOf(FIRST_RECORD));
    const { downloads, openDialogs } = await electron.recorded();
    expect(downloads).toEqual([{ name: csv.name, path: csv.path, state: "completed" }]);
    expect(openDialogs).toEqual([]);
    // The app's own will-download handler saw the same download end.
    await expect
      .poll(() => electron.server.stdout)
      .toContain(`download of ${csv.name} completed: ${csv.path}`);
    expect(electron.page.url()).toMatch(/#\/settings\/backups$/);
  },
);

test.describe("with an account to import", () => {
  test.use({
    diggaOptions: { savedToken: "e2e-token-dj", config: { discogs: { username: DJ.username } } },
  });

  test(
    "ELEC-06 the Library menu opens the Settings tab that starts each job, where the job runs and reports",
    { tag: ["@ELEC-06", "@P2", "@electron"] },
    async ({ electron }) => {
      const settings = new SettingsPage(electron);
      const menuTabs: [string, SettingsTab][] = [
        ["Update the Catalogue…", "library"],
        ["Import from Discogs…", "discogs"],
        ["Back Up…", "backups"],
      ];
      await electron.open();

      for (const [item, tab] of menuTabs) {
        await clickMenuItem(electron, "Library", item);
        await expect(electron.page, item).toHaveURL(new RegExp(`#/settings/${tab}$`));
        await expect(settings.tabLink(tab), item).toHaveAttribute("aria-current", "page");
      }
      await clickMenuItem(electron, "Library", "Import from Discogs…");
      const wantlist = await settings.startJob(
        settings.imports.getByRole("button", { name: "Wantlist" }),
      );
      await settings.waitForJob(wantlist, "done");
      await expect(settings.job(wantlist)).toContainText(`${DJ.wantlist.length} items`);

      await clickMenuItem(electron, "Library", "Back Up…");
      const backedUp = electron.page.waitForResponse((response) =>
        isRequest(response, "POST", "/api/backups"),
      );
      await settings.backups.getByRole("button", { name: "Back up now" }).click();
      expect((await backedUp).ok()).toBe(true);
      await expect(settings.backups.getByText("Backup saved.", { exact: true })).toBeVisible();

      await clickMenuItem(electron, "Digga", "Settings…");
      await expect(electron.page).toHaveURL(/#\/settings$/);
    },
  );

  test(
    "ELEC-14 a quit while the app starts shows no startup error, and the app exits",
    { tag: ["@ELEC-14", "@P1", "@electron"] },
    async ({ electron, fakes }) => {
      // The stop waits for the import's page, so the window's navigation fails while it stops.
      const wantlist = fakes.hold("GET /users/:user/wants");

      const code = await electron.quitDuringStart({
        beforeQuit: async (api) => {
          await api.send("POST", "/api/jobs/import/wantlist");
          await wantlist.received;
        },
        afterNavigationFailed: () => wantlist.release(),
      });

      const launch = electron.server;
      // The context's guard fetches the page's requests, so the refusal reaches the window as ERR_FAILED.
      expect(launch.stderr).toMatch(
        /the first navigation failed: ERR_FAILED \(-2\) loading 'http:\/\/localhost:\d+\/'/,
      );
      expect(launch.stderr).not.toContain("digga-e2e preload: message box");
      expect(launch.stdout).toContain("stopping: cancelled 1 running job(s)");
      expect(launch.stdout).toMatch(/\] stopped$/m);
      expect(code).toBe(0);
    },
  );
});

test.describe("on a new library", () => {
  test.use({ diggaOptions: { template: "empty", listedDump: "bulk" } });

  test(
    "ELEC-07 quitting during the download and the load asks first; Cancel keeps them, Quit stops them",
    { tag: ["@ELEC-07", "@P1", "@electron"] },
    async ({ electron, fakes }) => {
      const setup = new SetupPage(electron);
      const point = fakes.dumps.checkpoint("100-to-dig");
      fakes.dumps.holdAt(point.name);
      await electron.open();
      await setup.fetchCatalogue();
      await expect.poll(() => downloadedBytes(electron)).toBe(point.offset);

      const asked = await electron.expectMessageBox(() => requestQuit(electron), "Cancel");

      expect(asked).toEqual({
        type: "warning",
        message: "Quit while Digga downloads the catalogue?",
        detail: expect.stringMatching(
          /^The download stops at [\d.]+ KB of [\d.]+ KB\. Discogs does not resume downloads, so the next one starts from the beginning\.$/,
        ),
        buttons: ["Quit", "Cancel"],
        answer: "Cancel",
      });
      expect(await jobStatuses(electron)).toEqual([["dump_download", "running"]]);
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();
      await setup.waitForRecordsToDig(point.recordsToDig);

      // The host quits as Cmd+Q does; the preload answers the question with its first button, Quit.
      await electron.relaunch();
      const quitting = electron.servers[0]!;
      expect(quitting.stderr).toMatch(
        /message box: \{"type":"warning","message":"Quit while Digga downloads and loads the catalogue\?","detail":"The download stops at .*\. The load stops at \d+%\. The releases it has kept stay, and the next load reads the catalogue from the start\.","buttons":\["Quit","Cancel"\],"answer":"Quit"\}/,
      );
      expect(quitting.stdout).toContain("stopping: cancelled 2 running job(s)");
      expect(await jobStatuses(electron)).toEqual([
        ["dump_load", "cancelled"],
        ["dump_download", "cancelled"],
      ]);
      await electron.open("#/setup");
      await expect(
        setup.root.getByText("The catalogue stopped loading.", { exact: true }),
      ).toBeVisible();
      await expect(setup.button("Pick up")).toBeVisible();

      // With nothing running, quitting asks nothing.
      await electron.relaunch();
      expect(electron.servers[1]!.stderr).not.toContain("message box");
    },
  );

  test(
    "ELEC-08 the Dock shows the download and the load, the Mac stays awake while they run, and a load that ends unseen is announced",
    { tag: ["@ELEC-08", "@P2", "@electron"] },
    async ({ electron, fakes }) => {
      const setup = new SetupPage(electron);
      const point = fakes.dumps.checkpoint("100-to-dig");
      fakes.dumps.holdAt(point.name);
      await electron.open();
      expect((await electron.recorded()).powerSaveBlockers).toEqual([]);

      await setup.fetchCatalogue();
      await expect.poll(() => downloadedBytes(electron)).toBe(point.offset);
      await expect
        .poll(() => lastProgressBar(electron))
        .toBe(point.offset / fakes.dumps.listed.bytes);
      const [blocker] = (await electron.recorded()).powerSaveBlockers;
      expect(blocker).toEqual({
        call: "start",
        type: "prevent-app-suspension",
        id: expect.any(Number),
      });
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();
      await setup.waitForRecordsToDig(point.recordsToDig);
      await electron.setFocused(false);
      fakes.dumps.release();
      await setup.waitForCatalogue();

      await expect.poll(() => lastProgressBar(electron)).toBe(-1);
      expect((await electron.recorded()).powerSaveBlockers).toEqual([
        blocker,
        { call: "stop", id: blocker!.id },
      ]);
      const kept = await loadKept(electron);
      await expect
        .poll(() => electron.server.stdout)
        .toContain(`notification: The catalogue is in: ${formatCount(kept)} releases kept.`);
    },
  );

  test(
    "ELEC-08 a load that fails while the window is focused clears the Dock, lets the Mac sleep and announces nothing",
    { tag: ["@ELEC-08", "@P2", "@electron"] },
    async ({ electron, fakes }) => {
      const setup = new SetupPage(electron);
      const point = fakes.dumps.checkpoint("100-to-dig");
      fakes.dumps.holdAt(point.name);
      await electron.open();
      await setup.fetchCatalogue();
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();
      await setup.waitForRecordsToDig(point.recordsToDig);

      await electron.setFocused(true);
      fakes.dumps.set({ failAfterBytes: point.offset });
      fakes.dumps.release();
      await expect(setup.downloadStopped).toBeVisible();

      expect(await jobStatuses(electron)).toEqual([
        ["dump_load", "failed"],
        ["dump_download", "failed"],
      ]);
      await expect.poll(() => lastProgressBar(electron)).toBe(-1);
      const blockers = (await electron.recorded()).powerSaveBlockers;
      expect(blockers.map((blocker) => blocker.call)).toEqual(["start", "stop"]);
      expect(electron.server.stdout).toContain("the computer may sleep again");
      expect(electron.server.stdout).not.toContain("notification:");
    },
  );

  test(
    "ELEC-09 a dump file the user has loads from where it is, without a download, and is never offered for deletion",
    { tag: ["@ELEC-09", "@P2", "@electron"] },
    async ({ electron, fakes, testFolder }) => {
      const setup = new SetupPage(electron);
      const file = writeDump(path.join(testFolder, "my dumps"), bulkDump());
      const chosenLine = `Digga reads releases from ${homeRelative(file)}, the file you chose`;
      await electron.open();

      // The preload cancels a dialog it has no answer for; step 1 stays as it was.
      await setup.useDumpFile();
      await expect(setup.button("Fetch the catalogue")).toBeEnabled();
      await setup.expectStep("catalogue");

      await electron.answerOpenDialog([file]);
      await setup.useDumpFile();
      await setup.expectStep("discogs");
      await setup.back("catalogue");
      await expect(setup.root.getByText(chosenLine)).toBeVisible();
      await expect(setup.button("Use a dump file I have")).toBeHidden();
      await setup.continueFromCatalogue();
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();
      await setup.waitForCatalogue();

      const dialog = {
        title: "Use a dump file you have",
        properties: ["openFile"],
        filters: [{ name: "Discogs releases dump", extensions: ["xml.gz"] }],
      };
      expect((await electron.recorded()).openDialogs).toEqual([
        { ...dialog, filePaths: [] },
        { ...dialog, filePaths: [file] },
      ]);
      expect((await electron.api.get<Config>("/api/settings")).setup.dumpFile).toBe(file);
      expect(fakes.dumps.transfers).toBe(0);
      expect(await jobStatuses(electron)).toEqual([["dump_load", "done"]]);
      await expect(
        setup.root.getByText(
          `Digga read the catalogue from ${homeRelative(file)}, the file you chose, and leaves it where it is.`,
        ),
      ).toBeVisible();
      await expect(setup.button("Delete it")).toBeHidden();
      expect(fs.existsSync(file)).toBe(true);
      expect(dumpsIn(electron.library.dumpsDir)).toEqual([]);
    },
  );
});

test.describe("on a new library without DIGGA_DUMPS_DIR", () => {
  test.use({ diggaOptions: { template: "empty", listedDump: "bulk", dumpsDirFromApp: true } });

  test(
    "ELEC-15 a disk short of space offers another folder, which the app keeps and downloads into",
    { tag: ["@ELEC-15", "@P2", "@electron"] },
    async ({ electron, fakes, testFolder }) => {
      const setup = new SetupPage(electron);
      const alert = setup.alert(/^The catalogue needs/);
      const dump = fakes.dumps.listed;
      const chosen = path.join(testFolder, "other disk", "Digga dumps");
      fs.mkdirSync(chosen, { recursive: true });
      // More than any disk has, so the real free space is short whatever the machine.
      fakes.dumps.list(dump, { listedBytes: 900 * 1024 ** 4 });
      await electron.open();
      await expect(alert).toContainText(homeRelative(electron.library.dumpsDir));
      await expect(alert).toContainText("Free some space, or choose a folder on another disk.");
      await expect(alert).not.toContainText("DIGGA_DUMPS_DIR");

      // The preload cancels a dialog it has no answer for, and the folder stays.
      await setup.chooseDumpsFolder();
      await expect(alert).toContainText(homeRelative(electron.library.dumpsDir));
      await electron.answerOpenDialog([chosen]);
      await setup.chooseDumpsFolder();
      await expect(alert).toContainText(homeRelative(chosen));
      await expect(setup.button("Fetch the catalogue")).toBeDisabled();

      const dialog = {
        title: "Choose a folder for the catalogue",
        properties: ["openDirectory", "createDirectory"],
      };
      expect((await electron.recorded()).openDialogs).toEqual([
        { ...dialog, filePaths: [] },
        { ...dialog, filePaths: [chosen] },
      ]);
      const saved = path.join(electron.library.dataDir, "dumps-folder.json");
      expect(JSON.parse(fs.readFileSync(saved, "utf8"))).toEqual({ dumpsDir: chosen });

      // The next launch reads the listing again, now at the dump's own size, and keeps the folder.
      fakes.dumps.list(dump);
      await electron.relaunch();
      expect(electron.server.stdout).toContain(`dumps: ${chosen}`);
      await electron.open();
      await expect(
        setup.root.getByText(/^Discogs publishes every release in one file a month\./),
      ).toContainText(homeRelative(chosen));
      await setup.fetchCatalogue();
      await expect.poll(() => fs.existsSync(path.join(chosen, dump.name))).toBe(true);
      expect(dumpsIn(electron.library.dumpsDir)).toEqual([]);
    },
  );
});

for (const scheme of ["light", "dark"] as const)
  test.describe(`with the ${scheme} scheme saved`, () => {
    const atHold = { themeSource: "" };
    test.use({
      diggaOptions: {
        config: { appearance: { colorScheme: scheme } },
        beforeRelease: async ({ electronApp }) => {
          atHold.themeSource = await electronApp.evaluate(
            ({ nativeTheme }) => nativeTheme.themeSource,
          );
        },
      },
    });

    test(
      `ELEC-10 nativeTheme follows the saved ${scheme} scheme before the window loads the app`,
      { tag: ["@ELEC-10", "@P2", "@electron"] },
      async ({ electron }) => {
        const triage = new TriagePage(electron);

        expect(atHold.themeSource).toBe(scheme);
        // Without the host's emulated scheme the page sees the system's, which nativeTheme sets.
        await electron.page.emulateMedia({ colorScheme: null });
        await electron.open();
        await expect(triage.record).toBeVisible();

        expect(
          await electron.page.evaluate(
            (expected) => matchMedia(`(prefers-color-scheme: ${expected})`).matches,
            scheme,
          ),
        ).toBe(true);
      },
    );
  });

test(
  "ELEC-11 the window's user agent is Chrome's and names neither Electron nor Digga",
  { tag: ["@ELEC-11", "@P1", "@electron"] },
  async ({ electron }) => {
    const triage = new TriagePage(electron);
    const queueRead = electron.page.waitForRequest((request) =>
      new URL(request.url()).pathname.startsWith("/api/queue"),
    );
    await electron.open();
    await expect(triage.record).toBeVisible();

    const userAgent = await electron.page.evaluate(() => navigator.userAgent);
    expect(userAgent).toMatch(/ Chrome\/\d+[\d.]* Safari\/[\d.]+$/);
    expect(userAgent).not.toMatch(/electron|digga/i);
    expect(await (await queueRead).headerValue("user-agent")).toBe(userAgent);
  },
);

/** What the app was like while its window's first navigation was held. */
interface HeldState {
  windows: number;
  contentsUrl: string;
  health: number;
  mainProcess: string;
  worker: string;
  releasedAfter: number;
}

const heldTest = test.extend<{ forbidden: CountingListener; held: HeldState }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  forbidden: async ({}, use) => {
    const listener = await countingListener();
    await use(listener);
    await listener.close();
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures by destructuring.
  held: async ({}, use) => {
    await use({
      windows: -1,
      contentsUrl: "",
      health: 0,
      mainProcess: "",
      worker: "",
      releasedAfter: 0,
    });
  },
  diggaOptions: async ({ diggaOptions, forbidden, held, testFolder }, use) => {
    const probe = path.join(testFolder, "connect-probe.mjs");
    fs.writeFileSync(probe, CONNECT_PROBE);
    await use({
      ...diggaOptions,
      beforeRelease: async ({ electronApp, url }) => {
        held.windows = electronApp.windows().length;
        held.contentsUrl = await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.getURL(),
        );
        const health = new URL("/api/health", url);
        health.hostname = "127.0.0.1";
        held.health = (await fetch(health, { redirect: "error" })).status;
        held.mainProcess = await electronApp.evaluate(
          (_electron, port) =>
            fetch(`http://127.0.0.1:${port}/`).then(
              () => "connected",
              (error: Error) => String(error.cause ?? error),
            ),
          forbidden.port,
        );
        held.worker = await electronApp.evaluate(
          (_electron, { file, port }) => {
            const { Worker } = process.getBuiltinModule("node:worker_threads");
            const worker = new Worker(new URL(file), { workerData: { port } });
            return new Promise<string>((resolve) => worker.once("message", resolve));
          },
          { file: pathToFileURL(probe).href, port: forbidden.port },
        );
        held.releasedAfter = Date.now();
      },
    });
  },
});

heldTest(
  "ELEC-13 the held window loads nothing and the main process and its workers reach only the fakes; once released, the page has the routes and the fake player",
  { tag: ["@ELEC-13", "@P1", "@electron"] },
  async ({ electron, fakes, forbidden, held }) => {
    const triage = new TriagePage(electron);
    const refusal = `digga-e2e guard: refused a connection to 127.0.0.1:${forbidden.port}`;

    expect(held).toMatchObject({ windows: 0, contentsUrl: "", health: 200 });
    expect(held.mainProcess).toContain(refusal);
    expect(held.worker).toBe(`refused: ${refusal}`);
    expect(fakes.log.filter((request) => request.arrivedAt <= held.releasedAfter)).toEqual([]);

    await electron.open();
    await expect(triage.record).toBeVisible();
    await expect.poll(() => electron.youtube.players()).not.toEqual([]);
    const forbiddenUrl = `http://localhost:${forbidden.port}/`;
    electron.expectProblems({
      refused: [new RegExp(`^${forbiddenUrl}$`)],
      consoleErrors: [/^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/],
    });
    const fetched = await electron.page.evaluate(
      (url) =>
        fetch(url).then(
          () => "loaded",
          () => "failed",
        ),
      forbiddenUrl,
    );

    expect(fetched).toBe("failed");
    expect(electron.log.guard.refused).toEqual([forbiddenUrl]);
    expect(forbidden.connections()).toBe(0);
  },
);

/** A worker that connects to the port it is given and says how that went. */
const CONNECT_PROBE = `
import net from "node:net";
import { parentPort, workerData } from "node:worker_threads";
const socket = net.connect(workerData.port, "127.0.0.1");
socket.on("connect", () => {
  parentPort.postMessage("connected");
  socket.destroy();
});
socket.on("error", (error) => parentPort.postMessage("refused: " + error.message));
`;

/** Quits as Cmd+Q does: before-quit runs, and the app may ask first. */
async function requestQuit(electron: ElectronApp): Promise<void> {
  await electron.electronApp.evaluate(({ app }) => app.quit());
}

/** The bytes the download job has reported, which stop at a checkpoint the fake holds. */
async function downloadedBytes(electron: ElectronApp): Promise<number | null> {
  const { jobs } = await electron.api.get<JobsResponse>("/api/jobs");
  const download = jobs.find((job) => job.type === "dump_download");
  return download?.type === "dump_download" ? (download.progress?.receivedBytes ?? null) : null;
}

/** The value the app last gave the Dock's progress bar; undefined before it gave one. */
async function lastProgressBar(electron: ElectronApp): Promise<number | undefined> {
  return (await electron.recorded()).progressBars.at(-1)?.progress;
}

/** The releases the load kept, as the crate counts them. */
async function loadKept(electron: ElectronApp): Promise<number> {
  const progress = await loadProgress(electron);
  return (progress?.matched ?? 0) + (progress?.coverage ?? 0);
}

async function loadProgress(electron: ElectronApp): Promise<DumpLoadProgress | null> {
  const { jobs } = await electron.api.get<JobsResponse>("/api/jobs");
  const load = jobs.find((job) => job.type === "dump_load");
  return load?.type === "dump_load" ? load.progress : null;
}

/** Each job's type and status, newest first. */
async function jobStatuses(electron: ElectronApp): Promise<[string, string][]> {
  const { jobs } = await electron.api.get<JobsResponse>("/api/jobs");
  return jobs.map((job) => [job.type, job.status]);
}

function dumpsIn(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter((name) => name.endsWith(".xml.gz"));
}

/** Clicks an item of the app's menu bar as a user would, through the main process. */
async function clickMenuItem(electron: ElectronApp, menu: string, item: string): Promise<void> {
  await electron.electronApp.evaluate(
    ({ Menu }, labels) => {
      const top = Menu.getApplicationMenu()?.items.find((entry) => entry.label === labels.menu);
      const found = top?.submenu?.items.find((entry) => entry.label === labels.item);
      if (!found) throw new Error(`the menu has no ${labels.menu} › ${labels.item}`);
      found.click();
    },
    { menu, item },
  );
}

/** An address of this machine other than loopback, where a server bound to 127.0.0.1 is absent. */
function otherInterfaceAddress(): string | undefined {
  const addresses = Object.values(os.networkInterfaces()).flat();
  return addresses.find((address) => address?.family === "IPv4" && !address.internal)?.address;
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * Files the app's processes hold open for writing in the real home folder, where every userData
 * Electron could choose lies, outside the test's folder. The macOS caches and temp files the
 * system keeps for the Electron binary are in /var/folders, outside the home folder. lsof sees
 * the files open now, not those written and closed before.
 */
function writtenInHomeFolder(electron: ElectronApp, testFolder: string): string[] {
  const home = fs.realpathSync(os.userInfo().homedir);
  const folder = fs.realpathSync(testFolder);
  return openForWriting(electron.electronApp.process().pid!).filter(
    (file) => isInside(home, file) && !isInside(folder, file),
  );
}

/** The files a process and its children hold open for writing, from `lsof -F an`. */
function openForWriting(pid: number): string[] {
  const children = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).trim();
  const pids = [String(pid), ...children.split("\n").filter(Boolean)];
  const listing = execFileSync("lsof", ["-n", "-P", "-F", "an", "-p", pids.join(",")], {
    encoding: "utf8",
  });
  const files: string[] = [];
  let access = "";
  for (const line of listing.split("\n")) {
    if (line.startsWith("a")) access = line.slice(1);
    else if (line.startsWith("n/") && (access === "w" || access === "u")) files.push(line.slice(1));
  }
  return files;
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
