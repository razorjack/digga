-- Discogs sends master_id 0 for a release without a master, and imports stored it as given; a
-- backup's membership needs null there.
UPDATE memberships SET master_id = NULL WHERE master_id <= 0;
