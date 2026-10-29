-- Receipts make retries idempotent and restrict undo to additions made by this operation.
CREATE TABLE wantlist_expansions (
  id TEXT PRIMARY KEY,
  account_version INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);
