-- 0016_activity.sql - the sign-in activity log (an engine table, shipped).
--
-- One row per thing a signed-in reader did: signed in, opened a gated page,
-- or downloaded a file from the Asset Library. Written by the gate
-- (worker/activity.mjs) only while the `activity` app is installed, and read
-- by the owner's Settings > Activity page. Nothing else reads it.
--
-- Deliberately thin: the reader's email (lowercased, as allowed_email keeps
-- it), the time in unix seconds, what kind of thing, and the path. No IP
-- address, no user agent, no query string: the log answers "who looked at
-- what, when", nothing more. Rows older than the site's retention (13 months
-- by default) are deleted by the gate as it writes, at most once an hour.
--
-- Applying this to a site that does not install the app is harmless: the
-- table stays empty.

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sign-in', 'page', 'download')),
  path TEXT NOT NULL DEFAULT ''
);

-- The page reads newest first, and the retention sweep deletes by age
CREATE INDEX IF NOT EXISTS activity_log_at_idx ON activity_log (at);
-- One person's history, newest first
CREATE INDEX IF NOT EXISTS activity_log_email_at_idx ON activity_log (email, at);
-- The log filtered to one kind, newest first (the page pages by id)
CREATE INDEX IF NOT EXISTS activity_log_kind_id_idx ON activity_log (kind, id);
