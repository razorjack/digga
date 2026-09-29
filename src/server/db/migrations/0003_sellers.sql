-- Discogs sellers whose shop Digga has read, so Triage can dig only what one of them sells.
-- `id` is the seller's Discogs user id; `listings_read` stays below `listings` when the API
-- stopped paging (it serves at most 100 pages of someone else's inventory).
CREATE TABLE sellers (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  listings INTEGER NOT NULL,
  listings_read INTEGER NOT NULL,
  read_at TEXT NOT NULL
);

-- The releases a seller had for sale at the last read, whether or not they are loaded.
CREATE TABLE seller_releases (
  seller_id INTEGER NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  release_id INTEGER NOT NULL,
  PRIMARY KEY (seller_id, release_id)
) WITHOUT ROWID;
