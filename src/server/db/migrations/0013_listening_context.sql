ALTER TABLE listen_log ADD COLUMN heard_key TEXT;
ALTER TABLE listen_log ADD COLUMN artist_display TEXT;
ALTER TABLE listen_log ADD COLUMN title TEXT;
ALTER TABLE listen_log ADD COLUMN playback_id TEXT;
ALTER TABLE listen_log ADD COLUMN session_id TEXT;
ALTER TABLE listen_log ADD COLUMN started_at TEXT;
ALTER TABLE listen_log ADD COLUMN start_seconds REAL;
ALTER TABLE listen_log ADD COLUMN end_seconds REAL;
ALTER TABLE listen_log ADD COLUMN heard INTEGER;

ALTER TABLE listen_log ADD COLUMN video_title TEXT;
