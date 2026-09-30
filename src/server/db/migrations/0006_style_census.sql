-- The style census of the newest complete dump load: releases per style and year in the whole
-- dump, for the style picker. One row; each complete load replaces it.
CREATE TABLE style_census (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dump_date TEXT,
  counted_at TEXT NOT NULL,
  census_json TEXT NOT NULL
);
