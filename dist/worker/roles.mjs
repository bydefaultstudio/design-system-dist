/* @bydefaultstudio/design-system v8.8.0 */
/**
 * roles.mjs - the site's roles, highest first, and the ranks the gate reads
 * (roles-engine-plan.md §1).
 *
 * Each site lists its roles in brand.json `access.roles`: a `key` that is
 * stored and never changes, a `label` people see, and `internal`. The order
 * is the rank. The build writes the list into page-access.mjs as ROLES and
 * createGate() hands it here. A site with no list keeps the five roles every
 * site had before 8.8.0 (FALLBACK_ROLES, decision E1).
 *
 * Two keys keep powers by name, not by rank: `owner` runs the engine (owner
 * pages close to every group) and `admin` manages people and page levels.
 * Both are required, first and second. Every other key opens by rank alone.
 *
 * ROLES, LEVELS, LEVEL_RANK and ROLE_RANK are live: setRoles() refills them in
 * place, so every module that imported them reads the current site's list.
 * One deployment holds one brand, so there is one list per isolate.
 */

export const FALLBACK_ROLES = Object.freeze([
  Object.freeze({ key: 'owner', label: 'Owner', internal: true }),
  Object.freeze({ key: 'admin', label: 'Admin', internal: true }),
  Object.freeze({ key: 'team', label: 'Team', internal: true }),
  Object.freeze({ key: 'community', label: 'Community', internal: false }),
  Object.freeze({ key: 'guest', label: 'Guest', internal: false }),
]);

/** Role keys, highest first. */
export const ROLES = [];
/** Page levels, lowest first: public, then every role but the lowest (decision E3). */
export const LEVELS = [];
/** Level → rank: public 0, then each level by its role's rank. */
export const LEVEL_RANK = {};
/** Role → rank: the lowest role 0, the owner highest. A level shares its role's rank. */
export const ROLE_RANK = {};
/** Role → its label. */
export const ROLE_LABELS = {};
const INTERNAL = new Set();

const KEY = /^[a-z][a-z0-9-]{1,23}$/;
const RESERVED = new Set(['public', 'hidden', 'out', 'in']);

/**
 * Why a list cannot be a site's roles, or null when it can. The build's
 * friendlier messages live in cms/generator/brand.js; this is the Worker's
 * own guard, so a hand-edited page-access.mjs fails closed at start-up.
 */
export function rolesProblem(list) {
  if (!Array.isArray(list) || list.length < 3 || list.length > 8) return 'the list needs 3 to 8 roles';
  const seen = new Set();
  let external = false;
  for (const role of list) {
    if (!role || typeof role !== 'object' || !KEY.test(role.key || '') || RESERVED.has(role.key)) return `"${role && role.key}" is not a role key`;
    if (seen.has(role.key)) return `"${role.key}" is listed twice`;
    seen.add(role.key);
    if (typeof role.label !== 'string' || !role.label.trim()) return `"${role.key}" has no label`;
    if (role.internal === true && external) return `"${role.key}" is internal but sits below an external role`;
    if (role.internal !== true) external = true;
  }
  if (list[0].key !== 'owner' || list[0].internal !== true) return 'the first role must be the internal "owner"';
  if (list[1].key !== 'admin' || list[1].internal !== true) return 'the second role must be the internal "admin"';
  if (!external) return 'the list needs an external role';
  return null;
}

/** Make `list` the site's roles. Throws on a list rolesProblem() refuses. */
export function setRoles(list = FALLBACK_ROLES) {
  const problem = rolesProblem(list);
  if (problem) throw new Error(`roles: ${problem}`);
  ROLES.length = 0;
  LEVELS.length = 0;
  INTERNAL.clear();
  for (const k of Object.keys(LEVEL_RANK)) delete LEVEL_RANK[k];
  for (const k of Object.keys(ROLE_RANK)) delete ROLE_RANK[k];
  for (const k of Object.keys(ROLE_LABELS)) delete ROLE_LABELS[k];
  const n = list.length;
  list.forEach((role, i) => {
    ROLES.push(role.key);
    ROLE_RANK[role.key] = n - 1 - i;
    ROLE_LABELS[role.key] = role.label.trim();
    if (role.internal === true) INTERNAL.add(role.key);
  });
  LEVELS.push('public');
  LEVEL_RANK.public = 0;
  for (let i = n - 2; i >= 0; i--) {
    LEVELS.push(list[i].key);
    LEVEL_RANK[list[i].key] = n - 1 - i;
  }
}

setRoles();

/** The lowest role: what an unknown stored role reads as (least access, never the most). */
export function lowestRole() {
  return ROLES[ROLES.length - 1];
}

/** The lowest internal role: the level a new page ships at (on every site with a team, `team`). */
export function lowestInternal() {
  let key = 'owner';
  for (const role of ROLES) if (INTERNAL.has(role)) key = role;
  return key;
}

export function isRole(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

export function isInternalRole(role) {
  return INTERNAL.has(role);
}

/** Whether a page level belongs to the internal roles (public never does). */
export function isInternalLevel(level) {
  return INTERNAL.has(level);
}

/** Whether a page level is open to outsiders by rank or by group: public or an external role's. */
export function isExternalLevel(level) {
  return level === 'public' || (isLevel(level) && !INTERNAL.has(level));
}

export function isLevel(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_RANK, value);
}

/** Whether a role opens a level by rank alone, with no group. */
export function opensByRank(role, level) {
  if (level === 'public') return true;
  if (!isRole(role) || !isLevel(level)) return false;
  return ROLE_RANK[role] >= LEVEL_RANK[level];
}

/** The highest level of a kind below the owner's: what a role of that kind could still be granted. */
function topGrantable(internal) {
  let top = null;
  for (const level of LEVELS) {
    if (level === 'public' || level === 'owner') continue;
    if (INTERNAL.has(level) === internal) top = level;
  }
  return top;
}

/**
 * The kind of group whose grants change what a role opens, so the only kind
 * the gate reads for it, or null when no group could add anything: an owner,
 * an admin (opens every internal page but the owner's), and the highest
 * external role (opens every external page).
 */
export function scopeKindFor(role) {
  if (!isRole(role) || role === 'owner') return null;
  const internal = INTERNAL.has(role);
  const top = topGrantable(internal);
  if (!top || ROLE_RANK[role] >= LEVEL_RANK[top]) return null;
  return internal ? 'internal' : 'external';
}

/** The kind of group a role may join: internal roles internal, external roles external, the owner none. */
export function memberKindFor(role) {
  if (!isRole(role) || role === 'owner') return null;
  return INTERNAL.has(role) ? 'internal' : 'external';
}

/** The list as the browser reads it (window.bdRoles): highest first. */
export function rolesForBrowser() {
  return ROLES.map((key) => ({ key, label: ROLE_LABELS[key], internal: INTERNAL.has(key) }));
}
