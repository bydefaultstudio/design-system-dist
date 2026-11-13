-- Migration number: 0015 	 2026-11-13
-- Level settings from Settings (levels-groups-plan.md D27): owners and admins
-- change a section's floor and a single page's level from Settings > People,
-- with no code change.
--
-- Every change reaches the site through a build, never at request time: the
-- gate reads only the level the last build baked (access-plan.md rule 1,
-- "build-time, never runtime", holds). A change moves through three places:
--
--   level_draft    staged by one person, seen only in Settings, ignored by
--                  the build and the gate. Discarded or applied.
--   level_setting  applied (confirmed). The next build reads these rows and
--                  bakes them into page-access.mjs, search and the sidebar.
--                  Until it does, Settings shows the change as waiting.
--   the build      once deployed, its baked snapshot (APPLIED_LEVELS) matches
--                  level_setting and the change is live.
--
-- This is an ENGINE feature: it ships to consuming sites, so this migration
-- is NOT in scripts/build-package.js SITE_ONLY_MIGRATIONS.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

-- One row per applied target. `kind` is 'section' (a folder, its floor) or
-- 'page' (an output path, its own level). A target with no row follows the
-- code. `version` moves on every write, so an apply only lands on the row
-- its author saw (a conditional write: two people never overwrite each other).
CREATE TABLE level_setting (
  kind        TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  -- A section target is a bare output folder ('components'); a page target is
  -- an output path ('/components/button.html'). Lowercased and non-empty.
  target      TEXT NOT NULL CHECK (
                target = lower(trim(target)) AND target <> ''
                AND ((kind = 'section' AND target NOT LIKE '/%')
                  OR (kind = 'page'    AND target LIKE '/%'))
              ),
  level       TEXT NOT NULL CHECK (level IN ('public', 'team', 'admin', 'owner')),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT NOT NULL,                       -- the reader's email
  updated_at  INTEGER NOT NULL,                    -- unix seconds, when applied
  PRIMARY KEY (kind, target)
);

-- Staged changes, one per person per target, never read by the build. `level`
-- NULL stages a reset ("back to code" / "back to section"). `base_level` and
-- `base_version` are the applied row as the person saw it when staging (both
-- NULL when there was no row): apply refuses a change whose base has moved.
CREATE TABLE level_draft (
  staged_by    TEXT NOT NULL,                      -- the reader's email
  kind         TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target       TEXT NOT NULL CHECK (
                 target = lower(trim(target)) AND target <> ''
                 AND ((kind = 'section' AND target NOT LIKE '/%')
                   OR (kind = 'page'    AND target LIKE '/%'))
               ),
  level        TEXT CHECK (level IS NULL OR level IN ('public', 'team', 'admin', 'owner')),
  base_level   TEXT CHECK (base_level IS NULL OR base_level IN ('public', 'team', 'admin', 'owner')),
  base_version INTEGER,
  staged_at    INTEGER NOT NULL,                   -- unix seconds
  PRIMARY KEY (staged_by, kind, target)
);

-- Append-only history: every applied set and reset, who and when, the level
-- before and after. A reset records new_level NULL; a first set records
-- old_level NULL. Drafts are not history: nothing happened until applied.
CREATE TABLE level_setting_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('section', 'page')),
  target     TEXT NOT NULL CHECK (target = lower(trim(target)) AND target <> ''),
  old_level  TEXT CHECK (old_level IS NULL OR old_level IN ('public', 'team', 'admin', 'owner')),
  new_level  TEXT CHECK (new_level IS NULL OR new_level IN ('public', 'team', 'admin', 'owner')),
  changed_by TEXT NOT NULL,                        -- the reader's email
  changed_at INTEGER NOT NULL                      -- unix seconds
);
CREATE INDEX level_setting_history_target ON level_setting_history (kind, target, changed_at);

-- A singleton row: when a build was last asked for, so Settings can say
-- "Build asked for at 14:02" and a burst of applies rides one build
-- (worker/levels-build.mjs), and when a change was last applied, so Settings
-- can tell a change that slipped past a build (a reset leaves no row of its
-- own to date it). id is pinned to 1 by the CHECK.
CREATE TABLE level_build (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_trigger_at INTEGER NOT NULL DEFAULT 0,
  last_apply_at   INTEGER NOT NULL DEFAULT 0
);
