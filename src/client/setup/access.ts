/** What decides whether the setup has the screen to itself (docs/FIRST_RUN.md). */
export interface LibraryState {
  /** No dump load has finished yet. */
  firstRun: boolean;
  /** A dump load runs now. */
  loading: boolean;
  /** Records waiting to be dug, such as those a load that stopped had kept. */
  recordsToDig: number;
}

/** Until something can be dug, the setup keeps the toolbar to its title and the page keys quiet. */
export function pagesClosed(library: LibraryState): boolean {
  return library.firstRun && !library.loading && library.recordsToDig === 0;
}

/**
 * Whether another page sends the user to the setup: while no load has finished and none runs.
 * The app still opens on the setup, which says what stopped, but once it has shown and records
 * can be dug, the pages stay open.
 */
export function sendToSetup(library: LibraryState, setupShown: boolean): boolean {
  if (!library.firstRun || library.loading) return false;
  return !(setupShown && library.recordsToDig > 0);
}
