/** A message that clears itself a while after it is shown, unless a newer one replaced it. */
export class TimedMessage {
  text = $state<string | null>(null);
  #durationMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(durationMs: number) {
    this.#durationMs = durationMs;
  }

  show(message: string): void {
    this.hold(message);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.text === message) this.text = null;
    }, this.#durationMs);
  }

  /** Shows a message until the next one replaces it, as for progress. */
  hold(message: string): void {
    this.#stopTimer();
    this.text = message;
  }

  clear(): void {
    this.#stopTimer();
    this.text = null;
  }

  /** Stops the timer without changing the text, for an owner that is destroyed. */
  destroy(): void {
    this.#stopTimer();
  }

  #stopTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
