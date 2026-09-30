import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A test download needs its size plus the 1 GiB the downloader keeps spare. */
const REQUIRED_FREE_BYTES = 2 * 1024 ** 3;

/**
 * Creates the run's temp root, which every library, home and working folder lies inside, and
 * removes it after the run. Workers find it in DIGGA_E2E_ROOT.
 */
export default function globalSetup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "digga-e2e-"));
  const stats = fs.statfsSync(root);
  const freeBytes = stats.bavail * stats.bsize;
  if (freeBytes < REQUIRED_FREE_BYTES) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(
      `The end-to-end tests need 2 GiB free in ${os.tmpdir()}; it has ${freeBytes} bytes.`,
    );
  }
  process.env.DIGGA_E2E_ROOT = root;
  return () => fs.rmSync(root, { recursive: true, force: true });
}
