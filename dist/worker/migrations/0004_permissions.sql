-- Roles within the one brand (permissions-plan.md §6): what a person is before
-- they first sign in, how long they are admitted for, and the groups that
-- give a guest their pages.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

-- The list is the policy, and now it says what a person is. `role` is copied
-- onto the user record at first sign-in and re-read at every cookie-cache
-- rebuild, so a row changed by hand still takes effect within five minutes.
-- The three rows that exist today take `team` by the default; the owner is
-- admin by ACCESS_OWNER in wrangler.jsonc whatever the row says.
ALTER TABLE allowed_email ADD COLUMN role TEXT NOT NULL DEFAULT 'team'
  CHECK (role IN ('admin', 'team', 'guest'));

-- After this moment the person is refused like a revoked session, and shown
-- as Expired on the People page. NULL is never: the default.
ALTER TABLE allowed_email ADD COLUMN expires_at INTEGER;             -- unix seconds

-- The admin who added the row, for the list's own history.
ALTER TABLE allowed_email ADD COLUMN invited_by TEXT;

-- A demo account signs in with any code: no email is sent and whatever is
-- typed is accepted (worker/auth.js, DEMO_CODE). For walking the system in a
-- call, one account per role. Anyone who knows the address can sign in as it,
-- so a demo row is created for a demo and removed after.
ALTER TABLE allowed_email ADD COLUMN demo INTEGER NOT NULL DEFAULT 0
  CHECK (demo IN (0, 1));

-- A group is a named bundle of grants. Guests belong to zero or more; a
-- guest's access is the union of their groups' grants and nothing else.
CREATE TABLE access_group (
  id       TEXT PRIMARY KEY NOT NULL CHECK (id = lower(trim(id)) AND id <> ''),  -- slug: demo, learners, partners
  name     TEXT NOT NULL,
  note     TEXT,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Membership keys on the email, not the user id, so a grant can precede the
-- first sign-in. Removing the person from the list removes their memberships.
CREATE TABLE access_group_member (
  group_id TEXT NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  email    TEXT NOT NULL REFERENCES allowed_email(email) ON DELETE CASCADE
             CHECK (email = lower(trim(email))),
  PRIMARY KEY (group_id, email)
);
CREATE INDEX access_group_member_email ON access_group_member (email); -- the grant lookup

-- A grant names a section ('section:tools', by output folder) or one page
-- ('page:/tools/logo-tool.html'). Grants are additive; there is no "except".
-- An admin page can never be granted - the API refuses it, and authorise()
-- answers admin pages before it ever asks about grants.
CREATE TABLE access_group_grant (
  group_id TEXT NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  scope    TEXT NOT NULL CHECK (scope LIKE 'section:%' OR scope LIKE 'page:/%'),
  PRIMARY KEY (group_id, scope)
);

-- The three groups the plan names (permissions-plan.md §3.1), as a starting
-- point; the People page edits them.
INSERT INTO access_group (id, name, note) VALUES
  ('demo', 'Demo', 'A prospect walking the tools'),
  ('learners', 'Learners', 'A designer learning design systems'),
  ('partners', 'Partners', 'Media owners and production houses retrieving specs');
INSERT INTO access_group_grant (group_id, scope) VALUES
  ('demo', 'section:tools'),
  ('learners', 'section:website'),
  ('learners', 'section:docs'),
  ('partners', 'section:social'),
  ('partners', 'section:channels'),
  ('partners', 'section:brand');
