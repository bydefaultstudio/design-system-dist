-- Migration number: 0018 	 2026-11-21
-- Internal and external groups (community-access-plan.md D8, D9). A group's
-- kind is set when it is made and never changed after (worker/people.js
-- refuses it).
--
--   external  guests and community members; opens public and community pages
--             only, never a team page in a section it grants.
--   internal  team members and admins only; may open team and admin pages,
--             never an owner page. Its grants count only while the member
--             still holds team or admin (worker/auth.js readerScopes).
--
-- Every existing group was made for outsiders, so each becomes external.
-- ADD COLUMN with a constant default and a CHECK needs no rebuild, so no
-- membership or grant is touched.
--
-- This is an ENGINE migration: it ships to consuming sites, so it is NOT in
-- scripts/build-package.js SITE_ONLY_MIGRATIONS.
ALTER TABLE access_group ADD COLUMN kind TEXT NOT NULL DEFAULT 'external'
  CHECK (kind IN ('internal', 'external'));
