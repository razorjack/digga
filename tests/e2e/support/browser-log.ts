import type { BrowserContext } from "@playwright/test";
import { type BrowserGuardLog, emptyGuardLog } from "./browser-guard.ts";

/**
 * Problems a test causes on purpose (docs/E2E_TESTING.md, "Failure artifacts"). Each pattern is
 * matched against the entry as the log records it, such as "POST /api/verdicts".
 */
export interface ExpectedProblems {
  /** Requests a fault route aborted: "METHOD /api/path". */
  aborted?: RegExp[];
  /** /api responses of 400 or above: "METHOD /api/path answered 502". */
  apiErrors?: RegExp[];
  /** console.error messages, with the page's URL in brackets. */
  consoleErrors?: RegExp[];
  pageErrors?: RegExp[];
}

type ProblemKind = keyof ExpectedProblems;

const PROBLEM_KINDS: ProblemKind[] = ["aborted", "apiErrors", "consoleErrors", "pageErrors"];

/** Chromium logs a failed /api response this way; the API status check reports those. */
const FAILED_RESPONSE_MESSAGE = "Failed to load resource: the server responded with a status of";

/**
 * What the browser did over every launch of one test: its /api requests and what went wrong.
 * Each context the host opens is watched, and the entries stay after it closes, so a relaunch
 * cannot hide an earlier problem.
 */
export class BrowserLog {
  readonly guard: BrowserGuardLog = emptyGuardLog();
  /** The page's /api requests, as "METHOD /api/path", for negative checks. */
  readonly apiRequests: string[] = [];
  readonly #found: Record<ProblemKind, string[]> = {
    aborted: [],
    apiErrors: [],
    consoleErrors: [],
    pageErrors: [],
  };
  readonly #expected: Required<ExpectedProblems> = {
    aborted: [],
    apiErrors: [],
    consoleErrors: [],
    pageErrors: [],
  };

  watch(context: BrowserContext): void {
    context.on("weberror", (error) => this.#found.pageErrors.push(String(error.error())));
    context.on("console", (message) => {
      if (message.type() !== "error" || message.text().startsWith(FAILED_RESPONSE_MESSAGE)) return;
      this.#found.consoleErrors.push(`${message.text()} (${message.location().url})`);
    });
    context.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/api/")) this.apiRequests.push(`${request.method()} ${pathname}`);
    });
    context.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith("/api/") && response.status() >= 400)
        this.#found.apiErrors.push(
          `${response.request().method()} ${pathname} answered ${response.status()}`,
        );
    });
  }

  recordAbort(request: string): void {
    this.#found.aborted.push(request);
  }

  expect(problems: ExpectedProblems): void {
    for (const kind of PROBLEM_KINDS) this.#expected[kind].push(...(problems[kind] ?? []));
  }

  /** What the test did not declare; the fixture fails the test on any. */
  undeclared(): string[] {
    const { refused, redirects, webSockets } = this.guard;
    return [
      ...refused.map((url) => `the browser requested ${url}`),
      ...redirects.map((hop) => `the app redirected ${hop}`),
      ...webSockets.map((url) => `the browser opened a WebSocket to ${url}`),
      ...this.#undeclared("aborted").map((request) => `a fault route aborted ${request}`),
      ...this.#undeclared("apiErrors"),
      ...this.#undeclared("pageErrors").map((error) => `page error: ${error}`),
      ...this.#undeclared("consoleErrors").map((message) => `console error: ${message}`),
    ];
  }

  #undeclared(kind: ProblemKind): string[] {
    const expected = this.#expected[kind];
    return this.#found[kind].filter((entry) => !expected.some((pattern) => pattern.test(entry)));
  }
}
