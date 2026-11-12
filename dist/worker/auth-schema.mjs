/* @bydefaultstudio/design-system v8.1.0 */
/**
 * auth-schema.mjs - the access vocabulary, and the one field this site adds
 * to Better Auth's own tables.
 *
 * Three words, each used once (permissions-plan.md §3.1): a LEVEL is on a
 * page - public, team, admin or owner, declared in `access:` frontmatter and
 * compiled into worker/page-access.mjs; a ROLE is on a person - owner, admin,
 * team or guest (levels-groups-plan.md D16, D23),
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

export const ROLES = Object.freeze(['owner', 'admin', 'team', 'guest']);
export const DEFAULT_ROLE = 'team';

export const LEVELS = Object.freeze(['public', 'team', 'admin', 'owner']);
export const DEFAULT_LEVEL = 'team';

/** A role string from the database or a cookie → one of ROLES. Unknown or missing → guest: the least access, never the most. */
export function normaliseRole(value) {
  return ROLES.includes(value) ? value : 'guest';
}

/** A level string from frontmatter → one of LEVELS. Unknown or missing → team: a new page ships gated to the team (access-plan.md §4.2). */
export function normaliseLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return LEVELS.includes(level) ? level : DEFAULT_LEVEL;
}

export const USER_ADDITIONAL_FIELDS = Object.freeze({
  role: { type: 'string', required: false, defaultValue: DEFAULT_ROLE, input: false },
});
