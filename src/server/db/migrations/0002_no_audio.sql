-- Videos the user attached to a release by pasting a YouTube link. Dump loads and enrich replace
-- the videos table per release, so these live apart and are never touched by them.
CREATE TABLE user_videos (
  release_id INTEGER NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  src TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  matched_position TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (release_id, video_id)
);

-- The playable video ids a record had when it was marked no_audio. A video outside this set
-- (from a newer dump, enrich or a pasted link) sends the record back to the queue.
CREATE TABLE no_audio_videos (
  key TEXT PRIMARY KEY,
  video_ids_json TEXT NOT NULL DEFAULT '[]'
);

-- Records marked no_audio before this table existed count every video they have now as known.
INSERT INTO no_audio_videos (key, video_ids_json)
SELECT v.key, (
  SELECT json_group_array(DISTINCT vd.video_id) FROM videos vd
  JOIN releases r ON r.id = vd.release_id
  WHERE r.triage_key = v.key AND vd.embeddable = 1)
FROM verdicts v WHERE v.status = 'no_audio';
