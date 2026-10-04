-- The copies a seller had for sale at the last read, with their grading, price and comment, so
-- Triage can show what the seller asks for a record. A read replaces them with seller_releases.
-- `id` is the Discogs listing id; `price` is in `currency`, the seller's.
CREATE TABLE seller_listings (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  release_id INTEGER NOT NULL,
  media_condition TEXT,
  sleeve_condition TEXT,
  price REAL,
  currency TEXT,
  comments TEXT NOT NULL DEFAULT '',
  posted_at TEXT
);
CREATE INDEX seller_listings_release ON seller_listings (release_id, seller_id);
CREATE INDEX seller_listings_seller ON seller_listings (seller_id);
