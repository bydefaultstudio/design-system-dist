-- Migration number: 0008 	 2026-11-08
-- The owner role (levels-groups-plan.md D16, D23). Owner joins admin, team
-- and guest on the list: everything, manages admins, cannot be demoted or
-- removed by an admin. Today the owner is only a floor, the address in
-- ACCESS_OWNER (wrangler.jsonc); after this it can be a row as well.
--
-- No row is set to owner here. A migration ships to every deployment and
-- cannot know whose address ACCESS_OWNER names, so worker/session.js writes
-- `owner` onto that row at the owner's next cookie rebuild (five minutes at
-- most), and resolveRole() treats them as the owner meanwhile. Nobody is
-- locked out at any point: the floor never reads the row.
--
-- SQLite cannot change a CHECK in place, so allowed_email is rebuilt. Its
-- dependants are handled by hand:
--
--   access_group_member  references allowed_email(email) ON DELETE CASCADE,
--                        so dropping the old table would empty it. It is
--                        copied aside first and put back after.
--   user, session        key on email by value, not by foreign key, so a
--                        rebuild does not touch them.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

PRAGMA defer_foreign_keys = true;

CREATE TABLE access_group_member_0008 AS SELECT group_id, email FROM access_group_member;

CREATE TABLE allowed_email_0008 (
  email      TEXT PRIMARY KEY NOT NULL CHECK (email = lower(trim(email))),
  note       TEXT,
  added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  role       TEXT NOT NULL DEFAULT 'team' CHECK (role IN ('owner', 'admin', 'team', 'guest')),
  expires_at INTEGER,
  invited_by TEXT,
  demo       INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1))
);

INSERT INTO allowed_email_0008 (email, note, added_at, role, expires_at, invited_by, demo)
  SELECT email, note, added_at, role, expires_at, invited_by, demo FROM allowed_email;

DROP TABLE allowed_email;
ALTER TABLE allowed_email_0008 RENAME TO allowed_email;

-- The cascade above may or may not have fired, depending on how D1 runs the
-- drop; either way the copy is the truth. Clear and restore.
DELETE FROM access_group_member;
INSERT INTO access_group_member (group_id, email)
  SELECT group_id, email FROM access_group_member_0008;
DROP TABLE access_group_member_0008;
