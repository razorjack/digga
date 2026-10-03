-- A pasted link is the user's, not the catalogue's: it stays when the release row goes, as when
-- the setup's "Change your picks" undoes a load or a restore reaches a library without the
-- release, and applies again once a load brings the release back. SQLite cannot drop a foreign
-- key, so the table is rebuilt without the cascade.
CREATE TABLE user_videos_new (
  release_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  src TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  matched_position TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (release_id, video_id)
);
INSERT INTO user_videos_new (release_id, video_id, src, title, matched_position, added_at)
SELECT release_id, video_id, src, title, matched_position, added_at FROM user_videos ORDER BY rowid;
DROP TABLE user_videos;
ALTER TABLE user_videos_new RENAME TO user_videos;
