import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type Violation = AxeResults["violations"][number];

/** Impacts that fail a scan; moderate and minor findings stay in the attached results. */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * Rules that fail a scan whatever their impact: the page's one `h1` and unique landmark names,
 * which the step titles and Settings' regions rely on (docs/e2e/scenarios/accessibility.md).
 */
const FAILING_RULES = new Set(["landmark-unique", "page-has-heading-one"]);

/**
 * Scans the page as it is now with axe and fails on serious and critical violations, and on the
 * two rules above. The full result is attached to the test under the state's name. Scan a state
 * only once it has settled: axe reads the DOM at one moment.
 */
export async function expectNoAxeViolations(page: Page, state: string): Promise<AxeResults> {
  const results = await new AxeBuilder({ page }).analyze();
  await attachResults(state, results);
  const failing = results.violations.filter(isFailing);
  expect(failing.map(describeViolation), `axe violations in ${state}`).toEqual([]);
  return results;
}

/**
 * Scans the page's colour contrast in the light scheme, then puts the dark scheme back. The
 * other rules read the same DOM in both schemes, so only the colours are scanned again.
 */
export async function expectLightContrast(page: Page, state: string): Promise<AxeResults> {
  await emulateColorScheme(page, "light");
  try {
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    await attachResults(`${state} (light)`, results);
    const failing = results.violations.filter(isFailing);
    expect(failing.map(describeViolation), `axe violations in ${state} (light)`).toEqual([]);
    return results;
  } finally {
    await emulateColorScheme(page, "dark");
  }
}

/**
 * The scans of a settled state: every rule in the dark scheme, then the light scheme's colours.
 * The light scan costs about as much as the full one, since contrast is axe's slowest rule, so a
 * state drawn with the same components as one scanned already skips it (`lightScheme: false`).
 */
export async function expectAccessible(
  page: Page,
  state: string,
  options: { lightScheme?: boolean } = {},
): Promise<void> {
  await expectNoAxeViolations(page, state);
  if (options.lightScheme ?? true) await expectLightContrast(page, state);
}

/**
 * Chromium applies an emulated colour scheme to the page's styles at its next frame, and a
 * computed style read before then still has the other scheme's colours. The body's background
 * differs between the schemes, so its change says the styles follow the new one. A config that
 * forces one scheme (Settings > Appearance) would keep it the same; the scans use the default.
 */
async function emulateColorScheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  const background = () => getComputedStyle(document.body).backgroundColor;
  const before = await page.evaluate(background);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForFunction(
    (previous) => getComputedStyle(document.body).backgroundColor !== previous,
    before,
    { polling: 50 },
  );
}

function isFailing(violation: Violation): boolean {
  return FAILING_RULES.has(violation.id) || FAILING_IMPACTS.has(violation.impact ?? "");
}

/** The rule, its impact and each element it found, with axe's summary of what is wrong. */
function describeViolation(violation: Violation): string {
  const nodes = violation.nodes.map((node) =>
    `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`.replace(/\n\s*/g, " "),
  );
  return [`${violation.id} (${violation.impact ?? "no impact"}): ${violation.help}`, ...nodes].join(
    "\n",
  );
}

async function attachResults(state: string, results: AxeResults): Promise<void> {
  await test.info().attach(`axe ${state}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
}
