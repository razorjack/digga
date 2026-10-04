-- The Discogs community rating, part of the API snapshot `P` in Triage fetches.
ALTER TABLE releases ADD COLUMN rating_average REAL;
ALTER TABLE releases ADD COLUMN rating_count INTEGER;
