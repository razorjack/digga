-- Rebuilding heard_tracks looks up each tune's first listen by heard_key; without this index the
-- rebuild scans listen_log once per tune.
CREATE INDEX listen_log_heard_key ON listen_log (heard_key);
