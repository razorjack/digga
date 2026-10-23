-- Independent of the inventory rows: a refresh must keep decisions about sold copies.
CREATE TABLE shopping_decisions (
  listing_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'shortlisted', 'skipped')),
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (seller_id, listing_id)
);
CREATE INDEX shopping_decisions_seller ON shopping_decisions (seller_id);
