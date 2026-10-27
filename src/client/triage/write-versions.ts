/** One write of a key's value, shown before the server answers it. */
export interface VersionedWrite<Value> {
  /** No later write of the key started, and the key was not forgotten, since this one. */
  isLatest(): boolean;
  /** The value the server holds as far as the key's writes know, to show again on a failure. */
  saved(): Value;
  markSaved(value: Value): void;
}

/**
 * The writes of values shown at once and saved in the background, such as notes and track marks.
 * Only the latest write of a key may put its saved value back when it fails; a later write owns
 * the shown value until its own answer comes.
 */
export class WriteVersions<Value> {
  #entries = new Map<string, { saved: Value; version: number }>();

  /** Starts a write; `saved` is the value on the server unless an earlier write knows better. */
  begin(key: string, saved: Value): VersionedWrite<Value> {
    const entry = this.#entries.get(key) ?? { saved, version: 0 };
    entry.version += 1;
    const version = entry.version;
    this.#entries.set(key, entry);
    return {
      isLatest: () => this.#entries.get(key) === entry && entry.version === version,
      saved: () => entry.saved,
      markSaved: (value) => {
        entry.saved = value;
      },
    };
  }

  /** Forgets the key's writes, whose answers then change nothing shown. */
  forget(key: string): void {
    this.#entries.delete(key);
  }
}
