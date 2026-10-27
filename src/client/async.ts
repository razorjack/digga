/** Returns true while the answer it was handed out for is still wanted. */
export type CurrentCheck = () => boolean;

/**
 * Tells an answer still wanted from a stale one. `next()` starts a new generation, which makes
 * the checks handed out before it return false; `end()` makes every check return false, for an
 * owner that is destroyed.
 */
export class Generation {
  #count = 0;
  #ended = false;

  get ended(): boolean {
    return this.#ended;
  }

  /** Starts a new generation and returns its check. */
  next(): CurrentCheck {
    this.#count += 1;
    return this.current();
  }

  /** The check for the generation in progress, which stays true until the next one starts. */
  current(): CurrentCheck {
    const count = this.#count;
    return () => !this.#ended && count === this.#count;
  }

  /** Makes the answers to every earlier request stale, without ending. */
  invalidate(): void {
    this.#count += 1;
  }

  end(): void {
    this.#ended = true;
    this.#count += 1;
  }
}

/**
 * Runs operations one at a time, in the order they were queued. A failed operation rejects only
 * its own caller; the next one runs regardless.
 */
export class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(operation);
    this.#tail = run.catch(() => {});
    return run;
  }

  /** Settles once every operation queued so far has settled. */
  async idle(): Promise<void> {
    await this.#tail;
  }
}
