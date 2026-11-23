/* @bydefaultstudio/design-system v8.6.1 */
/**
 * people-core.mjs - the pure half of the People API (permissions-plan.md §5).
 *
 * No Workers APIs and no I/O, so scripts/verify-authorise.mjs imports it in
 * plain node. worker/people.js reads the database, calls these to validate
 * and to describe, and writes what they return. Everything a request can get
 * wrong is named here, in the words the page shows.
 */
import { ROLES } from './auth-schema.mjs';
import { GROUP_KINDS, isGrantableScope, memberKindFor, normalizeEmail } from './gate.mjs';

export const PEOPLE_BASE_PATH = '/api/people/';

export const NOTE_MAX_LENGTH = 200;
export const GROUP_NAME_MAX_LENGTH = 60;
export const INVITE_MAX_ADDRESSES = 20;

const DAY_SECONDS = 24 * 60 * 60;

/** "a@b.c, d@e.f" or one per line → the normalised addresses, duplicates dropped, bad ones named. */
export function parseEmails(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const emails = [];
  const invalid = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    const email = normalizeEmail(item);
    if (!email) invalid.push(item.trim());
    else if (!emails.includes(email)) emails.push(email);
  }
  return { emails, invalid };
}

/**
 * A Better Auth date as it comes back from D1 - an ISO string, or a number of
 * milliseconds - as milliseconds since the epoch, or null.
 */
export function toMillis(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

export function daysUntil(unixSeconds, now) {
  return Math.ceil((Number(unixSeconds) - now) / DAY_SECONDS);
}

/**
 * The word the row shows. Invited: on the list, never signed in. Active: has
 * signed in. Expires in N days: active or invited, with an end set. Expired:
 * the end has passed - the gate refuses them like a revoked session.
 */
export function personStatus(row, now) {
  const expires = row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at);
  if (expires !== null && expires <= now) return { key: 'expired', label: 'Expired' };
  if (expires !== null) {
    const days = daysUntil(expires, now);
    return { key: 'expiring', label: days <= 1 ? 'Expires today' : `Expires in ${days} days` };
  }
  if (!row.user_id) return { key: 'invited', label: 'Invited' };
  return { key: 'active', label: 'Active' };
}

/** A group id from its name: lowercase, hyphens, nothing else. */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function cleanNote(value) {
  if (value === null || value === undefined) return null;
  const note = String(value).trim();
  if (note === '') return null;
  return note.length > NOTE_MAX_LENGTH ? note.slice(0, NOTE_MAX_LENGTH) : note;
}

/**
 * An expiry from the page: null for none, or a unix timestamp in seconds that
 * is still in the future. The page sends an ISO date (YYYY-MM-DD); the end is
 * the end of that day, UTC - a demo that ends "on the 14th" is open on the 14th.
 */
export function parseExpiry(value, now) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  let seconds = null;
  if (typeof value === 'number') seconds = Math.floor(value);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const ms = Date.parse(`${value}T23:59:59Z`);
    seconds = Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  if (seconds === null) return { ok: false, error: 'Access ends needs a full date, or leave it empty.' };
  if (seconds <= now) return { ok: false, error: 'That end date has passed. Pick a later one, or leave it empty.' };
  return { ok: true, value: seconds };
}

/**
 * How a submitted end date differs from the stored one. `changed` is any
 * difference, clearing the date included: the row's admission changes either
 * way, and the self-row and owner guards refuse any change. `set` is a date
 * being added or moved, a removal on a timer, which is all the last-owner and
 * last-admin guards care about: a clear only adds access (security audit
 * 2026-11-09, finding 8).
 */
export function expiryChange(stored, submitted) {
  const before = stored === null || stored === undefined ? null : Number(stored);
  const changed = submitted !== before;
  return { changed, set: changed && submitted !== null };
}

/**
 * What a person's row may carry: role, groups, expiry, demo, note. Shared by
 * invite and update. `groups` is every group the site has, as { id, kind }.
 * A person joins only groups of their role's kind (memberKindFor,
 * community-access-plan.md D8, D9): guests and community members external
 * ones, team members and admins internal ones. Nobody outside the team ever
 * joins an internal group. An owner opens everything, so joins none.
 */
export function validatePerson(body, { groups: known = [], now }) {
  const errors = [];
  const role = typeof body.role === 'string' ? body.role : '';
  if (!ROLES.includes(role)) errors.push('The role is owner, admin, team, community or guest.');

  const groups = Array.isArray(body.groups) ? body.groups.map(String) : [];
  const kinds = new Map(known.map((group) => [group.id, group.kind]));
  const unknownGroups = groups.filter((id) => !kinds.has(id));
  if (unknownGroups.length) errors.push(`No such group: ${unknownGroups.join(', ')}.`);
  const kind = memberKindFor(role);
  if (groups.length && ROLES.includes(role) && !kind) errors.push('An owner opens everything, so joins no group.');
  else if (kind && groups.some((id) => kinds.has(id) && kinds.get(id) !== kind)) {
    errors.push(kind === 'internal'
      ? 'A team member or an admin joins internal groups only.'
      : 'Internal groups are for the team and admins only. A guest or a community member joins external groups.');
  }

  const expiry = parseExpiry(body.expiresAt, now);
  if (!expiry.ok) errors.push(expiry.error);

  const demo = body.demo === true || body.demo === 1 || body.demo === '1';
  // A demo account signs in with any code, so its address is a password
  // anyone can use. Never on a role that manages people or opens owner pages.
  if (demo && isManagerRole(role)) errors.push('A demo account is a team member, a community member or a guest. Owners and admins sign in with their own code.');

  return {
    ok: errors.length === 0,
    errors,
    value: { role, groups: [...new Set(groups)], expiresAt: expiry.ok ? expiry.value : null, demo, note: cleanNote(body.note) },
  };
}

export function validateInvite(body, context) {
  const person = validatePerson(body, context);
  const { emails, invalid } = parseEmails(body.emails);
  const errors = [...person.errors];
  if (invalid.length) errors.push(`Not an email address: ${invalid.join(', ')}.`);
  if (emails.length === 0 && invalid.length === 0) errors.push('Enter at least one email address.');
  if (emails.length > INVITE_MAX_ADDRESSES) errors.push(`Up to ${INVITE_MAX_ADDRESSES} addresses at a time.`);
  return { ok: errors.length === 0, errors, value: { ...person.value, emails } };
}

/**
 * A group's row: a name, an optional note, its kind (external unless said
 * otherwise), and its grants, each a section the site has or a page the map
 * knows that a group of that kind may open (isGrantableScope). Whether the
 * kind may change is the API's question: it is fixed once the group exists.
 */
export function validateGroup(body, { pages, sections }) {
  const errors = [];
  const kind = body.kind === undefined || body.kind === null || body.kind === '' ? 'external' : String(body.kind);
  if (!GROUP_KINDS.includes(kind)) errors.push('A group is internal or external.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') errors.push('The group needs a name.');
  if (name.length > GROUP_NAME_MAX_LENGTH) errors.push(`The name is at most ${GROUP_NAME_MAX_LENGTH} characters.`);
  const id = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : slugify(name);
  if (!errors.length && id === '') errors.push('The name needs at least one letter or number.');

  const grants = Array.isArray(body.grants) ? [...new Set(body.grants.map(String))] : [];
  const bad = GROUP_KINDS.includes(kind) ? grants.filter((scope) => !isGrantableScope(scope, pages, sections, kind)) : [];
  if (bad.length) {
    errors.push(kind === 'internal'
      ? `Not a section or page a group can grant: ${bad.join(', ')}.`
      : `Not a section or page an external group can grant: ${bad.join(', ')}. External groups open public and community pages only.`);
  }

  return { ok: errors.length === 0, errors, value: { id, name, note: cleanNote(body.note), kind, grants } };
}

function isLive(row, now) {
  return !(row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= now);
}

/** Roles that manage the list (D16): an owner and an admin. */
export function isManagerRole(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * Whether taking `email` out of the people who manage the list, by removal
 * or demotion, leaves none. `people` is every list row, with the ACCESS_OWNER
 * row already read as the owner it is (worker/people.js listRows), so this
 * guard bites only on a deployment with no owner set.
 */
export function wouldRemoveLastAdmin(people, email, now) {
  const target = people.find((row) => row.email === email);
  if (!target || !isManagerRole(target.role)) return false;
  return !people.some((row) => row.email !== email && isManagerRole(row.role) && isLive(row, now));
}

/** Whether taking `email` out of the owners, by removal or demotion, leaves none (D16: the last owner stays). */
export function wouldRemoveLastOwner(people, email, now) {
  const target = people.find((row) => row.email === email);
  if (!target || target.role !== 'owner') return false;
  return !people.some((row) => row.email !== email && row.role === 'owner' && isLive(row, now));
}

/**
 * Who may act on whom (D16, D24). An owner manages everyone. An admin
 * manages team, guests and other admins, and sees an owner's row read-only:
 * no edit, no remove, no resend. Nobody else reaches the People API at all.
 */
export function canManageRow(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole !== 'owner';
  return false;
}

/** Only an owner makes an owner (D16). An admin's level menu has no Owner option. */
export function canAssignRole(actorRole, role) {
  if (role === 'owner') return actorRole === 'owner';
  return isManagerRole(actorRole);
}

/**
 * The page map as the picker sees it: every page any group may be granted,
 * by section, with its level, so the page offers an external group only the
 * public and community ones (an internal group reaches the rest).
 */
export function grantablePages(pages, sections) {
  const out = [];
  for (const [path, entry] of pages) {
    if (!isGrantableScope(`page:${path}`, pages, sections, 'internal')) continue;
    // The glossary's entry pages and feed: one row each would bury the
    // picker under ~200 terms. They open with the glossary's own level
    // (cms/glossary.md), and a guest reaches them once that is public.
    if (path.startsWith('/glossary/')) continue;
    out.push({ path, title: entry.title || path, section: entry.section, level: entry.level });
  }
  out.sort((a, b) => a.section.localeCompare(b.section, 'en') || a.title.localeCompare(b.title, 'en'));
  return out;
}
