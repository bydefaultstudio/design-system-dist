/* @bydefaultstudio/design-system v8.1.0 */
/**
 * auth.js — Better Auth in the Worker: the sign-in endpoints (access-plan.md §4).
 *
 * Mounted at /api/auth/* by worker/index.js. Email one-time code only (D5),
 * named individuals only (D5, §4.6): the `allowed_email` table in D1 is the
 * policy, and it is consulted HERE, before Better Auth sees the request. Since
 * permissions-plan.md (2026-10-07) the row also says what the person is -
 * admin, team or guest - and that role is copied onto the user record as it is
 * created, so it rides the session cookie from then on.
 *
 * Why not a Better Auth hook: the email-OTP plugin writes the code to
 * `verification` and hands it to the sender before it asks whether the user
 * exists (dist/plugins/email-otp/routes.mjs — createVerificationValue, then
 * the user check, then sendVerificationOTP). A hook fires too late to stop the
 * write, and a `before` hook cannot return a response at all. So the send
 * endpoint gets a preflight, and the preflight answers anyone not on the list
 * with the same body Better Auth sends on success: nothing written, nothing
 * sent, nothing learned (§4.4 step 3). Everything else on /api/auth/* goes
 * straight to Better Auth.
 *
 * Demo accounts (allowed_email.demo = 1) sign in with any code: the code the
 * plugin stores for them is a fixed one (generateOTP), no email is sent, and
 * the verify preflight replaces whatever was typed with that fixed code. For
 * walking the system in a call, one account per role. The send response says
 * `demo: true` for them so the login page can say no code is needed, the one
 * place the send endpoint is not neutral, by design: a demo address is meant
 * to be handed out, and knowing it is one tells nobody anything they could not
 * learn by typing six digits.
 *
 * Better Auth's tables come from worker/migrations/0002_better_auth.sql and
 * 0003_user_role.sql, generated from the installed package by
 * scripts/generate-auth-migration.mjs, never typed by hand.
 */
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SITE } from './site.mjs';
import {
  FAIL_KEY_PREFIX,
  FAIL_LIMITS,
  REJECTED_CODE,
  SEND_LIMITS,
  collapsesToRejectedCode,
  evaluateRateLimit,
  hasSessionCookie,
  hasUsableSecret,
  isAllowedHost,
  isOwnerEmail,
  isServedAuthRoute,
  normalizeEmail,
  overFailLimit,
  resolveRole,
  sweepSendLog,
} from './gate.mjs';
import { USER_ADDITIONAL_FIELDS } from './auth-schema.mjs';
import { otpSubject, renderOtpEmail, renderOtpText } from './email-template.mjs';

export const AUTH_BASE_PATH = '/api/auth';
const SEND_ROUTE = '/email-otp/send-verification-otp';
const SEND_PATH = `${AUTH_BASE_PATH}${SEND_ROUTE}`;
const VERIFY_PATH = `${AUTH_BASE_PATH}/sign-in/email-otp`;
const SESSION_PATH = `${AUTH_BASE_PATH}/get-session`;
const SIGN_OUT_PATH = `${AUTH_BASE_PATH}/sign-out`;
const SEND_BODY_MAX_BYTES = 1024; // an email and a type; anything larger is not a client
const VERIFY_BODY_MAX_BYTES = 1024; // an email and a code

const OTP_LENGTH = 6;
const OTP_EXPIRES_SECONDS = 5 * 60;
const OTP_ALLOWED_ATTEMPTS = 3;
const SESSION_EXPIRES_SECONDS = 30 * 24 * 60 * 60; // §4.7: thirty days, rolling
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60; // …extended at most once a day
const COOKIE_CACHE_SECONDS = 5 * 60; // §10: no D1 read on a warm session
// Bumped when the cached user shape changes, so every cached session is rebuilt
// from D1 on its next request rather than trusted without the new field. '2'
// added user.role (2026-10-07).
const COOKIE_CACHE_VERSION = '2';

// The code a demo account's verification row holds. Never shown to anyone:
// the verify preflight substitutes it for whatever a demo visitor typed.
const DEMO_CODE = '000000';

// Carries the request's ExecutionContext to Better Auth's background-task
// handler, so the email send outlives the response via ctx.waitUntil without
// the instance — memoised per isolate — holding any per-request state. This is
// Better Auth's own documented Workers pattern (init-options: backgroundTasks).
// Backgrounding is not an optimisation here: if the send were awaited, a
// listed address would answer hundreds of milliseconds after an unlisted one,
// and the response time would say what the body refuses to.
//
// The same store carries the preflight's verdict on whether the address is a
// demo account, so generateOTP and the sender learn it without a second read.
const execContext = new AsyncLocalStorage();

// One Better Auth instance per isolate per origin — baseURL is baked in, so
// localhost and the custom domain each get their own. Keyed on the
// origin alone: bindings are isolate-wide, so the `env` captured by the first
// request serves every later one, and nothing depends on `env` keeping its
// identity between requests. Bounded by the hosts that route here.
const instances = new Map();

export function getAuth(env, origin) {
  // Thrown, not returned: requireSession turns any throw into a denial, and
  // handleAuth checks first so it can answer 503 instead.
  if (!hasUsableSecret(env.BETTER_AUTH_SECRET)) throw new Error('BETTER_AUTH_SECRET is missing or too short');
  let auth = instances.get(origin);
  if (!auth) {
    auth = createAuth(env, origin);
    instances.set(origin, auth);
  }
  return auth;
}

function createAuth(env, origin) {
  return betterAuth({
    appName: SITE.name,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // D1. @better-auth/kysely-adapter recognises it by shape (batch/exec/prepare)
    // and picks its D1 dialect, transactions off — D1 has none.
    database: env.DB,
    trustedOrigins: [origin],
    user: { additionalFields: USER_ADDITIONAL_FIELDS },
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: true, maxAge: COOKIE_CACHE_SECONDS, strategy: 'compact', version: COOKIE_CACHE_VERSION },
    },
    // Better Auth's own per-IP limiter guards the verify and session routes,
    // persisted so it survives isolate restarts (NODE_ENV is unset on Workers,
    // so `enabled` is explicit). It is switched OFF for the send route: only
    // listed addresses ever reach it there, so its 429 would say who is on the
    // list — preflightSend limits that route for everyone instead.
    rateLimit: { enabled: true, storage: 'database', customRules: { [SEND_ROUTE]: false } },
    advanced: {
      useSecureCookies: origin.startsWith('https://'),
      // Better Auth reads x-forwarded-for by default; Cloudflare's truth is here.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      backgroundTasks: { handler: runInBackground },
    },
    databaseHooks: {
      user: {
        create: {
          // Second line behind the preflight — an address removed from the list
          // between its code being sent and being entered. Throwing gives a
          // clean 403; returning false would make the sign-in route read
          // `.id` off a null user and 500. The row that admits the person also
          // says what they are: the role is copied onto the user here, the
          // one time anything but the People page writes it (§4.2).
          before: async (user) => {
            const row = await allowedRow(env.DB, user.email);
            if (!row || isExpired(row)) {
              throw new APIError('FORBIDDEN', { message: 'This address is not on the list.' });
            }
            return { data: { role: row.role } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        // A resend sends the code already live rather than replacing it, so a
        // stranger requesting codes for someone's address cannot invalidate
        // the one in their inbox (owner decision 2026-10-08). Reuse needs the
        // code recoverable, hence encrypted with the auth secret, not hashed.
        // The attempt count carries over, so a resend buys no extra guesses;
        // a code whose attempts are spent is replaced as before.
        resendStrategy: 'reuse',
        storeOTP: 'encrypted',
        // A demo account's code is the fixed one; undefined hands the plugin
        // back its own random generator for everyone else.
        generateOTP: () => (execContext.getStore()?.demo ? DEMO_CODE : undefined),
        sendVerificationOTP: (data) => sendCode(env, origin, data),
      }),
    ],
  });
}

function runInBackground(promise) {
  const store = execContext.getStore();
  if (store && store.ctx) store.ctx.waitUntil(promise);
  else promise.catch(() => {}); // outside a request there is nothing to extend
}

/**
 * The router. Refuses hostnames that are not ours before anything is built —
 * baseURL is derived from the request, so an unexpected Host must not become
 * a trusted origin — and any route the site does not call (gate.mjs
 * SERVED_AUTH_ROUTES).
 */
export async function handleAuth(request, env, ctx) {
  const url = new URL(request.url);
  if (!isAllowedHost(url.hostname)) return new Response('Not found', { status: 404 });
  if (!isServedAuthRoute(request.method, url.pathname.slice(AUTH_BASE_PATH.length))) {
    return new Response('Not found', { status: 404 });
  }
  if (!hasUsableSecret(env.BETTER_AUTH_SECRET)) {
    console.error(JSON.stringify({ event: 'auth.secret_missing' }));
    return json({ error: 'Sign-in is unavailable' }, 503);
  }

  // No session cookie, nothing to look up: the answer Better Auth would give
  // after a D1 read and a rate-limit row, given here for free. Every page's
  // header asks this on load, signed in or not, so without the pre-check
  // every anonymous visit wrote a row (security audit 2026-11-09, needs-
  // validation 10). The page gate makes the same check first (session.js).
  // Sign-out with no cookie has nothing to end: the library's 400 becomes
  // the success the page expects, with no Clear-Site-Data, since nothing
  // gated was fetched under this cookie-less visit.
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === SESSION_PATH) return json(null, 200);
    if (request.method === 'POST' && url.pathname === SIGN_OUT_PATH) return json({ success: true }, 200);
  }

  let forwarded = request;
  let demo = false;
  let email = null;
  if (request.method === 'POST' && url.pathname === SEND_PATH) {
    const outcome = await preflightSend(request, env);
    if (outcome instanceof Response) return outcome;
    forwarded = outcome.request;
    demo = outcome.demo;
  } else if (request.method === 'POST' && url.pathname === VERIFY_PATH) {
    const outcome = await preflightVerify(request, env);
    if (outcome instanceof Response) return outcome;
    forwarded = outcome.request;
    demo = outcome.demo;
    email = outcome.email;
  }

  const auth = getAuth(env, url.origin);

  // The send route answers before Better Auth runs. Only a listed address
  // reaches this line, and the library's work for it (the user lookup, the
  // code's write, the old code's delete) cost two or three D1 round trips an
  // unlisted address never paid, so the response time said who was on the
  // list (security audit 2026-11-09, residue of finding 1). The whole send
  // now runs in the background and the answer is the preflight's, the same
  // body and headers as an unlisted address gets. Anything the library
  // refuses (its origin check on a foreign Origin, a Cookie with no Origin, a
  // Sec-Fetch header) is logged, never shown: a cross-site send costs nothing
  // to absorb, it emails the listed person their own code under the
  // preflight's caps. The demo answer stays the one deliberate difference
  // (see the file comment); it comes from the preflight's read of the row.
  if (url.pathname === SEND_PATH) {
    const sending = execContext.run({ ctx, demo }, () => auth.handler(forwarded)).then(
      async (response) => {
        if (!response.ok) {
          const reason = await response.clone().json().then((b) => b && (b.code || b.message), () => null);
          console.warn(JSON.stringify({ event: 'auth.send_refused', status: response.status, reason }));
        }
        response.body?.cancel();
      },
      (error) => console.error(JSON.stringify({ event: 'auth.send_failed', error: String(error && error.message) })),
    );
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sending);
    return json(demo ? { success: true, demo: true } : { success: true }, 200);
  }

  const response = await execContext.run({ ctx, demo }, () => auth.handler(forwarded));

  // Wrong, expired, locked and refused codes all read the same (gate.mjs
  // REJECTED_CODE), or the difference says who is on the list.
  if (url.pathname === VERIFY_PATH && collapsesToRejectedCode(response.status)) {
    // Logged, because a 403 from Better Auth's own origin check and a 500
    // from an undecryptable code collapse too, and would otherwise read as
    // people mistyping their codes.
    const reason = await response.clone().json().then((b) => b && (b.code || b.message), () => null);
    console.warn(JSON.stringify({ event: 'auth.code_rejected', status: response.status, reason }));
    response.body?.cancel();
    // Counted against the address, so the day's cap (gate.mjs FAIL_LIMITS)
    // holds, but only while a code is live for it: a guess at an address
    // that was never sent a code could never have succeeded, and counting
    // it would let ten cookieless posts lock anyone out for a day with no
    // send at all (code review, 2026-11-09). The same statement runs for
    // every address, listed or not, and the response is already decided, so
    // the write says nothing about the list. A failed write is logged and
    // the answer stands: the cap is defence in depth, not the verdict.
    try {
      await env.DB.prepare('INSERT INTO otp_send_log (key, at) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM verification WHERE identifier = ?3)')
        .bind(`${FAIL_KEY_PREFIX}${email}`, Math.floor(Date.now() / 1000), `sign-in-otp-${email}`)
        .run();
    } catch (error) {
      console.error(JSON.stringify({ event: 'auth.fail_count_failed', error: String(error && error.message) }));
    }
    return json(REJECTED_CODE, 400);
  }

  // Signing out also empties what the browser cached behind the gate. The
  // Asset Library serves its thumbnails `private, max-age=31536000, immutable`
  // (asset-library-plan.md §3) — the one exception to the gate's no-store —
  // so on a shared machine the next person must not find them in the cache.
  // Clear-Site-Data takes the public /assets/ cache with it; accepted.
  if (url.pathname === SIGN_OUT_PATH && response.ok) {
    const cleared = new Response(response.body, response);
    cleared.headers.set('Clear-Site-Data', '"cache"');
    return cleared;
  }

  // A successful sign-in answers with the user and without the session
  // token: the cookie carries it, and a token in a body any script can read
  // is a session any script can steal (security audit, 2026-11-08, finding 4).
  if (url.pathname === VERIFY_PATH && response.ok) {
    return withoutToken(response, env);
  }

  // The page's one session call (header-account.js) learns the role the
  // gate will act on - resolved the way worker/gate.mjs resolves it, owner
  // floor included, so the page never hides admin links from the owner -
  // and, for a guest, the sections and pages their groups grant, so the
  // sidebar can lock what they cannot open. One D1 read, guests only.
  if (request.method === 'GET' && url.pathname === SESSION_PATH && response.ok) {
    return withReaderAccess(response, env);
  }
  return response;
}

/**
 * GET /auth/sign-out (engine-paths.mjs `signOut`): the sign-out link, for a
 * page that wants a plain link rather than the header's account menu, and for
 * a browser with no JavaScript (engine-parity-phase-d.md, PD-3).
 *
 * A link anyone can point at must not sign a reader out from somewhere else:
 * an image tag on another site, a page on a sibling subdomain. So it signs
 * out a navigation the reader made themselves, read from headers no page can
 * set: Sec-Fetch-Mode navigate, with Sec-Fetch-Site same-origin (a click on
 * this site) or none (typed, bookmarked, opened from another app). A browser
 * that sends no Sec-Fetch headers at all (Safari before 16.4) is trusted on a
 * Referer from this origin, which another site cannot send either.
 *
 * Anything else from a signed-in reader is refused out loud, with a page that
 * says they are still signed in and how to sign out, never a redirect that
 * reads as though it worked. A visitor with no session cookie, and a HEAD,
 * are sent to the login page with nothing changed. The sign-out itself is the
 * account menu's, Better Auth's POST /sign-out made here on the reader's
 * behalf through handleAuth, so its cookies are cleared and the cache emptied
 * (Clear-Site-Data) exactly as the menu's are. If that fails the reader is
 * told so, never sent on as if signed out: on a shared machine the difference
 * matters.
 */
export async function handleSignOutLink(request, env, ctx) {
  const url = new URL(request.url);
  if (!isAllowedHost(url.hostname)) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  const toLogin = (signedOut = null) => {
    const headers = new Headers({ Location: new URL(SITE.loginPath, url.origin).toString(), 'Cache-Control': 'private, no-store' });
    if (signedOut) {
      for (const cookie of signedOut.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
      const cleared = signedOut.headers.get('Clear-Site-Data');
      if (cleared) headers.set('Clear-Site-Data', cleared);
    }
    return new Response(null, { status: 303, headers });
  };
  const cookie = request.headers.get('cookie');
  if (request.method !== 'GET' || !hasSessionCookie(cookie)) return toLogin();
  if (!readersOwnNavigation(request, url)) {
    // A session cookie is not a live session (it may have expired), so the
    // page says what it knows: nothing changed
    return signOutPage(url, 403, 'Nothing was signed out', [
      'This sign-out link was opened from somewhere other than this site, so it changed nothing. If you were signed in, you still are.',
      'To sign out, use the account menu at the top of any page, or select Sign out below.',
    ], 'Sign out');
  }

  const signOut = new Request(new URL(SIGN_OUT_PATH, url.origin), {
    method: 'POST',
    headers: { cookie, origin: url.origin, 'content-type': 'application/json' },
    body: '{}',
  });
  let response;
  try {
    response = await handleAuth(signOut, env, ctx);
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.sign_out_link_failed', error: String(error && error.message) }));
    response = null;
  }
  if (!response || !response.ok) {
    if (response) {
      console.error(JSON.stringify({ event: 'auth.sign_out_link_refused', status: response.status }));
      response.body?.cancel();
    }
    return signOutPage(url, 503, 'Sign-out didn’t complete', [
      'You are still signed in. Nothing on this device was changed.',
      'Wait a moment, then select Try signing out again below.',
    ], 'Try signing out again', { 'Retry-After': '30' });
  }
  response.body?.cancel();
  return toLogin(response);
}

/**
 * Whether a sign-out request is a navigation the reader made: a click on this
 * site or a typed address, never a page elsewhere loading the link.
 */
function readersOwnNavigation(request, url) {
  const mode = request.headers.get('sec-fetch-mode');
  const site = request.headers.get('sec-fetch-site');
  if (mode !== null || site !== null) return mode === 'navigate' && (site === 'same-origin' || site === 'none');
  // No Fetch Metadata at all: an older browser. Its Referer names the page
  // the link was on, and only this site's own pages can name this origin
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false;
  }
}

/** Text for an HTML page, never markup. */
function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The page the sign-out link answers with when it signs nobody out: plain
 * HTML in the site's language, the reason, and a way forward (`action`, the
 * link that signs out from this page, and the home page). The retry relies
 * on the browser sending this site's own Referer when it sends no Fetch
 * Metadata, so this response never sets a no-referrer policy. Unstyled on purpose: it must work when the site's own
 * files are what failed, and it loads nothing.
 */
function signOutPage(url, status, heading, lines, action, extraHeaders = {}) {
  const home = new URL('/', url.origin).toString();
  const again = new URL(url.pathname, url.origin).toString();
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeText(heading)} - ${escapeText(SITE.name)}</title>
</head>
<body>
<main>
<h1>${escapeText(heading)}</h1>
${lines.map((line) => `<p>${escapeText(line)}</p>`).join('\n')}
<p><a href="${escapeText(again)}">${escapeText(action)}</a></p>
<p><a href="${escapeText(home)}">Back to ${escapeText(SITE.name)}</a></p>
</main>
</body>
</html>
`;
  return new Response(body, {
    status,
    // Never framed: a framed copy's own Sign out link would read as a click
    // on this site. The Worker writes this page, so _headers doesn't reach it
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      ...extraHeaders,
    },
  });
}

/**
 * Runs before Better Auth on the send endpoint. Returns a Response to short-
 * circuit, or { request, demo } to hand on, the request rebuilt with the
 * normalised address, so Better Auth validates the same string the allowlist
 * was asked about. (It trims nothing itself: a leading space would be our 200
 * for an unlisted address and its 400 for a listed one, a one-request
 * membership test.)
 *
 * Neutrality by construction: ONE D1 batch — sweep, record the attempt, count
 * the window, look up the list — the same five statements in the same order
 * whatever the outcome, and only then a verdict. The count includes the row
 * just written, so the limit is `count > max`, and two concurrent requests
 * cannot both slip under it: a batch is one transaction.
 */
async function preflightSend(request, env) {
  const body = await readJsonBody(request, SEND_BODY_MAX_BYTES);
  if (!body || body.type !== 'sign-in') return json({ error: 'Bad request' }, 400);
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: 'Bad request' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipKey = `ip:${ip}`;
  const emailKey = `email:${email}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - SEND_LIMITS.windowSeconds;

  const [, , , counts, allowed] = await env.DB.batch([
    ...sweepSendLog(env.DB, now),
    env.DB.prepare('INSERT INTO otp_send_log (key, at) VALUES (?1, ?3), (?2, ?3)').bind(ipKey, emailKey, now),
    env.DB.prepare(
      'SELECT key, COUNT(*) AS n, MIN(at) AS oldest FROM otp_send_log WHERE key IN (?1, ?2) AND at > ?3 GROUP BY key',
    ).bind(ipKey, emailKey, windowStart),
    env.DB.prepare('SELECT demo, role, expires_at FROM allowed_email WHERE email = ?1').bind(email),
  ]);
  const verdict = evaluateRateLimit(counts.results, ipKey, emailKey, now);

  if (verdict.limited) {
    return json({ error: 'Too many requests' }, 429, { 'Retry-After': String(verdict.retryAfter) });
  }
  // Not on the list, or no longer admitted: the exact body Better Auth
  // returns after a real send.
  const row = allowed.results[0];
  if (!row || isExpired(row, now)) return json({ success: true }, 200);

  return { request: rebuildJson(request, { ...body, email }), demo: isDemoRow(row, email, env.ACCESS_OWNER) };
}

/**
 * Runs before Better Auth on the verify endpoint, for two reasons. A demo
 * account signs in with any code, so the code typed is replaced with the one
 * the plugin stored for that address. And the list is the policy: a person
 * signing in again gets the role their row says NOW, written onto the user
 * record before the session is built, so the cookie cache never starts a
 * sign-in with a role the list no longer holds (the create hook does the
 * same for a first sign-in). Everyone else's request is handed on with the
 * address normalised and nothing else changed - a wrong code is still
 * wrong, and Better Auth still counts the attempts. A missing or expired row
 * needs no refusal here: the send preflight never wrote a code for it.
 *
 * Third: the day's failed verifications for the address (gate.mjs
 * FAIL_LIMITS). Over the cap, the request never reaches Better Auth and is
 * answered as a wrong code, so the codes an address can be sent no longer
 * renew the guesses it allows.
 */
async function preflightVerify(request, env) {
  const body = await readJsonBody(request, VERIFY_BODY_MAX_BYTES);
  if (!body) return json({ error: 'Bad request' }, 400);
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: 'Bad request' }, 400);
  const failKey = `${FAIL_KEY_PREFIX}${email}`;
  const now = Math.floor(Date.now() / 1000);
  // One batch, the same three statements for every address: a separate UPDATE
  // run only for a listed one was an extra round trip, and the response time
  // said what the body refuses to. The UPDATE reads the role itself and
  // matches nothing for an unlisted address (EXISTS), so it is a no-op there.
  const [, lookup, failures] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE user SET role = (SELECT role FROM allowed_email WHERE email = ?1)
       WHERE email = ?1
         AND EXISTS (SELECT 1 FROM allowed_email WHERE email = ?1)
         AND role IS NOT (SELECT role FROM allowed_email WHERE email = ?1)`,
    ).bind(email),
    env.DB.prepare('SELECT demo, role FROM allowed_email WHERE email = ?1').bind(email),
    env.DB.prepare('SELECT key, COUNT(*) AS n FROM otp_send_log WHERE key = ?1 AND at > ?2 GROUP BY key').bind(failKey, now - FAIL_LIMITS.windowSeconds),
  ]);
  if (overFailLimit(failures.results, failKey)) {
    console.warn(JSON.stringify({ event: 'auth.verify_capped', email }));
    return json(REJECTED_CODE, 400);
  }
  const row = lookup.results[0] || null;
  // Never a demo for a role that manages people or opens owner pages: a
  // demo address is a password anyone holds (security audit, 2026-11-08,
  // finding 1). The People API refuses such a row; this refuses one that
  // was made before it did, or by hand.
  const demo = isDemoRow(row, email, env.ACCESS_OWNER);
  const otp = demo ? DEMO_CODE : body.otp;
  return { request: rebuildJson(request, { ...body, email, otp }), demo, email };
}

/**
 * Whether a list row signs in as a demo, with no code. Only a team member or
 * a guest: a demo address is a password anyone holds, so a row that manages
 * people or opens owner pages signs in with a real code whatever its demo
 * flag says (security audit, 2026-11-08, finding 1). The send and the verify
 * preflights both ask this, so the code sent and the code checked agree.
 */
function isDemoRow(row, email, ownerEmail) {
  // The ACCESS_OWNER address is an owner whatever its row says, so a demo
  // flag on it would be a codeless sign-in as the owner (code review,
  // 2026-11-08). Never, however the row was made.
  if (isOwnerEmail(email, ownerEmail)) return false;
  return !!row && row.demo === 1 && (row.role === 'team' || row.role === 'guest');
}

async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) return null;
  let body;
  try {
    const text = await request.clone().text();
    if (text.length > maxBytes) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function rebuildJson(request, body) {
  const headers = new Headers(request.headers);
  headers.delete('content-length'); // recomputed for the rebuilt body
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}

/** The same response with a different JSON body: status and headers (cookies included) kept. */
function withJsonBody(response, body) {
  const out = new Response(JSON.stringify(body), response);
  out.headers.set('Content-Type', 'application/json');
  out.headers.delete('Content-Length');
  return out;
}

async function withoutToken(response, env) {
  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }
  if (!data || typeof data !== 'object') return response;
  const { token, ...rest } = data;
  // The role the gate will act on, owner floor included, so the login page's
  // pre-paint hint is right from the first page (it was the stored role).
  if (rest.user && typeof rest.user === 'object') rest.user = { ...rest.user, role: resolveRole(rest.user, env.ACCESS_OWNER) };
  return withJsonBody(response, rest);
}

async function withReaderAccess(response, env) {
  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }
  if (!data || typeof data !== 'object' || !data.user || !data.session) return response;
  // The session token is the cookie's secret. No page reads it, and in the
  // body any script on the page could, HttpOnly or not (security audit,
  // 2026-11-08, finding 4). Only the expiry leaves.
  const session = { expiresAt: data.session.expiresAt };
  const role = resolveRole(data.user, env.ACCESS_OWNER);
  if (role !== 'guest') return withJsonBody(response, { ...data, session, role });
  let scopes = [];
  try {
    scopes = await guestScopes(env.DB, data.user.email);
  } catch {
    scopes = []; // fail closed: a guest with no scopes sees every team page locked
  }
  return withJsonBody(response, { ...data, session, role, scopes });
}

/* ------ The list ------ */

/**
 * The allowlist row for an address, normalised the way the table stores it,
 * or null. The row is the policy: it admits the person (its existence), says
 * what they are (role), how long for (expires_at) and whether they are a demo
 * account. Read by the sign-in preflights, the user-create hook, the gate's
 * cookie-rebuild check and the People API.
 */
export async function allowedRow(db, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  return db
    .prepare('SELECT email, role, expires_at, invited_by, demo, note, added_at FROM allowed_email WHERE email = ?1')
    .bind(email)
    .first();
}

export function isExpired(row, now = Math.floor(Date.now() / 1000)) {
  return row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= now;
}

/** The scopes a guest's groups grant, as 'section:<folder>' and 'page:<path>' strings. */
export async function guestScopes(db, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return [];
  const { results } = await db
    .prepare(
      'SELECT DISTINCT g.scope FROM access_group_member m JOIN access_group_grant g ON g.group_id = m.group_id WHERE m.email = ?1',
    )
    .bind(email)
    .all();
  return results.map((row) => row.scope);
}

/** End every session a user holds, the second statement of access-plan.md §15, as code. */
export async function revokeSessions(db, userId) {
  await db.prepare('DELETE FROM session WHERE userId = ?1').bind(userId).run();
}

/** Write a role onto the list row itself: the ACCESS_OWNER floor made visible (worker/session.js). */
export async function setListedRole(db, email, role) {
  await db.prepare('UPDATE allowed_email SET role = ?1 WHERE email = ?2').bind(role, email).run();
}

/** Write the list's role onto the user record, so the next cookie rebuild carries it. */
export async function setUserRole(db, userId, role) {
  await db.prepare('UPDATE user SET role = ?1 WHERE id = ?2').bind(role, userId).run();
}

/**
 * Better Auth's sender hook. Runs in the background (see execContext), so it
 * must never throw — a failure is logged, structured, and the response has
 * already gone. The failure mode to know: an un-onboarded sender domain makes
 * send() reject, and the visitor simply never receives a code (§3.1).
 */
async function sendCode(env, origin, { email, otp, type }) {
  if (type !== 'sign-in') return; // the plugin's other flows are not wired
  // A demo account gets no email: its code is the fixed one and any code is
  // accepted, so there is nothing to deliver and often no mailbox to deliver to.
  if (execContext.getStore()?.demo) return;
  // Braces to the preflight's belt: a request that reached the plugin by a
  // path the preflight did not match (a trailing slash, should Better Auth's
  // router ever accept one) still sends nothing to an address not on the list.
  const row = await allowedRow(env.DB, email);
  if (!row || isExpired(row)) return;
  const message = {
    from: parseAddress(env.AUTH_EMAIL_FROM),
    to: email,
    subject: otpSubject(otp),
    html: renderOtpEmail({ otp, expiresInMinutes: OTP_EXPIRES_SECONDS / 60, origin }),
    text: renderOtpText({ otp, expiresInMinutes: OTP_EXPIRES_SECONDS / 60, origin }),
  };
  try {
    await env.EMAIL.send(message);
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.email.send_failed', to: email, error: String(error && error.message) }));
  }
}

/** "By Default OS <admin@bydefault.studio>" → { name, email }. */
export function parseAddress(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(value || ''));
  if (match) return { name: match[1], email: match[2] };
  return { name: '', email: String(value || '').trim() };
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}
