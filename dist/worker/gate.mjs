/* @bydefaultstudio/design-system v7.5.1 */
/**
 * gate.mjs — the pure half of the access gate: route lists and predicates.
 *
 * No Workers APIs and no I/O, so scripts/verify-auth-gate.mjs and
 * scripts/verify-authorise.mjs import it in plain node, which is why it is
 * .mjs: the package is "type": "commonjs", and wrangler's bundler reads ESM
 * either way. worker/session.js and worker/auth.js call into here; nothing
 * here calls out.
 *
 * The gate asks two questions (access-plan.md §4.2; permissions-plan.md §4.3):
 *
 *   1. Is this session valid? - worker/session.js, with Better Auth.
 *   2. May this reader open this page? - authorise() below, a Map lookup for
 *      a team member or an admin; one D1 read, for a guest, done by the caller.
 *
 * Public routes have TWO sources, kept apart on purpose (access-plan.md §5,
 * §12.4), and this file holds only the first:
 *
 *   1. INFRASTRUCTURE — assets, endpoints, text files. The engine's lists
 *      below and the site's own (worker/site.mjs), reviewed by hand, never
 *      derived from a page.
 *   2. PAGES - every generated page's level, from its `access:` frontmatter,
 *      compiled by the docs kit into the site's worker/page-access.mjs and
 *      handed to createGate() (worker/site.mjs holds it). A page with
 *      `access: "public"` is open; `team`, `admin` and `owner` are the gated
 *      levels. Never add a page to a public list and never add a route to
 *      the page map.
 *
 * Anything matching neither is gated at the team level: a new folder ships
 * gated, a path the build never wrote is a team page that does not exist.
 * Two exceptions fail higher still: a markdown source off the map is admin
 * only, and an HTML file under a section folder off the map is owner only,
 * because the build wrote every page it generated into the map, and a section
 * file it did not is a copy nobody chose to ship. Fail closed.
 */
import { normaliseRole } from './auth-schema.mjs';
import { SITE } from './site.mjs';

export { normaliseRole };

// The default login and locked pages. A site may move either
// (createGate loginPath, lockedPath); the Worker reads SITE, never these.
export const LOGIN_PATH = '/auth/login.html';

/**
 * The page a signed-in reader is shown when authorise() says no, generated
 * from cms/locked.md and served by the Worker AT THE REQUESTED URL with 403,
 * so the sidebar highlights the section and the URL survives a reload. It is
 * an ordinary gated page when reached by its own address.
 */
export const LOCKED_PATH = '/locked.html';

/**
 * The landing page a signed-out visitor is shown at the site's home, the way
 * figma.com and notion.com answer one address with two front doors: the
 * marketing page signed out, the product signed in. It is also public at its
 * own address, so it can be shared and a signed-in reader can see it.
 */
// The landing page itself is the site's (worker/site.mjs landingPath): a
// site with none sends every signed-out visitor to the login.

/**
 * Whether a gated request that was refused for having no session should be
 * answered with the landing page instead of a trip to the login. Only the
 * home (`/`, which the Worker resolves to /index.html) qualifies, and only for
 * a GET or HEAD navigation from a visitor with NO session cookie: everything
 * else keeps its refusal. `denyStatus` is what requireSession() produced. 302
 * is a refused navigation; 401 is a fetch or Barba request, which expects JSON
 * and keeps it; 403 is a signed-in reader who may not open the page, and keeps
 * its locked page. The cookie check matters because requireSession() also
 * answers 302 for a reader WITH a cookie whose session failed (expired, removed
 * from the list, or a D1 error). That reader belongs at the login, not on the
 * marketing page, so only a visitor who never signed in is shown it.
 */
export function servesLanding(resolvedPath, method, denyStatus, cookieHeader) {
  return SITE.landingPath !== null
    && resolvedPath === '/index.html'
    && (method === 'GET' || method === 'HEAD')
    && denyStatus === 302
    && !hasSessionCookie(cookieHeader);
}

/**
 * Infrastructure the engine itself opens to everyone, whatever the site:
 * the login page (a gated login cannot be reached to log in), robots.txt,
 * the assets the login page loads, and Better Auth's own endpoints. A site
 * adds its own through createGate() (worker/site.mjs publicPaths and
 * publicPrefixes), never by editing these.
 */
export const ENGINE_PUBLIC_PATHS = new Set(['/robots.txt']);
export const ENGINE_PUBLIC_PREFIXES = ['/assets/', '/api/auth/'];

// Pages meant to be framed by other sites (worker/site.mjs embeddablePaths).
// The site-wide X-Frame-Options: SAMEORIGIN (_headers) stops Notion and
// dashboards from showing them, so the Worker lifts it for these paths and
// says who may frame them instead. Set here rather than in _headers:
// _headers does not reliably reach a response the Worker returns.
export function isEmbeddablePath(pathname) {
  return SITE.embeddablePaths.has(pathname);
}

export function embeddableHeaders(response) {
  const out = new Response(response.body, response);
  out.headers.delete('X-Frame-Options');
  out.headers.set('Content-Security-Policy', 'frame-ancestors *');
  return out;
}

/**
 * What the map says about a path, or the default for one it does not know:
 * a team page with no section, gated to the team, granted to no guest.
 * Frozen so a caller cannot edit the shared default by accident.
 */
export const DEFAULT_ENTRY = Object.freeze({ level: 'team', section: '', type: '' });

/**
 * The path the second question judges. A published markdown source is judged
 * as the page it is the source of, so an admin page's source is an admin
 * path; without this it fell to the default team entry and a team reader could
 * read every admin page's source (proved 2026-11-07). Any other path is itself.
 */
export function accessTarget(pathname, sources = SITE.sources) {
  return sources.get(pathname) || pathname;
}

/**
 * A markdown source the map does not know: admin only. A source is published
 * by tools/build-site.js whatever the map says, so one left off it (a stale
 * map, a brand-space source) fails closed instead of falling to team.
 */
export const UNMAPPED_SOURCE_ENTRY = Object.freeze({ level: 'admin', section: '', type: '' });

/** A published markdown source: a .md file under the site's source folder (worker/site.mjs sourcePrefix). */
function isSourcePath(pathname) {
  return pathname.startsWith(SITE.sourcePrefix) && pathname.endsWith('.md') && pathname.length > SITE.sourcePrefix.length + 3;
}

/**
 * An HTML page under one of the site's section folders that the map does not
 * know: owner only. The build writes every page it generates into the map,
 * so a section file off it is one the build never meant to ship, and on the
 * iCloud-mounted checkout that is a sync-conflict copy of a real page, often
 * an admin or owner one (security audit 2026-11-09, finding 4). It fails to
 * the top, not to team. A hand-authored page a site does want under a
 * section is added to the map it passes createGate() (site-config.mjs).
 */
export const UNMAPPED_PAGE_ENTRY = Object.freeze({ level: 'owner', section: '', type: '' });

/**
 * A sync-conflict duplicate's name in any segment of the path: the original's
 * with a space and a number before the extension ("people 3.html", or "%203"
 * once in a URL), or a whole folder's ("web 2/people.html"). Never a page
 * the build wrote; refused outright, before any level is asked.
 */
export function isConflictCopyPath(pathname) {
  return /(?: |%20)\d+(?:\.[a-z0-9]+)?(?:\/|$)/i.test(pathname);
}

function isUnmappedSectionPage(pathname, pages, sections) {
  if (!pathname.endsWith('.html') || pages.has(pathname)) return false;
  const section = sectionOf(pathname);
  return section !== '' && Object.prototype.hasOwnProperty.call(sections, section);
}

export function pageEntry(pathname, pages = SITE.pages, sections = SITE.sections) {
  const entry = pages.get(pathname);
  if (entry) return entry;
  if (isSourcePath(pathname)) return UNMAPPED_SOURCE_ENTRY;
  if (isUnmappedSectionPage(pathname, pages, sections)) return UNMAPPED_PAGE_ENTRY;
  return DEFAULT_ENTRY;
}

/**
 * The LLM reference carries every foundation and core page's text, all of
 * them team pages. Under accessNav 'hidden' a signed-out reader sees public
 * pages only, so the files are gated with the rest (code review, 2026-11-09).
 */
const LLM_FILES = new Set(['/llms.txt', '/llms-full.txt']);

export function isPublicPath(pathname, pages = SITE.pages, accessNav = SITE.accessNav) {
  if (accessNav === 'hidden' && LLM_FILES.has(pathname)) return false;
  if (ENGINE_PUBLIC_PATHS.has(pathname) || pathname === SITE.loginPath || SITE.publicPaths.has(pathname)) return true;
  if (SITE.landingPath !== null && pathname === SITE.landingPath) return true;
  const entry = pages.get(pathname);
  if (entry && entry.level === 'public') return true;
  return ENGINE_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || SITE.publicPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The home shelf and the section indexes open to every signed-in reader,
 * guests included (permissions-plan.md §3.2): the titles on them are the
 * same ones the locked sidebar already shows a signed-out visitor. Keyed on
 * the path, not the entry's type: a page may borrow the shelf chrome (the
 * Lab does) without being an index, and nav.js reads the same rule from
 * the href it has.
 */
export function isIndexPath(pathname) {
  return pathname === '/index.html' || /^\/[a-z0-9-]+\/index\.html$/.test(pathname);
}

/**
 * Pages every signed-in reader opens, whatever their role: a reader's own
 * account. Not public (a signed-out visitor still goes to sign in), and not
 * a page-map entry, because the map only knows page levels, and a
 * guest's groups would otherwise have to name the page to reach it.
 */
export const SIGNED_IN_EXACT = new Set(['/auth/account.html']);

/**
 * The role a reader acts with. The person named in ACCESS_OWNER
 * (wrangler.jsonc) is an owner whatever their row says, the lockout floor: a
 * deployment cannot refuse the person who runs it, and the first owner needs
 * no SQL to become one (levels-groups-plan.md D16). worker/session.js also
 * writes `owner` onto that row, so the People page shows what the gate does.
 * Everyone else is what their user record says, read from the cookie cache on
 * the warm path, so a role change takes up to five minutes, the same tail
 * as revocation (access-plan.md §15).
 */
export function resolveRole(user, ownerEmail) {
  if (isOwnerEmail(user && user.email, ownerEmail)) return 'owner';
  return normaliseRole(user && user.role);
}

/**
 * Whether sign-in answers on this hostname: one of the site's domains or a
 * subdomain of one (worker/site.mjs hosts), or localhost for local runs.
 * baseURL is derived from the request, so an unexpected Host must never
 * become a trusted origin.
 */
export function isAllowedHost(host, hosts = SITE.hosts) {
  if (!host) return false;
  const name = String(host).toLowerCase().split(':')[0];
  if (name === 'localhost' || name === '127.0.0.1') return true;
  return hosts.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** Whether `email` is the one ACCESS_OWNER names. Empty on either side is never a match. */
export function isOwnerEmail(email, ownerEmail) {
  const a = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const b = typeof ownerEmail === 'string' ? ownerEmail.trim().toLowerCase() : '';
  return a !== '' && a === b;
}

/**
 * Whether a request to a signed-in API comes from this very origin. The
 * session cookie is SameSite=Lax, so a page on any sibling subdomain is
 * same-site and the browser sends it; a suffix match on the domain would let
 * such a page drive an admin's session (security audit, 2026-11-08, finding
 * 5). Exact scheme, host and port, or nothing. A read with neither header is
 * allowed, as browsers omit Origin on a same-origin GET; a write never is.
 */
export function isSameOrigin(headers, origin, method = 'POST') {
  const source = headers.get('origin') || headers.get('referer');
  if (!source) return method === 'GET' || method === 'HEAD';
  try {
    return new URL(source).origin === origin;
  } catch {
    return false;
  }
}

/** Roles that may open the People page and manage the list: an admin and an owner. */
export function managesPeople(role) {
  return role === 'owner' || role === 'admin';
}

/**
 * The levels a group can never open (D17, D23): admin and owner pages stay
 * with the roles they are named for, whatever a guest's groups say.
 */
export function isClosedToGroups(level) {
  return level === 'admin' || level === 'owner';
}

/**
 * The second question, as a pure function (permissions-plan.md §4.3).
 *
 *   'allow'  - serve.
 *   'deny'   - the locked page (403); never a 302, the reader is signed in.
 *              Only ever an admin or an owner page.
 *   'grant'  - a guest on a page their groups may cover: the caller asks the
 *              database (one read, guests only) and turns the answer into
 *              allow or deny.
 *
 * Owner, admin and team never reach 'grant': their verdict costs a Map lookup and
 * nothing else, which is what keeps the hot path free of D1 (§8).
 */
export function authorise(role, pathname, pages = SITE.pages, sections = SITE.sections) {
  if (isConflictCopyPath(pathname)) return 'deny';
  // A reader's own account opens for every role, before any level is read:
  // it sits under a folder the map does not list.
  if (SIGNED_IN_EXACT.has(pathname)) return 'allow';
  const entry = pageEntry(pathname, pages, sections);
  if (entry.level === 'public') return 'allow';
  if (role === 'owner') return 'allow';
  // An owner page runs the engine and the deployment (D23): closed to a
  // client's admin as much as to anyone else.
  if (entry.level === 'owner') return 'deny';
  if (role === 'admin') return 'allow';
  if (entry.level === 'admin') return 'deny';
  if (role === 'team') return 'allow';
  if (isIndexPath(pathname)) return 'allow';
  return 'grant';
}

/**
 * The locked page's markup for the level that refused the reader. The page
 * holds one wording per level; only the matching one is kept, so the
 * sentence is right without CSS (reader mode, forced styles), not merely
 * hidden by it.
 */
export function lockedFor(html, level) {
  const shown = level === 'owner' || level === 'admin' ? level : 'team';
  return html
    .replace('data-locked-level=""', `data-locked-level="${shown}"`)
    .replace(/<span data-for="(team|admin|owner)">([^<]*)<\/span>/g, (match, who, text) => (who === shown ? text : ''));
}

/**
 * Whether a link or card to `pathname` at `level` stays in a page served to
 * this reader under `accessNav: 'hidden'` (levels-groups-plan.md D19, §3.3).
 * The same order as authorise(), answered for a link rather than a request:
 * `role` is null for a signed-out reader, who keeps public pages only;
 * `scopes` are a guest's grants. worker/hidden-nav.mjs removes what this
 * refuses; the gate still refuses the page itself if it is reached.
 */
export function navVisible(role, scopes, level, pathname) {
  if (level === 'public') return true;
  if (!role) return false;
  if (role === 'owner') return true;
  if (level === 'owner') return false;
  if (role === 'admin') return true;
  if (level === 'admin') return false;
  if (role === 'team') return true;
  if (isIndexPath(pathname)) return true;
  return scopeAdmits(scopes, pathname);
}

/** The output folder a path sits in - "tools" for /tools/x.html, '' at the root. */
export function sectionOf(pathname) {
  const match = /^\/([a-z0-9-]+)\/[^/]+$/.exec(pathname);
  return match ? match[1] : '';
}

/**
 * Whether a guest's scopes reach a path. A scope is 'section:<folder>' or
 * 'page:<path>'; the first admits every page in that output folder, the
 * second one page. Additive, exact, no wildcards (permissions-plan.md §3.3).
 */
export function scopeAdmits(scopes, pathname) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  const section = sectionOf(pathname);
  for (const scope of scopes) {
    if (typeof scope !== 'string') continue;
    if (scope === `page:${pathname}`) return true;
    if (section && scope === `section:${section}`) return true;
  }
  return false;
}

/**
 * A grant the People page may save: a section the site has, or a page the map
 * knows that is neither an admin nor an owner page (a group can never reach
 * one, §3.1, D23). A section grant may name a section that holds such pages;
 * authorise() answers them before it ever asks about grants.
 */
export function isGrantableScope(scope, pages = SITE.pages, sections = SITE.sections) {
  if (typeof scope !== 'string') return false;
  if (scope.startsWith('section:')) {
    const folder = scope.slice('section:'.length);
    return Object.prototype.hasOwnProperty.call(sections, folder);
  }
  if (scope.startsWith('page:')) {
    const pathname = scope.slice('page:'.length);
    const entry = pages.get(pathname);
    return !!entry && !isClosedToGroups(entry.level) && !isIndexPath(pathname);
  }
  return false;
}

/**
 * Where an unauthenticated navigation is sent. `next` carries path + search so
 * a deep link lands where it pointed once signed in; the hash never reaches
 * the server. `/` gets no `next` — the login page's own default is `/`.
 */
export function loginLocation(pathname, search = '') {
  const target = pathname + search;
  if (target === '/') return SITE.loginPath;
  return `${SITE.loginPath}?next=${encodeURIComponent(target)}`;
}

/**
 * A browser navigation gets a 302 to the login page. A Barba fetch, or any
 * other programmatic request, gets a 401 instead — a 302 to login HTML is
 * exactly the "navigation that silently does nothing" access-plan.md §10
 * warns about, because Barba's XHR follows it and finds no container. Barba
 * sends `x-barba: yes`; fetch/XHR carry a sec-fetch-mode other than navigate.
 * No headers at all (curl, old clients) counts as navigation.
 */
export function isNavigation(headers) {
  if (headers.get('x-barba') === 'yes') return false;
  const mode = headers.get('sec-fetch-mode');
  return mode === null || mode === 'navigate';
}

// Better Auth's default cookie prefix, secure-prefixed on https.
const SESSION_COOKIE_RE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

/**
 * The cheap pre-check. With no session cookie there is nothing to validate,
 * so Better Auth is never touched — the path every crawler and every email
 * client takes.
 */
export function hasSessionCookie(cookieHeader) {
  return typeof cookieHeader === 'string' && SESSION_COOKIE_RE.test(cookieHeader);
}

const EMAIL_MAX_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim + lowercase — the same normalisation `allowed_email` enforces with its
 * CHECK, so `Erlen@` and `erlen@` are one person on both sides of the lookup.
 * Returns null for anything that is not a plausible address, so the caller
 * can answer 400 without a database round trip.
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Send-endpoint limits (access-plan.md §4.8). Per IP alone is trivially
 * sidestepped; per address alone lets one IP walk the list. Both, always.
 */
export const SEND_LIMITS = {
  windowSeconds: 600,
  ip: 10, // one address hammering the endpoint
  email: 3, // one mailbox being flooded, from however many addresses
};

/**
 * Failed verifications per address, over a day. Better Auth caps attempts per
 * CODE (three), and a resend whose code is spent mints a fresh one, so the
 * guesses an address allows renewed with every send window: nine per ten
 * minutes, about 1,300 a day, for as long as anyone cared to keep going
 * (security audit 2026-11-09, finding 2). This caps them per ADDRESS: every
 * code Better Auth rejects is recorded under `fail:<address>` on the send
 * log, and once the day's count is over, the verify route answers the same
 * REJECTED_CODE as a wrong code without asking Better Auth, so no code for
 * that address can be guessed again until the window moves on. Ten a day
 * makes a hit about one in a hundred thousand per address per day. The
 * cap is judged before anything is recorded, and a guess counts only while a
 * code is live for the address, so a stranger cannot start or extend a block
 * by posting at an address: it takes codes the send caps meter and the
 * person is emailed, and ten wrong guesses at them. That is still a day's
 * lockout of sign-in (existing sessions stand) for anyone, the owner
 * included, which an admin lifts from the People page (worker/people.js
 * `unlock`). The code stays six digits (owner decision, 2026-11-09): the cap
 * is what bounds guessing, and a longer code would not stop a lockout.
 */
export const FAIL_LIMITS = {
  windowSeconds: 24 * 60 * 60,
  max: 10,
};

/** The send log's keys that live a day (FAIL_LIMITS), not a send window. */
export const FAIL_KEY_PREFIX = 'fail:';

/**
 * The two statements that sweep the send log: send and invite keys past the
 * send window, failure keys past the day. Every writer of the log runs both
 * first, so no sweep can take a key another limit still counts.
 */
export function sweepSendLog(db, now) {
  return [
    db.prepare('DELETE FROM otp_send_log WHERE at <= ?1 AND key NOT LIKE ?2').bind(now - SEND_LIMITS.windowSeconds, `${FAIL_KEY_PREFIX}%`),
    db.prepare('DELETE FROM otp_send_log WHERE at <= ?1 AND key LIKE ?2').bind(now - FAIL_LIMITS.windowSeconds, `${FAIL_KEY_PREFIX}%`),
  ];
}

/** Whether a day's failure count for an address is over the cap. `rows` is the per-key COUNT the caller selected. */
export function overFailLimit(rows, failKey, limits = FAIL_LIMITS) {
  for (const row of rows || []) {
    if (row.key === failKey) return Number(row.n) >= limits.max;
  }
  return false;
}

/**
 * Decide from the counts in the window, which INCLUDE the attempt being
 * judged — the caller records it in the same transaction as the count, so
 * the limit is "more than max", never "max or more". `rows` is what
 * `SELECT key, COUNT(*) AS n, MIN(at) AS oldest … GROUP BY key` returns for
 * the two keys. Membership-neutral: the caller evaluates this before it
 * looks at the allowlist result, and the IP limit wins when both are over.
 */
export function evaluateRateLimit(rows, ipKey, emailKey, now, limits = SEND_LIMITS) {
  let ip = null;
  let email = null;
  for (const row of rows || []) {
    if (row.key === ipKey) ip = row;
    else if (row.key === emailKey) email = row;
  }
  const over = (row, max) => row !== null && Number(row.n) > max;
  const hit = over(ip, limits.ip) ? ip : over(email, limits.email) ? email : null;
  if (hit === null) return { limited: false, retryAfter: 0 };
  // The window slides: the block lifts when the oldest counted attempt ages out.
  const retryAfter = Math.max(1, Number(hit.oldest) + limits.windowSeconds - now);
  return { limited: true, retryAfter };
}

/**
 * The Better Auth routes the site actually calls (assets/js/auth-login.js,
 * auth-account.js, header-account.js), as "METHOD /route" under /api/auth.
 * Everything else the library mounts — password reset, email change, the
 * plugin's check-verification route — answers 404 before Better Auth runs:
 * none is wired, and each is one more way to ask the database about an
 * address without passing the send preflight.
 */
export const SERVED_AUTH_ROUTES = new Set([
  'POST /email-otp/send-verification-otp',
  'POST /sign-in/email-otp',
  'GET /get-session',
  'POST /sign-out',
]);

export function isServedAuthRoute(method, route) {
  return SERVED_AUTH_ROUTES.has(`${method === 'HEAD' ? 'GET' : method} ${route}`);
}

/**
 * Better Auth falls back to a PUBLISHED default secret when none is set, and
 * only refuses in production — which it detects from NODE_ENV, unset on
 * Workers. With that default anyone can sign a session cookie the 5-minute
 * cookie cache admits without a D1 read. So the Worker checks for itself and
 * fails closed. 32 characters is Better Auth's own minimum warning length;
 * `openssl rand -base64 32` gives 44.
 */
export const AUTH_SECRET_MIN_LENGTH = 32;

export function hasUsableSecret(secret) {
  return typeof secret === 'string' && secret.length >= AUTH_SECRET_MIN_LENGTH;
}

/**
 * One answer for every rejected code. Better Auth says OTP_EXPIRED only when a
 * code record exists and TOO_MANY_ATTEMPTS only after one was guessed at, so
 * an address with no record — anyone not on the list — could be told apart
 * from a listed one by waiting out the expiry, or by guessing four times. The
 * body matches Better Auth's own INVALID_OTP. 5xx collapses too: a code stored
 * before a secret rotation, or hashed before 2026-10-08, cannot be decrypted
 * and throws — and only a listed address has a stored code. worker/auth.js
 * logs the real status. 429 (its per-IP limiter) passes through: it says
 * nothing about the address.
 */
export const REJECTED_CODE = Object.freeze({ code: 'INVALID_OTP', message: 'Invalid OTP' });

export function collapsesToRejectedCode(status) {
  return status >= 400 && status !== 429;
}

/**
 * Re-wrap a gated response so shared caches never store it, and carry any
 * refreshed session cookies Better Auth handed back. Public responses never
 * come through here — _headers keeps governing those.
 */
export function privateHeaders(response, setCookies = []) {
  const out = new Response(response.body, response);
  out.headers.set('Cache-Control', 'private, no-store');
  out.headers.append('Vary', 'Cookie');
  for (const cookie of setCookies) out.headers.append('Set-Cookie', cookie);
  return out;
}
