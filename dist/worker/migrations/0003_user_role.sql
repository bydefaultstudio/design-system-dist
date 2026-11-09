-- The role on a signed-in person (permissions-plan.md §4.2): admin, team or
-- guest, copied from the allowlist row by worker/auth.js as the user is
-- created, and kept in step with that row at every cookie-cache rebuild by
-- worker/session.js. Rows that exist before this column take the default and
-- are corrected from the list within five minutes.
--
-- GENERATED, not typed: better-auth 1.7.5, by scripts/generate-auth-migration.mjs -
-- getMigrations() from better-auth/db/migration, the same code path as
-- `@better-auth/cli generate` - against worker/auth-schema.mjs. Regenerate the
-- same way after a schema change rather than editing by hand.
--
-- Apply:  npx wrangler d1 migrations apply design-system-auth          (local)
--         npx wrangler d1 migrations apply design-system-auth --remote (prod)

alter table "user" add column "role" text default 'team';
