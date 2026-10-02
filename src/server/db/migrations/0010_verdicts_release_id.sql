-- A dump load looks up the verdicts made on the releases it writes, to move them when a release's
-- key changes.
CREATE INDEX verdicts_release_id ON verdicts (release_id);
