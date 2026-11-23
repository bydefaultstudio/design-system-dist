-- Migration number: 0017 	 2026-11-21
-- The community role and level (community-access-plan.md D1-D3). Community
-- sits between public and team: the design and creative community, who open
-- community pages and nothing internal.
--
-- Widens the role CHECK on allowed_email, whose default becomes 'community'
-- (a new person is an outsider until made internal by hand, D3), and the
-- level CHECKs on the level settings tables, so Settings can set a section or
-- a page to community. No row changes value.
--
-- SQLite cannot change a CHECK in place, so each table is rebuilt, as 0008
-- did. Dependants:
--
--   access_group_member  references allowed_email(email) ON DELETE CASCADE,
--                        so it is copied aside and restored.
--   user.role            Better Auth's column has no CHECK and is left alone:
--                        auth.js copies the list's role onto it.
--
-- This is an ENGINE migration: it ships to consuming sites, so it is NOT in
-- scripts/build-package.js SITE_ONLY_MIGRATIONS.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)
-- Apply before deploying the code that offers the community role.

PRAGMA defer_foreign_keys = true;

-- allowed_email -------------------------------------------------------------

CREATE TABLE access_group_member_0017 AS SELECT group_id, email FROM access_group_member;

CREATE TABLE allowed_email_0017 (
  email      TEXT PRIMARY KEY NOT NULL CHECK (email = lower(trim(email))),
  note       TEXT,
  added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  role       TEXT NOT NULL DEFAULT 'community' CHECK (role IN ('owner', 'admin', 'team', 'community', 'guest')),
  expires_at INTEGER,
  invited_by TEXT,
  demo       INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1))
);

INSERT INTO allowed_email_0017 (email, note, added_at, role, expires_at, invited_by, demo)
  SELECT email, note, added_at, role, expires_at, invited_by, demo FROM allowed_email;

DROP TABLE allowed_email;
ALTER TABLE allowed_email_0017 RENAME TO allowed_email;

-- The cascade may or may not have fired on the drop; the copy is the truth.
DELETE FROM access_group_member;
INSERT INTO access_group_member (group_id, email)
  SELECT group_id, email FROM access_group_member_0017;
DROP TABLE access_group_member_0017;

-- level_setting -------------------------------------------------------------

CREATE TABLE level_setting_0017 (
  kind        TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target      TEXT NOT NULL CHECK (
                target = lower(trim(target)) AND target <> ''
                AND ((kind = 'section' AND target NOT LIKE '/%')
                  OR (kind = 'page'    AND target LIKE '/%'))
              ),
  level       TEXT NOT NULL CHECK (level IN ('public', 'community', 'team', 'admin', 'owner')),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, target)
);
INSERT INTO level_setting_0017 (kind, target, level, version, updated_by, updated_at)
  SELECT kind, target, level, version, updated_by, updated_at FROM level_setting;
DROP TABLE level_setting;
ALTER TABLE level_setting_0017 RENAME TO level_setting;

-- level_draft ---------------------------------------------------------------

CREATE TABLE level_draft_0017 (
  staged_by    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target       TEXT NOT NULL CHECK (
                 target = lower(trim(target)) AND target <> ''
                 AND ((kind = 'section' AND target NOT LIKE '/%')
                   OR (kind = 'page'    AND target LIKE '/%'))
               ),
  level        TEXT CHECK (level IS NULL OR level IN ('public', 'community', 'team', 'admin', 'owner')),
  base_level   TEXT CHECK (base_level IS NULL OR base_level IN ('public', 'community', 'team', 'admin', 'owner')),
  base_version INTEGER,
  staged_at    INTEGER NOT NULL,
  PRIMARY KEY (staged_by, kind, target)
);
INSERT INTO level_draft_0017 (staged_by, kind, target, level, base_level, base_version, staged_at)
  SELECT staged_by, kind, target, level, base_level, base_version, staged_at FROM level_draft;
DROP TABLE level_draft;
ALTER TABLE level_draft_0017 RENAME TO level_draft;

-- level_setting_history -----------------------------------------------------

CREATE TABLE level_setting_history_0017 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target     TEXT NOT NULL CHECK (target = lower(trim(target)) AND target <> ''),
  old_level  TEXT CHECK (old_level IS NULL OR old_level IN ('public', 'community', 'team', 'admin', 'owner')),
  new_level  TEXT CHECK (new_level IS NULL OR new_level IN ('public', 'community', 'team', 'admin', 'owner')),
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
-- Explicit ids keep the AUTOINCREMENT counter at max(id).
INSERT INTO level_setting_history_0017 (id, kind, target, old_level, new_level, changed_by, changed_at)
  SELECT id, kind, target, old_level, new_level, changed_by, changed_at FROM level_setting_history;
DROP TABLE level_setting_history;
ALTER TABLE level_setting_history_0017 RENAME TO level_setting_history;
CREATE INDEX level_setting_history_target ON level_setting_history (kind, target, changed_at);
