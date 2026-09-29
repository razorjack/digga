-- The bulk enrich jobs are gone, and the jobs panel cannot describe rows of a type it no longer knows.
DELETE FROM jobs WHERE type IN ('enrich', 'enrich_twelves');
