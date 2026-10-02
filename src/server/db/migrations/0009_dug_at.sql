-- When the record was last judged in Digga. A seed that replaces the verdict keeps it, so a want
-- the wantlist import turns into a seed still counts as dug, and in the rate.
ALTER TABLE verdicts ADD COLUMN dug_at TEXT;
UPDATE verdicts SET dug_at = decided_at WHERE source IN ('triage', 'manual');
CREATE INDEX verdicts_dug_at ON verdicts (dug_at);
