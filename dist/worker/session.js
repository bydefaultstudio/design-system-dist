/* @bydefaultstudio/design-system v8.6.0 */
/**
 * session.js - the gate itself (access-plan.md §4.2, §13.2; permissions-plan.md §4.3).
 *
 * Asked once per request by worker/index.js, for every path the §5 infrastructure
 * list does not exempt. Returns a denial to send back, or the Set-Cookie headers
 * to carry onto whatever the asset layer serves - and, since roles exist, the
 * reader the request is acting as.
 *
 * Two questions, in order. Is this session valid? - Better Auth answers from
 * the five-minute cookie cache, or from D1 when the cache is rebuilt. May this
 * reader open this path? - authorise() in gate.mjs, a Map lookup for a team
 * member or an admin, and one D1 read for a guest.
 *
 * Three properties this file exists to hold, each easy to lose in a refactor:
 *
 *   1. An anonymous request never reaches Better Auth. No session cookie means
 *      nothing to validate, so `hasSessionCookie` answers first — the path every
 *      crawler, every mail client and every unauthenticated visitor takes. Below
 *      it, the 5-minute cookie cache (auth.js COOKIE_CACHE_SECONDS) means a warm
 *      session costs no D1 read either, and the second question costs none for
 *      anyone but a guest.
 *   2. It fails closed. A thrown lookup is a denial, never an admission — the
 *      one bug in a gate that nobody notices, because the site keeps working.
 *   3. The verdict is reached before env.ASSETS is asked anything. index.js
 *      calls this first for that reason: if a missing path 404'd while a real one
 *      redirected, the gate would leak which paths exist (§12.7).
 *
 * Shape of the denial is decided by `isNavigation`, not by taste. Signed out: a
 * browser navigation gets a 302 to the login page, and Barba or fetch gets a
 * 401. Signed in but not allowed: a navigation gets the locked page at the URL
 * it asked for, with 403, the login is the wrong door for someone who is
 * already through it, and Barba or fetch gets a 403, which Barba turns into
 * a full navigation to the same URL. A 302 to login HTML answering Barba's XHR
 * is the "navigation that silently does nothing" failure in §10.
 *
 * Pure predicates live in gate.mjs and are tested by scripts/verify-auth-gate.mjs
 * and scripts/verify-authorise.mjs. This file holds only what needs Better Auth,
 * D1 and the Workers runtime.
 */
import { hideForReader } from './hidden-nav.mjs';
import { SITE } from './site.mjs';
import { getAuth, allowedRow, revokeSessions, setListedRole, setUserRole, readerScopes } from './auth.js';
import {
  ENGINE_PATHS,
  authorise,
  hasSessionCookie,
  isNavigation,
  isOwnerEmail,
  lockedFor,
  loginLocation,
  pageEntry,
  privateHeaders,
  resolveRole,
  scopeAdmits,
  accessTarget,
} from './gate.mjs';

/**
 * Never cached, never shared: a denial is specific to the cookie that was
 * missing or stale, and `Vary: Cookie` keeps an intermediary from serving it
 * to a signed-in visitor.
 */
function denialHeaders(extra) {
  return { ...extra, 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
}

function denyRequest(request, url, setCookies = []) {
  const response = isNavigation(request.headers)
    ? new Response(null, {
        status: 302,
        headers: denialHeaders({ Location: loginLocation(url.pathname, url.search) }),
      })
    : new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: denialHeaders({ 'Content-Type': 'application/json' }),
      });
  // Better Auth emits Max-Age=0 cookies when it finds a token that is expired
  // or no longer in D1. They MUST ride the denial: drop them and the browser
  // keeps a dead 30-day session_token, so hasSessionCookie() keeps saying yes
  // and every later request pays a full D1 lookup instead of being refused for
  // free. The site still works, which is why the slow path goes unnoticed.
  for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

/**
 * The locked page (permissions-plan.md §4.6), served at the requested URL so
 * the sidebar highlights the section the reader was in and a reload after
 * access is granted lands on the page itself. The page is generated with
 * site-absolute asset paths for exactly this reason (cms/locked.md). Its one
 * placeholder, data-locked-level, is filled with the level that refused the
 * reader so the panel can name who the page is for.
 *
 * A HEAD gets the status without the body; a fetch or Barba request gets JSON,
 * and Barba's request-failure fallback turns that into a full navigation here.
 */
async function notFoundForHidden(request, env, url, setCookies, viewer) {
  if (!isNavigation(request.headers)) {
    return privateHeaders(new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }), setCookies);
  }
  let page;
  try {
    page = await env.ASSETS.fetch(new Request(new URL(ENGINE_PATHS.notFound, url.origin), { method: 'GET' }));
  } catch {
    page = null;
  }
  if (!page || page.status !== 200) {
    if (page && page.body) page.body.cancel();
    return privateHeaders(new Response('Not found', { status: 404 }), setCookies);
  }
  if (request.method === 'HEAD') page.body?.cancel();
  const out = new Response(request.method === 'HEAD' ? null : page.body, { status: 404, headers: page.headers });
  out.headers.delete('ETag');
  out.headers.delete('Content-Length');
  return privateHeaders(hideForReader(out, viewer, url.href, SITE.accessNav), setCookies);
}

async function denyLocked(request, env, url, level, setCookies, viewer) {
  // Under 'earned' a page above community is hidden from the reader: the
  // refusal names neither it nor its level (community-access-plan.md D11).
  const shown = SITE.accessNav === 'earned' && level !== 'community' ? 'hidden' : level;
  // A page hidden from the reader answers as one that does not exist, so an
  // address cannot be used to learn whether an internal page is there.
  if (shown === 'hidden') return notFoundForHidden(request, env, url, setCookies, viewer);
  if (!isNavigation(request.headers)) {
    return privateHeaders(
      new Response(JSON.stringify({ error: 'forbidden', level: shown }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      setCookies,
    );
  }
  let page;
  try {
    page = await env.ASSETS.fetch(new Request(new URL(SITE.lockedPath, url.origin), { method: 'GET' }));
  } catch {
    page = null;
  }
  if (!page || page.status !== 200) {
    // The build ships the page (tools/build-site.js PUBLIC_FILES); if it is
    // ever missing the refusal still stands, just without its chrome.
    if (page && page.body) page.body.cancel();
    return privateHeaders(new Response('This page is not available to your account.', { status: 403 }), setCookies);
  }
  let body = null;
  if (request.method === 'HEAD') page.body?.cancel(); // never leave the asset stream open
  else body = lockedFor(await page.text(), shown);
  const out = new Response(body, { status: 403, headers: page.headers });
  out.headers.delete('Content-Length');
  // Under accessNav 'hidden' or 'earned' the locked page's own links are cut
  // like any other page's: a refusal must not hand over the titles it refuses.
  return privateHeaders(SITE.accessNav !== 'locked' ? hideForReader(out, viewer, url.href, SITE.accessNav) : out, setCookies);
}

/**
 * @param {string|null} pathname  the path to authorise, the RESOLVED one, so a
 *   directory request is judged as the index.html it will serve. `null` asks
 *   the first question only: the session is checked and the list re-read as
 *   usual, and the second question is skipped, for an endpoint any signed-in
 *   reader may call (the feedback form) and that is on no page map
 * @returns {Promise<{ deny: Response|null, setCookies: string[], reader: object|null }>}
 *   `deny` non-null means send it and stop. Otherwise the request is admitted,
 *   `setCookies` holds any refreshed session cookie to append to the
 *   response, dropping it silently stops sessions from ever being extended,
 *   and `reader` is { id, email, role } for handlers that need to know.
 */
export async function requireSession(request, env, url, pathname = url.pathname) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return { deny: denyRequest(request, url), setCookies: [], reader: null };
  }

  let result;
  try {
    const auth = getAuth(env, url.origin);
    // headers, never the Request: getSession's endpoint rejects a POST when it
    // can see the method, so passing the request would turn every POST to a
    // gated path into a thrown APIError.
    result = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
  } catch {
    // Fail closed. A D1 blip or a malformed cookie denies; it never admits.
    // Nothing to clear here: an APIError carries its headers out of reach.
    return { deny: denyRequest(request, url), setCookies: [], reader: null };
  }

  const setCookies = result?.headers?.getSetCookie?.() ?? [];
  const user = result?.response?.user;

  if (!result?.response?.session || !user) {
    return { deny: denyRequest(request, url, setCookies), setCookies: [], reader: null };
  }

  let role = resolveRole(user, env.ACCESS_OWNER);

  // The cookie was just rebuilt from D1, Better Auth went to the database and
  // handed back fresh cookies, so this is the moment the list is re-read
  // (access-plan.md §15, Option 1, built 2026-10-07). Once per reader per
  // five minutes, never on the warm path. The row says three things: whether
  // the person is still admitted at all, whether their time is up, and what
  // they are. A missing or expired row ends every session they hold and
  // sends them to the login; a changed role is written onto the user record,
  // so the next cache rebuild carries it and the two stores cannot drift.
  if (setCookies.length > 0) {
    let row;
    try {
      row = await allowedRow(env.DB, user.email);
      const now = Math.floor(Date.now() / 1000);
      if (!row || (row.expires_at !== null && row.expires_at <= now)) {
        await revokeSessions(env.DB, user.id);
        return { deny: denyRequest(request, url), setCookies: [], reader: null };
      }
      // The ACCESS_OWNER floor is written onto the row, once, so the People
      // page and every other reader of the list sees the owner the gate
      // already acts on (levels-groups-plan.md D16). No migration can name
      // a deployment's owner; this is where the row learns it.
      // Its own catch: before migration 0008 the CHECK refuses 'owner', and a
      // write that cannot land must never refuse the owner (the floor holds
      // through resolveRole whatever the row says).
      if (isOwnerEmail(user.email, env.ACCESS_OWNER) && row.role !== 'owner') {
        try {
          await setListedRole(env.DB, row.email, 'owner');
          row = { ...row, role: 'owner' };
        } catch (error) {
          console.error(JSON.stringify({ event: 'gate.owner_row_failed', error: String(error && error.message) }));
        }
      }
      if (row.role !== user.role) await setUserRole(env.DB, user.id, row.role);
    } catch {
      return { deny: denyRequest(request, url), setCookies: [], reader: null };
    }
    role = resolveRole({ ...user, role: row.role }, env.ACCESS_OWNER);
  }

  const reader = { id: user.id, email: user.email, role };
  // No page to judge. A guest's groups can never admit an API path, so asking
  // would refuse every guest a form they are meant to use.
  if (pathname === null) return { deny: null, setCookies, reader };
  // A markdown source is judged as its page (gate.mjs accessTarget()).
  const target = accessTarget(pathname);
  const verdict = authorise(role, target);
  if (verdict === 'allow') {
    return { deny: null, setCookies, reader };
  }

  // The locked page names the level that refused the reader: the page's own,
  // whether a deny or a refused grant (a guest's community page, a team
  // member's admin page).
  const level = pageEntry(target).level;
  let scopes = [];
  if (verdict === 'grant') {
    // A guest on a community page or a section's file, or a team member on
    // an admin page: the one D1 read the second question ever costs
    // (permissions-plan.md §4.4), of the groups their role reads.
    let admitted = false;
    try {
      scopes = await readerScopes(env.DB, user.email, role);
      admitted = scopeAdmits(scopes, target);
    } catch {
      admitted = false; // fail closed
    }
    // The scopes ride on the reader, so a page cut per reader
    // (worker/hidden-nav.mjs) does not read them a second time.
    if (admitted) return { deny: null, setCookies, reader: { ...reader, scopes } };
  }
  return { deny: await denyLocked(request, env, url, level, setCookies, { role, scopes }), setCookies: [], reader };
}
