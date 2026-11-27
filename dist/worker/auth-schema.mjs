/* @bydefaultstudio/design-system v8.8.0 */
/**
 * auth-schema.mjs - the access vocabulary, and the one field this site adds
 * to Better Auth's own tables.
 *
 * Three words, each used once (permissions-plan.md §3.1): a LEVEL is on a
 * page - public, community, team, admin or owner, declared in `access:` frontmatter and
 * compiled into worker/page-access.mjs; a ROLE is on a person - owner, admin,
 * team, community or guest (levels-groups-plan.md D16, D23;
 * community-access-plan.md D1),
 * on the allowlist row before first sign-in and on `user.role` after it; a
 * GROUP is a named bundle of grants a guest belongs to. The same word names a
 * page level and the reader who may open it: a team page is for the team.
 *
 * `user.role` is declared here, apart from worker/auth.js, because two things
 * need the same declaration and only one of them can import auth.js: the
 * Worker (ESM, bundled by wrangler) and scripts/generate-auth-migration.mjs,
 * which runs in plain node and asks Better Auth what SQL the field needs.
 * Declared once, the generated migration and the running schema cannot
 * disagree.
 *
 * `input: false` keeps the field off every sign-up body - nobody sets their
 * own role; the allowlist row says what a person is, and auth.js copies it
 * onto the user as the row is created. `defaultValue` is what an existing
 * user row gets when the column is added; the rebuild check in
 * worker/session.js corrects it from the list within one cookie-cache cycle.
 */

import { ROLES, LEVELS, isRole, isLevel, lowestRole, lowestInternal } from './roles.mjs';

// The site's role list lives in roles.mjs (roles-engine-plan.md §1); these
// names stay so every module that read them keeps working.
export { ROLES, LEVELS };

// The column default Better Auth gives an existing user row when the role
// column is added, corrected from the list within one cookie-cache cycle.
export const DEFAULT_ROLE = 'community';

/** The level a page with none takes: the lowest internal role, `team` on every site with a team (access-plan.md §4.2). */
export function defaultLevel() {
  return lowestInternal();
}

/** A role string from the database or a cookie → one of ROLES. Unknown or missing → the lowest role: the least access, never the most. */
export function normaliseRole(value) {
  return isRole(value) ? value : lowestRole();
}

/** A level string from frontmatter → one of LEVELS. Unknown or missing → the default level: a new page ships gated. */
export function normaliseLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return isLevel(level) ? level : defaultLevel();
}

export const USER_ADDITIONAL_FIELDS = Object.freeze({
  role: { type: 'string', required: false, defaultValue: DEFAULT_ROLE, input: false },
});
