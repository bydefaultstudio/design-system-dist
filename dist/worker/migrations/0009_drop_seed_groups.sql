-- Migration number: 0009 	 2026-11-10
-- 0004 seeded three groups, Demo, Learners and Partners, with grants on
-- By Default OS's own sections, into every deployment's database
-- (engine-parity-plan.md §6). On a client's site they name sections it does
-- not have. 0004 is never edited: databases have already run it.
--
-- This removes a seed group only while it is still exactly as 0004 left it:
-- the same name, no members, and exactly 0004's grants, no more and no fewer.
-- A group anyone has used, renamed or re-granted stays. On By Default OS,
-- 0005 and 0007 re-granted Learners and Partners, so they stay; an empty
-- Demo goes there too, by the same rule. A site that wants an untouched one
-- back recreates it on the People page.
--
-- Apply:  npx wrangler d1 migrations apply <database>          (local)
--         npx wrangler d1 migrations apply <database> --remote (prod)

CREATE TABLE seed_group_0009 (group_id TEXT NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL);
INSERT INTO seed_group_0009 (group_id, name, scope) VALUES
  ('demo', 'Demo', 'section:tools'),
  ('learners', 'Learners', 'section:website'),
  ('learners', 'Learners', 'section:docs'),
  ('partners', 'Partners', 'section:social'),
  ('partners', 'Partners', 'section:channels'),
  ('partners', 'Partners', 'section:brand');

CREATE TABLE untouched_0009 AS
  SELECT g.id FROM access_group g
  WHERE g.id IN (SELECT group_id FROM seed_group_0009)
    AND g.name = (SELECT name FROM seed_group_0009 s WHERE s.group_id = g.id LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM access_group_member m WHERE m.group_id = g.id)
    -- no grant 0004 did not give
    AND NOT EXISTS (
      SELECT 1 FROM access_group_grant x WHERE x.group_id = g.id
        AND x.scope NOT IN (SELECT scope FROM seed_group_0009 s WHERE s.group_id = g.id))
    -- and none of 0004's taken away
    AND NOT EXISTS (
      SELECT 1 FROM seed_group_0009 s WHERE s.group_id = g.id
        AND s.scope NOT IN (SELECT scope FROM access_group_grant x WHERE x.group_id = g.id));

-- Grants first, so the result does not depend on foreign keys being enforced.
DELETE FROM access_group_grant WHERE group_id IN (SELECT id FROM untouched_0009);
DELETE FROM access_group WHERE id IN (SELECT id FROM untouched_0009);

DROP TABLE untouched_0009;
DROP TABLE seed_group_0009;
