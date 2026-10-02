-- A track mark keeps the tune it is about, which a later dump that renames the position (A1 to A)
-- would otherwise lose, and the moment it was set: the video playing and the second it had reached.
ALTER TABLE track_verdicts ADD COLUMN heard_key TEXT;
ALTER TABLE track_verdicts ADD COLUMN artist_display TEXT;
ALTER TABLE track_verdicts ADD COLUMN title TEXT;
-- Null for marks set before this column existed, and for marks set outside Triage.
ALTER TABLE track_verdicts ADD COLUMN video_id TEXT;
ALTER TABLE track_verdicts ADD COLUMN at_seconds REAL;

UPDATE track_verdicts SET (heard_key, artist_display, title) = (
  SELECT t.heard_key, t.artist_display, t.title FROM tracks t
  WHERE t.release_id = track_verdicts.release_id AND t.position = track_verdicts.position
  ORDER BY t.seq LIMIT 1);
