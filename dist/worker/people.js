/* @bydefaultstudio/design-system v8.1.0 */
/**
 * people.js - the People API (permissions-plan.md §5): the list, invites,
 * roles, groups and removal, so adding a person never needs a terminal.
 *
 * Mounted at /api/people/* by worker/index.js AFTER the gate, which hands in
 * the reader; only an admin or an owner gets past the first line. Same
 * origin only, exactly: not a sibling subdomain, which the browser counts as
 * same-site and sends the session cookie from (security audit, 2026-11-08,
 * finding 5).
 *
 * Two stores, written together (§4.2): `allowed_email` is the policy, the
 * row admits a person and says what they are, and `user.role` is what the
 * session cookie carries once they have signed in. Every write here that
 * changes a role changes both, and worker/session.js re-reads the row at
 * each cookie rebuild, so neither can drift for longer than five minutes.
 *
 * Routes (JSON in, JSON out; every POST body is an object):
 *
 *   GET  /api/people/               the list, the groups, and what a group can grant
 *   POST /api/people/invite         { emails, role, groups, expiresAt, demo, note }
 *   POST /api/people/update         { email, role, groups, expiresAt, demo, note }
 *   POST /api/people/resend         { email }
 *   POST /api/people/remove         { email }   - the row AND every session (§15, enforced)
 *   POST /api/people/unlock         { email }   - lifts a sign-in lockout (FAIL_LIMITS, SEND_LIMITS)
 *   POST /api/people/groups/save    { id?, name, note, grants }
 *   POST /api/people/groups/remove  { id }
 */
import { allowedRow, parseAddress } from './auth.js';
import { FAIL_KEY_PREFIX, FAIL_LIMITS, SEND_LIMITS, evaluateRateLimit, isOwnerEmail, isSameOrigin, managesPeople, privateHeaders, sweepSendLog } from './gate.mjs';
import { SITE } from './site.mjs';
import { inviteSubject, renderInviteEmail, renderInviteText } from './email-template.mjs';
import {
  PEOPLE_BASE_PATH,
  canAssignRole,
  canManageRow,
  expiryChange,
  grantablePages,
  personStatus,
  toMillis,
  validateGroup,
  validateInvite,
  validatePerson,
  wouldRemoveLastAdmin,
  wouldRemoveLastOwner,
} from './people-core.mjs';

export { PEOPLE_BASE_PATH };

const BODY_MAX_BYTES = 16 * 1024;

// Invites are sends, so they are limited like the sign-in code is
// (access-plan.md §4.8), on the same log: per acting admin and per address.
const INVITE_LIMITS = { windowSeconds: SEND_LIMITS.windowSeconds, ip: 30, email: 3 };

const COPY = {
  forbidden: 'This page is for admins.',
  notFound: 'No one on the list has that address.',
  self: 'You cannot remove yourself. Another admin can.',
  selfRole: 'You cannot change your own level. Another admin or an owner can.',
  owner: 'This is the owner of the deployment. Their row stays.',
  ownerRow: 'Only an owner can change an owner.',
  makeOwner: 'Only an owner can make someone an owner.',
  lastOwner: 'This is the last owner. Make someone else an owner first.',
  lastAdmin: 'This is the last admin. Make someone else an admin first.',
  selfExpiry: 'You cannot change the end date on your own access. Another admin or an owner can.',
  ownerExpiry: 'The owner of the deployment has no end date.',
  ownerAddress: 'This address is the owner of the deployment. Only an owner adds it, as an owner, never as a demo.',
  demoResend: 'A demo account gets no email: any six digits sign it in.',
  demoLater: 'Only a new person can be a demo account. Add a fresh address as a demo instead.',
  limited: 'Too many invites in a short time. Wait a few minutes.',
  groupNotFound: 'That group no longer exists. Reload to see the current groups.',
  groupExists: 'A group with that name already exists. Pick another name or edit that group.',
  // Every message here is shown in a dialog word for word; the boundary
  // failures say what to do, not what the protocol was.
  notThrough: 'That request did not go through. Reload the page and try again.',
  failed: 'Something went wrong on our side. Try again.',
};

const ROLE_RANK = { guest: 0, team: 1, admin: 2, owner: 3 };

export async function handlePeople(request, env, url, reader, setCookies = []) {
  if (!reader || !managesPeople(reader.role)) return respond({ error: COPY.forbidden }, 403, setCookies);
  if (!isSameOrigin(request.headers, url.origin, request.method)) return respond({ error: COPY.notThrough }, 403, setCookies);

  const route = url.pathname.slice(PEOPLE_BASE_PATH.length);
  try {
    if (request.method === 'GET' && route === '') {
      return respond(await listEverything(env, reader), 200, setCookies);
    }
    if (request.method !== 'POST') return respond({ error: COPY.failed }, 405, setCookies);

    const body = await readJson(request);
    if (!body) return respond({ error: COPY.notThrough }, 400, setCookies);

    const now = Math.floor(Date.now() / 1000);
    let result;
    switch (route) {
      case 'invite': result = await invite(env, url, reader, body, now); break;
      case 'update': result = await update(env, reader, body, now); break;
      case 'resend': result = await resend(env, url, reader, body, now); break;
      case 'remove': result = await remove(env, reader, body, now); break;
      case 'unlock': result = await unlock(env, reader, body); break;
      case 'groups/save': result = await saveGroup(env, body); break;
      case 'groups/remove': result = await removeGroup(env, body); break;
      default: result = { status: 404, body: { error: COPY.failed } };
    }
    return respond(result.body, result.status, setCookies);
  } catch (error) {
    console.error(JSON.stringify({ event: 'people.failed', route, error: String(error && error.message) }));
    return respond({ error: COPY.failed }, 500, setCookies);
  }
}

/* ------ Read ------ */

async function listEverything(env, reader) {
  const now = Math.floor(Date.now() / 1000);
  const [people, members, groups, grants, failures] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.email, a.role, a.expires_at, a.invited_by, a.demo, a.note, a.added_at,
              u.id AS user_id, u.name AS user_name,
              (SELECT MAX(s.createdAt) FROM session s WHERE s.userId = u.id) AS last_sign_in
         FROM allowed_email a LEFT JOIN user u ON u.email = a.email
        ORDER BY a.added_at, a.email`,
    ),
    env.DB.prepare('SELECT group_id, email FROM access_group_member'),
    env.DB.prepare('SELECT id, name, note FROM access_group ORDER BY name'),
    env.DB.prepare('SELECT group_id, scope FROM access_group_grant ORDER BY scope'),
    // The day's failed sign-in codes per address, for the Locked out badge.
    env.DB.prepare('SELECT key, COUNT(*) AS n FROM otp_send_log WHERE key LIKE ?1 AND at > ?2 GROUP BY key')
      .bind(`${FAIL_KEY_PREFIX}%`, now - FAIL_LIMITS.windowSeconds),
  ]);

  const groupsByEmail = new Map();
  for (const row of members.results) {
    if (!groupsByEmail.has(row.email)) groupsByEmail.set(row.email, []);
    groupsByEmail.get(row.email).push(row.group_id);
  }
  const grantsByGroup = new Map();
  for (const row of grants.results) {
    if (!grantsByGroup.has(row.group_id)) grantsByGroup.set(row.group_id, []);
    grantsByGroup.get(row.group_id).push(row.scope);
  }
  const lockedOut = new Set();
  for (const row of failures.results) {
    if (Number(row.n) >= FAIL_LIMITS.max) lockedOut.add(row.key.slice(FAIL_KEY_PREFIX.length));
  }
  const membersByGroup = new Map();
  for (const row of members.results) {
    membersByGroup.set(row.group_id, (membersByGroup.get(row.group_id) || 0) + 1);
  }

  return {
    viewer: { email: reader.email, role: reader.role, owner: reader.role === 'owner' },
    now,
    people: people.results.map((row) => ({
      email: row.email,
      name: row.user_name || '',
      role: row.role,
      groups: groupsByEmail.get(row.email) || [],
      expiresAt: row.expires_at,
      demo: row.demo === 1,
      note: row.note || '',
      invitedBy: row.invited_by || '',
      addedAt: row.added_at,
      signedUp: !!row.user_id,
      lastSignIn: toMillis(row.last_sign_in),
      status: personStatus(row, now),
      // Over the day's failed-code cap: sign-in refused until it is lifted.
      locked: lockedOut.has(row.email),
      // The owner named in wrangler.jsonc is an owner whatever the row says.
      owner: row.role === 'owner' || isOwner(env, row.email),
      // The ACCESS_OWNER row itself: never removed, never demoted.
      floor: isOwner(env, row.email),
      // Whether this viewer may edit, remove or resend for the row (D24):
      // an admin sees an owner's row read-only.
      editable: canManageRow(reader.role, rowRole(env, row)),
    })),
    groups: groups.results.map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note || '',
      grants: grantsByGroup.get(row.id) || [],
      members: membersByGroup.get(row.id) || 0,
    })),
    sections: Object.entries(SITE.sections).map(([folder, label]) => ({ folder, label })),
    pages: grantablePages(SITE.pages, SITE.sections),
  };
}

/* ------ Write ------ */

async function invite(env, url, reader, body, now) {
  const groupIds = await listGroupIds(env);
  const checked = validateInvite(body, { groupIds, now });
  if (!checked.ok) return { status: 400, body: { error: checked.errors.join(' ') } };
  const { emails, role, groups, expiresAt, demo, note } = checked.value;
  if (!canAssignRole(reader.role, role)) return { status: 403, body: { error: COPY.makeOwner } };
  if (emails.some((email) => isOwner(env, email)) && (role !== 'owner' || demo)) return { status: 409, body: { error: COPY.ownerAddress } };

  const existing = await env.DB
    .prepare(`SELECT email FROM allowed_email WHERE email IN (${emails.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...emails)
    .all();
  if (existing.results.length) {
    const listed = existing.results.map((r) => r.email).join(', ');
    const one = existing.results.length === 1;
    return { status: 409, body: { error: `Nothing added: ${listed} ${one ? 'is' : 'are'} already on the list. Take ${one ? 'it' : 'them'} out and add the rest.` } };
  }

  // Limited before anything is written, on the same sliding window as the
  // sign-in send: one record per address, so the count is per admin AND per
  // address, and a batch cannot slip under it.
  const limited = await recordAndCheckSends(env, reader.email, emails, now);
  if (limited) return { status: 429, body: { error: COPY.limited } };

  const statements = [];
  for (const email of emails) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO allowed_email (email, note, role, expires_at, invited_by, demo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      ).bind(email, note, role, expiresAt, reader.email, demo ? 1 : 0),
    );
    for (const groupId of groups) {
      statements.push(env.DB.prepare('INSERT INTO access_group_member (group_id, email) VALUES (?1, ?2)').bind(groupId, email));
    }
  }
  await env.DB.batch(statements);

  const sent = [];
  const unsent = [];
  if (!demo) {
    const opens = await grantedSections(env, groups);
    for (const email of emails) {
      const ok = await sendInvite(env, url.origin, { email, invitedBy: reader.email, expiresAt, role, opens });
      (ok ? sent : unsent).push(email);
    }
  }
  return { status: 200, body: { ok: true, added: emails, sent, unsent } };
}

async function update(env, reader, body, now) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const row = await allowedRow(env.DB, email);
  if (!row) return { status: 404, body: { error: COPY.notFound } };

  const groupIds = await listGroupIds(env);
  const checked = validatePerson(body, { groupIds, now });
  if (!checked.ok) return { status: 400, body: { error: checked.errors.join(' ') } };
  const { role, groups, expiresAt, demo, note } = checked.value;
  const current = rowRole(env, row);

  // Who may act on whom (D16, D24), before anything about the change itself.
  if (!canManageRow(reader.role, current)) return { status: 403, body: { error: COPY.ownerRow } };
  if (!canAssignRole(reader.role, role)) return { status: 403, body: { error: COPY.makeOwner } };
  // Demo is set at invite only. Turned on later it would let whoever knows
  // the address sign in as a real person, with no code (security audit,
  // 2026-11-08, finding 1).
  if (demo && row.demo !== 1) return { status: 409, body: { error: COPY.demoLater } };
  // An end date is a removal on a timer, so it meets the same guards as
  // one (code review, 2026-11-08): never on your own row, never on the
  // ACCESS_OWNER row, and never on the last owner or last manager. Any
  // change to one's own date counts, clearing it included: an admin on a
  // timer could otherwise make their own access open-ended (security audit
  // 2026-11-09, finding 8). The page resubmits the stored day on an
  // untouched row, so editing one's own note still passes.
  const expiry = expiryChange(row.expires_at, expiresAt);
  if (expiry.changed && email === reader.email) return { status: 409, body: { error: COPY.selfExpiry } };
  if (expiry.changed && isOwner(env, email)) return { status: 409, body: { error: COPY.ownerExpiry } };
  if (role !== current || expiry.set) {
    if (role !== current && email === reader.email) return { status: 409, body: { error: COPY.selfRole } };
    // The ACCESS_OWNER floor is an owner whatever the row says; a demotion
    // would show on the page and change nothing at the gate.
    if (role !== current && isOwner(env, email)) return { status: 409, body: { error: COPY.owner } };
    const people = await listRows(env);
    if ((role !== 'owner' || expiry.set) && wouldRemoveLastOwner(people, email, now)) return { status: 409, body: { error: COPY.lastOwner } };
    if ((!managesPeople(role) || expiry.set) && wouldRemoveLastAdmin(people, email, now)) return { status: 409, body: { error: COPY.lastAdmin } };
  }
  // An unchanged role is written back as stored, so editing the note on the
  // ACCESS_OWNER row before migration 0008 does not trip the old CHECK.
  const storedRole = role === current ? row.role : role;
  // A demotion takes effect now: the sessions end, and the next sign-in
  // carries the new role (worker/auth.js, preflightVerify). A promotion
  // waits for the cookie cache, up to five minutes, which costs nobody
  // anything. The owner named in ACCESS_OWNER is admin whatever the row says.
  // Turning demo off ends every session too: anyone handed the demo address
  // keeps nothing once the demo is over.
  const demoted = (ROLE_RANK[role] < ROLE_RANK[current] && !isOwner(env, email)) || (row.demo === 1 && !demo);

  const statements = [
    env.DB.prepare(
      'UPDATE allowed_email SET role = ?1, expires_at = ?2, demo = ?3, note = ?4 WHERE email = ?5',
    ).bind(storedRole, expiresAt, demo ? 1 : 0, note, email),
    // The signed-in record follows the list, so the next cookie rebuild
    // carries the new role. No user row yet is fine: the hook copies the
    // role at first sign-in.
    env.DB.prepare('UPDATE user SET role = ?1 WHERE email = ?2').bind(storedRole, email),
    env.DB.prepare('DELETE FROM access_group_member WHERE email = ?1').bind(email),
  ];
  for (const groupId of groups) {
    statements.push(env.DB.prepare('INSERT INTO access_group_member (group_id, email) VALUES (?1, ?2)').bind(groupId, email));
  }
  if (demoted) {
    statements.push(env.DB.prepare('DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email = ?1)').bind(email));
  }
  // A demo's fixed code lives in Better Auth's verification table, under the
  // plugin's identifier for a sign-in code, and outlives the flag: turned
  // off, the address still signed in with 000000 until the code expired,
  // and a resend (resendStrategy 'reuse') kept it alive (security audit
  // 2026-11-09, finding 5). Demo off is credential revocation too.
  if (row.demo === 1 && !demo) {
    statements.push(env.DB.prepare('DELETE FROM verification WHERE identifier = ?1').bind(signInCodeIdentifier(email)));
  }
  await env.DB.batch(statements);
  return { status: 200, body: { ok: true, signedOut: demoted } };
}

async function resend(env, url, reader, body, now) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const row = await allowedRow(env.DB, email);
  if (!row) return { status: 404, body: { error: COPY.notFound } };
  if (!canManageRow(reader.role, rowRole(env, row))) return { status: 403, body: { error: COPY.ownerRow } };
  if (row.demo === 1) return { status: 400, body: { error: COPY.demoResend } };
  const limited = await recordAndCheckSends(env, reader.email, [email], now);
  if (limited) return { status: 429, body: { error: COPY.limited } };
  const memberships = await env.DB.prepare('SELECT group_id FROM access_group_member WHERE email = ?1').bind(email).all();
  const opens = await grantedSections(env, memberships.results.map((r) => r.group_id));
  const ok = await sendInvite(env, url.origin, { email, invitedBy: reader.email, expiresAt: row.expires_at, role: row.role, opens });
  return ok
    ? { status: 200, body: { ok: true } }
    : { status: 502, body: { error: 'The email did not send. Try again in a moment.' } };
}

async function remove(env, reader, body, now) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === reader.email) return { status: 409, body: { error: COPY.self } };
  // The lockout floor holds against other admins too: the owner's row stays.
  if (isOwner(env, email)) return { status: 409, body: { error: COPY.owner } };
  const row = await allowedRow(env.DB, email);
  if (!row) return { status: 404, body: { error: COPY.notFound } };
  if (!canManageRow(reader.role, rowRole(env, row))) return { status: 403, body: { error: COPY.ownerRow } };
  const people = await listRows(env);
  if (wouldRemoveLastOwner(people, email, now)) return { status: 409, body: { error: COPY.lastOwner } };
  if (wouldRemoveLastAdmin(people, email, now)) return { status: 409, body: { error: COPY.lastAdmin } };

  // Both statements of access-plan.md §15, as one transaction: the row (its
  // memberships cascade) and the person's sessions, through the user row,
  // which cascades them. A re-invite later makes a fresh user with the role
  // the new row says, rather than inheriting a stale one. Any live sign-in
  // code goes with them: the create hook would refuse it anyway, but a
  // removed demo's fixed code has no business outliving the row.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM allowed_email WHERE email = ?1').bind(email),
    env.DB.prepare('DELETE FROM user WHERE email = ?1').bind(email),
    env.DB.prepare('DELETE FROM verification WHERE identifier = ?1').bind(signInCodeIdentifier(email)),
  ]);
  return { status: 200, body: { ok: true } };
}

/**
 * Lift a sign-in lockout (security audit 2026-11-09, findings 2 and 3): the
 * day's failed codes, the address's send window, and any live code, so the
 * person can ask for a fresh one at once. The IP keys stay: they meter a
 * network, not this person. Allowed wherever Edit is (canManageRow), the
 * viewer's own row included, since lifting changes no access.
 */
async function unlock(env, reader, body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const row = await allowedRow(env.DB, email);
  if (!row) return { status: 404, body: { error: COPY.notFound } };
  if (!canManageRow(reader.role, rowRole(env, row))) return { status: 403, body: { error: COPY.ownerRow } };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM otp_send_log WHERE key IN (?1, ?2)').bind(`${FAIL_KEY_PREFIX}${row.email}`, `email:${row.email}`),
    env.DB.prepare('DELETE FROM verification WHERE identifier = ?1').bind(signInCodeIdentifier(row.email)),
  ]);
  console.info(JSON.stringify({ event: 'people.unlock', by: reader.email, email: row.email }));
  return { status: 200, body: { ok: true } };
}

async function saveGroup(env, body) {
  const checked = validateGroup(body, { pages: SITE.pages, sections: SITE.sections });
  if (!checked.ok) return { status: 400, body: { error: checked.errors.join(' ') } };
  const { id, name, note, grants } = checked.value;
  const existing = await env.DB.prepare('SELECT id FROM access_group WHERE id = ?1').bind(id).first();
  const editing = typeof body.id === 'string' && body.id.trim() !== '';
  if (editing && !existing) return { status: 404, body: { error: COPY.groupNotFound } };
  if (!editing && existing) return { status: 409, body: { error: COPY.groupExists } };

  const statements = [
    existing
      ? env.DB.prepare('UPDATE access_group SET name = ?1, note = ?2 WHERE id = ?3').bind(name, note, id)
      : env.DB.prepare('INSERT INTO access_group (id, name, note) VALUES (?1, ?2, ?3)').bind(id, name, note),
    env.DB.prepare('DELETE FROM access_group_grant WHERE group_id = ?1').bind(id),
  ];
  for (const scope of grants) {
    statements.push(env.DB.prepare('INSERT INTO access_group_grant (group_id, scope) VALUES (?1, ?2)').bind(id, scope));
  }
  await env.DB.batch(statements);
  return { status: 200, body: { ok: true, id } };
}

async function removeGroup(env, body) {
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const existing = await env.DB.prepare('SELECT id FROM access_group WHERE id = ?1').bind(id).first();
  if (!existing) return { status: 404, body: { error: COPY.groupNotFound } };
  await env.DB.prepare('DELETE FROM access_group WHERE id = ?1').bind(id).run();
  return { status: 200, body: { ok: true } };
}

/* ------ Helpers ------ */

function isOwner(env, email) {
  return isOwnerEmail(email, env.ACCESS_OWNER);
}

/**
 * The `verification.identifier` Better Auth's email-otp plugin stores a
 * sign-in code under: `${type}-otp-${email}` (dist/plugins/email-otp/utils.mjs,
 * 1.7.7). The one place outside worker/auth.js that touches that table.
 */
function signInCodeIdentifier(email) {
  return `sign-in-otp-${email}`;
}

/** A row's role as the gate acts on it: the ACCESS_OWNER row is an owner whatever it says. */
function rowRole(env, row) {
  return isOwner(env, row.email) ? 'owner' : row.role;
}

async function listGroupIds(env) {
  const { results } = await env.DB.prepare('SELECT id FROM access_group').all();
  return results.map((row) => row.id);
}

/** Every row, with the ACCESS_OWNER row read as the owner it is, so both last-of guards count them. */
async function listRows(env) {
  const { results } = await env.DB.prepare('SELECT email, role, expires_at FROM allowed_email').all();
  return results.map((row) => ({ ...row, role: rowRole(env, row) }));
}

/**
 * One record per address on the sign-in send log, under the admin's key and
 * the address's own invite key, then the window counted; the invite proceeds
 * only when neither key is over. The invite key is its own (`invite-to:`),
 * not the sign-in send's `email:` key - an invite must not use up the new
 * person's own code sends, nor their sends the admin's resend. The sweep
 * keeps the table small, as the send preflight's does.
 */
async function recordAndCheckSends(env, adminEmail, emails, now) {
  const adminKey = `invite:${adminEmail}`;
  const windowStart = now - INVITE_LIMITS.windowSeconds;
  const statements = sweepSendLog(env.DB, now);
  for (const email of emails) {
    statements.push(env.DB.prepare('INSERT INTO otp_send_log (key, at) VALUES (?1, ?3), (?2, ?3)').bind(adminKey, `invite-to:${email}`, now));
  }
  const keys = [adminKey, ...emails.map((email) => `invite-to:${email}`)];
  statements.push(
    env.DB.prepare(
      `SELECT key, COUNT(*) AS n, MIN(at) AS oldest FROM otp_send_log WHERE key IN (${keys.map((_, i) => `?${i + 2}`).join(', ')}) AND at > ?1 GROUP BY key`,
    ).bind(windowStart, ...keys),
  );
  const results = await env.DB.batch(statements);
  const counts = results[results.length - 1].results;
  for (const email of emails) {
    if (evaluateRateLimit(counts, adminKey, `invite-to:${email}`, now, INVITE_LIMITS).limited) return true;
  }
  return false;
}

/** The section labels (and page titles) a guest's groups open, for the invite's one line about what they can open. */
async function grantedSections(env, groupIds) {
  if (!groupIds.length) return [];
  const { results } = await env.DB
    .prepare(`SELECT DISTINCT scope FROM access_group_grant WHERE group_id IN (${groupIds.map((_, i) => `?${i + 1}`).join(', ')}) ORDER BY scope`)
    .bind(...groupIds)
    .all();
  const labels = [];
  for (const row of results) {
    if (row.scope.startsWith('section:')) {
      const folder = row.scope.slice('section:'.length);
      if (SITE.sections[folder]) labels.push(SITE.sections[folder]);
    } else if (row.scope.startsWith('page:')) {
      const entry = SITE.pages.get(row.scope.slice('page:'.length));
      if (entry) labels.push(entry.title);
    }
  }
  return labels;
}

async function sendInvite(env, origin, { email, invitedBy, expiresAt, role, opens }) {
  try {
    await env.EMAIL.send({
      from: parseAddress(env.AUTH_EMAIL_FROM),
      to: email,
      subject: inviteSubject(),
      html: renderInviteEmail({ origin, email, invitedBy, expiresAt, role, opens }),
      text: renderInviteText({ origin, email, invitedBy, expiresAt, role, opens }),
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: 'people.invite.send_failed', to: email, error: String(error && error.message) }));
    return false;
  }
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > BODY_MAX_BYTES) return null;
  let body;
  try {
    const text = await request.text();
    if (text.length > BODY_MAX_BYTES) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function respond(body, status, setCookies) {
  return privateHeaders(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    setCookies,
  );
}
