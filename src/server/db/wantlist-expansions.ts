import type {
  AddAlternativesInput,
  AlternativeAdditions,
} from "../../shared/alternative-pressings.ts";
import type { Db } from "./db.ts";
import { accountDataVersion } from "./memberships.ts";

export function expansionReceipt(db: Db, input: AddAlternativesInput): AlternativeAdditions {
  const saved = readExpansion(db, input.operationId);
  if (saved) {
    if (saved.input !== JSON.stringify(input))
      throw new Error("This operation belongs to another selection");
    return saved.result;
  }
  const result: AlternativeAdditions = {
    operationId: input.operationId,
    added: [],
    existing: [],
    errors: [],
    undone: false,
  };
  db.prepare(`INSERT INTO wantlist_expansions (id, account_version, input_json, result_json)
    VALUES (?, ?, ?, ?)`).run(
    input.operationId,
    accountDataVersion(db),
    JSON.stringify(input),
    JSON.stringify(result),
  );
  return result;
}

export function readExpansion(
  db: Db,
  id: string,
): { input: string; result: AlternativeAdditions } | null {
  const row = db
    .prepare(
      `SELECT input_json, result_json, account_version FROM wantlist_expansions WHERE id = ?`,
    )
    .get(id) as { input_json: string; result_json: string; account_version: number } | undefined;
  if (!row) return null;
  if (row.account_version !== accountDataVersion(db))
    throw new Error("The Discogs account changed; this operation cannot continue");
  return { input: row.input_json, result: JSON.parse(row.result_json) as AlternativeAdditions };
}

export function saveExpansion(db: Db, result: AlternativeAdditions): void {
  db.prepare("UPDATE wantlist_expansions SET result_json = ? WHERE id = ?").run(
    JSON.stringify(result),
    result.operationId,
  );
}
