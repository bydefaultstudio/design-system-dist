-- Migration number: 0019 	 2026-11-26
-- Each site lists its own roles (roles-engine-plan.md §1, E1-E6). The role
-- and level CHECKs named the five roles every site had, so a site could not
-- store a role it added, such as By Default's `pro`. They now check the
-- shape of a key only (lower case, a letter first, 2 to 24 characters of
-- a-z, 0-9 and hyphens, as brand.json access.roles requires); which keys a
-- site has is the Worker's to check, against its own list. No row changes
-- value, and the column default stays 'community'.
--
-- SQLite cannot change a CHECK in place, so each table is rebuilt, as 0008
-- and 0017 did, line for line. Dependants:
--
--   access_group_member  references allowed_email(email) ON DELETE CASCADE,
--                        so it is copied aside and restored.
--   user.role            Better Auth's column has no CHECK and is left alone.
--
-- This is an ENGINE migration: it ships to consuming sites, so it is NOT in
-- scripts/build-package.js SITE_ONLY_MIGRATIONS.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)
-- Apply before giving anyone a role outside the five.

PRAGMA defer_foreign_keys = true;

-- allowed_email -------------------------------------------------------------

CREATE TABLE access_group_member_0019 AS SELECT group_id, email FROM access_group_member;

CREATE TABLE allowed_email_0019 (
  email      TEXT PRIMARY KEY NOT NULL CHECK (email = lower(trim(email))),
  note       TEXT,
  added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  role       TEXT NOT NULL DEFAULT 'community' CHECK (role GLOB '[a-z]*' AND role NOT GLOB '*[^a-z0-9-]*' AND length(role) BETWEEN 2 AND 24),
  expires_at INTEGER,
  invited_by TEXT,
  demo       INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1))
);

INSERT INTO allowed_email_0019 (email, note, added_at, role, expires_at, invited_by, demo)
  SELECT email, note, added_at, role, expires_at, invited_by, demo FROM allowed_email;

DROP TABLE allowed_email;
ALTER TABLE allowed_email_0019 RENAME TO allowed_email;

-- The cascade may or may not have fired on the drop; the copy is the truth.
DELETE FROM access_group_member;
INSERT INTO access_group_member (group_id, email)
  SELECT group_id, email FROM access_group_member_0019;
DROP TABLE access_group_member_0019;

-- level_setting -------------------------------------------------------------

CREATE TABLE level_setting_0019 (
  kind        TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target      TEXT NOT NULL CHECK (
                target = lower(trim(target)) AND target <> ''
                AND ((kind = 'section' AND target NOT LIKE '/%')
                  OR (kind = 'page'    AND target LIKE '/%'))
              ),
  level       TEXT NOT NULL CHECK (level GLOB '[a-z]*' AND level NOT GLOB '*[^a-z0-9-]*' AND length(level) BETWEEN 2 AND 24),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, target)
);
INSERT INTO level_setting_0019 (kind, target, level, version, updated_by, updated_at)
  SELECT kind, target, level, version, updated_by, updated_at FROM level_setting;
DROP TABLE level_setting;
ALTER TABLE level_setting_0019 RENAME TO level_setting;

-- level_draft ---------------------------------------------------------------

CREATE TABLE level_draft_0019 (
  staged_by    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target       TEXT NOT NULL CHECK (
                 target = lower(trim(target)) AND target <> ''
                 AND ((kind = 'section' AND target NOT LIKE '/%')
                   OR (kind = 'page'    AND target LIKE '/%'))
               ),
  level        TEXT CHECK (level IS NULL OR (level GLOB '[a-z]*' AND level NOT GLOB '*[^a-z0-9-]*' AND length(level) BETWEEN 2 AND 24)),
  base_level   TEXT CHECK (base_level IS NULL OR (base_level GLOB '[a-z]*' AND base_level NOT GLOB '*[^a-z0-9-]*' AND length(base_level) BETWEEN 2 AND 24)),
  base_version INTEGER,
  staged_at    INTEGER NOT NULL,
  PRIMARY KEY (staged_by, kind, target)
);
INSERT INTO level_draft_0019 (staged_by, kind, target, level, base_level, base_version, staged_at)
  SELECT staged_by, kind, target, level, base_level, base_version, staged_at FROM level_draft;
DROP TABLE level_draft;
ALTER TABLE level_draft_0019 RENAME TO level_draft;

-- level_setting_history -----------------------------------------------------

CREATE TABLE level_setting_history_0019 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target     TEXT NOT NULL CHECK (target = lower(trim(target)) AND target <> ''),
  old_level  TEXT CHECK (old_level IS NULL OR (old_level GLOB '[a-z]*' AND old_level NOT GLOB '*[^a-z0-9-]*' AND length(old_level) BETWEEN 2 AND 24)),
  new_level  TEXT CHECK (new_level IS NULL OR (new_level GLOB '[a-z]*' AND new_level NOT GLOB '*[^a-z0-9-]*' AND length(new_level) BETWEEN 2 AND 24)),
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
-- Explicit ids keep the AUTOINCREMENT counter at max(id).
INSERT INTO level_setting_history_0019 (id, kind, target, old_level, new_level, changed_by, changed_at)
  SELECT id, kind, target, old_level, new_level, changed_by, changed_at FROM level_setting_history;
DROP TABLE level_setting_history;
ALTER TABLE level_setting_history_0019 RENAME TO level_setting_history;
CREATE INDEX level_setting_history_target ON level_setting_history (kind, target, changed_at);
