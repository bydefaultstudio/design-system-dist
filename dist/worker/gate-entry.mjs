/* @bydefaultstudio/design-system v7.5.0 */
/**
 * gate-entry.mjs - createGate(), the access gate as one factory
 * (levels-groups-plan.md Phase 3, D21). Shipped as
 * @bydefaultstudio/design-system/worker; a site's worker/index.js calls it
 * with its own page map, domains and routes, and exports what it returns:
 *
 *   import { createGate } from '@bydefaultstudio/design-system/worker';
 *   import { ACCESS_NAV, PAGE_ACCESS, SECTIONS, SOURCE_PAGES } from './page-access.mjs';
 *   export default createGate({ name, pages: PAGE_ACCESS, sections: SECTIONS,
 *     sources: SOURCE_PAGES, accessNav: ACCESS_NAV, hosts: ['example.com'],
 *     routes: { public: [...], gated: [...] } });
 *
 * The engine owns sign-in (/api/auth/*), the session, the page check, the
 * locked page, hidden navigation, the People API (/api/people/*) and the
 * Content-Security-Policy report endpoint (POST /api/csp-report, public; turn
 * it off with cspReport: false). The site owns everything else, as routes:
 *
 *   routes.public  [{ match(pathname), handle(request, env, ctx, url) }]
 *                  asked before the gate, open to everyone (a form endpoint,
 *                  an image generator). Never put a page here.
 *   routes.gated   [{ match(pathname), handle(request, env, ctx, url, { reader, setCookies }) }]
 *                  asked after the gate has admitted the reader; for paths on
 *                  no page map, which the gate treats as team pages.
 *   movedTo        (pathname) => newPathname | null, for pages that moved:
 *                  answered with a 301 after the session question only.
 *
 * Static assets reach here too: wrangler.jsonc sets run_worker_first, so
 * the session decides what reaches the asset layer (access-plan.md §4.2).
 */
import { AUTH_BASE_PATH, guestScopes, handleAuth } from './auth.js';
import { PEOPLE_BASE_PATH, handlePeople } from './people.js';
import { embeddableHeaders, hasSessionCookie, isConflictCopyPath, isEmbeddablePath, isPublicPath, privateHeaders, servesLanding } from './gate.mjs';
import { requireSession } from './session.js';
import { CSP_REPORT_PATH, handleCspReport } from './csp-report.js';
import { hideForReader, isHtml } from './hidden-nav.mjs';
import { SITE, configureSite } from './site.mjs';

function checkRoutes(list, kind) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`createGate: routes.${kind} must be an array`);
  for (const route of list) {
    if (!route || typeof route.match !== 'function' || typeof route.handle !== 'function') {
      throw new Error(`createGate: every routes.${kind} entry needs match() and handle()`);
    }
  }
  return list;
}

/**
 * The landing page, served at / to a visitor with no session (gate.mjs,
 * servesLanding). The URL stays /, so the response varies by cookie and must
 * never be cached where a signed-in reader could be handed it: privateHeaders
 * sets `private, no-store` and `Vary: Cookie`. Any Set-Cookie the refusal
 * carried (Better Auth clearing a dead session token) rides along, for the
 * reason denyRequest() in session.js gives. If the page is missing, the
 * refusal stands: the visitor goes to the login as before.
 */
async function landingResponse(request, env, url, denial) {
  let page;
  try {
    page = await env.ASSETS.fetch(new Request(new URL(SITE.landingPath, url.origin), { method: request.method }));
  } catch {
    return denial;
  }
  if (!page || page.status !== 200) {
    page?.body?.cancel();
    return denial;
  }
  denial.body?.cancel();
  // A signed-out visitor: under accessNav 'hidden' the page keeps public links only.
  const shown = SITE.accessNav === 'hidden' ? hideForReader(page, null, url.href) : page;
  return privateHeaders(shown, denial.headers.getSetCookie());
}

/**
 * accessNav 'hidden' (levels-groups-plan.md D19, §3.3): every page leaves
 * with the links and cards the reader cannot open cut out. A gated page
 * already has its reader; a public page reads the session only when a
 * cookie is present, so a signed-out visitor costs nothing and keeps the
 * public links. Every page varies by reader under 'hidden', so none is
 * cached: a cached signed-out copy would follow a reader who signs in.
 */
async function hiddenNav(request, env, url, response, gated, reader, sessionCookies) {
  // Only a page varies by reader. An asset keeps its own caching (a gated one
  // the private headers it always had), and costs no session or D1 read.
  if (!isHtml(response)) {
    if (gated) return privateHeaders(response, sessionCookies);
    return isEmbeddablePath(url.pathname) ? embeddableHeaders(response) : response;
  }
  let who = reader;
  let cookies = sessionCookies;
  if (!gated && !who && hasSessionCookie(request.headers.get('cookie'))) {
    const gate = await requireSession(request, env, url, null);
    if (!gate.deny) {
      who = gate.reader;
      cookies = gate.setCookies;
    } else {
      // A dead cookie: pass on Better Auth's clearing cookies, so the next
      // public page does not pay for the same session read again.
      cookies = gate.deny.headers.getSetCookie();
      gate.deny.body?.cancel();
    }
  }
  let scopes = who && Array.isArray(who.scopes) ? who.scopes : [];
  if (who && who.role === 'guest' && !Array.isArray(who.scopes)) {
    try {
      scopes = await guestScopes(env.DB, who.email);
    } catch {
      scopes = []; // fail closed: a guest with no scopes keeps public links and indexes only
    }
  }
  const cut = privateHeaders(hideForReader(response, who ? { role: who.role, scopes } : null, url.href), cookies);
  return isEmbeddablePath(url.pathname) ? embeddableHeaders(cut) : cut;
}

export function createGate(options = {}) {
  configureSite(options);
  const routes = options.routes || {};
  const publicRoutes = checkRoutes(routes.public, 'public');
  const gatedRoutes = checkRoutes(routes.gated, 'gated');
  const movedTo = typeof options.movedTo === 'function' ? options.movedTo : () => null;
  // On unless a site says no. It only ever writes a log line (csp-report.js),
  // so a site with no policy pointing at it loses nothing by having it.
  const cspReport = options.cspReport !== false;

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const { pathname } = url;

      // Sign-in endpoints first: they must never sit behind the gate they serve.
      if (pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
        return handleAuth(request, env, ctx);
      }

      // A sync-conflict duplicate's name ("people 3.html") is never a page the
      // build meant to ship: on the iCloud-mounted checkout it is a stale copy
      // of a real page, often an admin or owner one, that a local deploy can
      // upload. 404 before the asset layer can serve it, for everyone, so no
      // level is ever asked of a file the map cannot know (security audit
      // 2026-11-09, finding 4). authorise() refuses the same shape.
      if (isConflictCopyPath(pathname)) {
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
      }

      // The site's public routes: open to everyone, before the gate.
      for (const route of publicRoutes) {
        if (route.match(pathname)) return route.handle(request, env, ctx, url);
      }

      // Where browsers post Content-Security-Policy violations: public, so a
      // signed-out visitor on the login page reports too. After the site's
      // own public routes, so a site that handles the path itself keeps it.
      if (cspReport && pathname === CSP_REPORT_PATH) return handleCspReport(request);

      // ── Pages that moved (the site's movedTo) ──
      //
      // Asked before the page gate, with the session question only: the old
      // folder is in no reader's grants any more, so judging the old URL would
      // refuse a guest the page they can read at its new address. Signed out
      // still gets the login, so the map of old to new leaks nothing (§12.7).
      const moved = movedTo(pathname);
      if (moved) {
        const gate = await requireSession(request, env, url, null);
        if (gate.deny) return gate.deny;
        const target = new URL(url);
        target.pathname = moved;
        return privateHeaders(Response.redirect(target.toString(), 301), gate.setCookies);
      }

      // ── The gate (access-plan.md §4.2, §13.4; permissions-plan.md §4.3) ──
      //
      // Everything above stays public: the sign-in endpoints cannot sit behind the
      // gate they serve, and the site's public routes chose to be outside it.
      // Everything below is gated unless an infrastructure list (gate.mjs and
      // the site's publicPaths) exempts it or the page map says the page is
      // public - a new folder ships gated.
      //
      // A directory request is judged as the index.html it will serve: `/tools/`
      // is `/tools/index.html` to the gate, so the page map's entry for the index
      // decides, not a coincidence between the two spellings. (assets.html_handling
      // is "none", so this file is also what resolves those URLs - see below.)
      //
      // The verdict is reached BEFORE env.ASSETS is asked anything, so a missing
      // path and a real one deny identically and the gate leaks no filenames
      // (§12.7). privateHeaders wraps the gated branch ONLY: _headers still
      // declares Cache-Control: public, which is right for /assets/* and wrong
      // for a page behind a login (§12.2).
      const isDirectory = (request.method === 'GET' || request.method === 'HEAD') && pathname.endsWith('/');
      const resolved = isDirectory ? `${pathname}index.html` : pathname;
      const gated = !isPublicPath(resolved);
      let sessionCookies = [];
      let reader = null;
      if (gated) {
        const gate = await requireSession(request, env, url, resolved);
        if (gate.deny && servesLanding(resolved, request.method, gate.deny.status, request.headers.get('cookie'))) {
          return landingResponse(request, env, url, gate.deny);
        }
        if (gate.deny) return gate.deny;
        sessionCookies = gate.setCookies;
        reader = gate.reader;
      }

      // ── The People API (permissions-plan.md §5) ──
      //
      // Gated by omission like /files/: no page map entry, so the session check
      // has run and `reader` is in hand. The handler answers an admin and refuses
      // everyone else; it never falls through to the asset layer.
      if (pathname.startsWith(PEOPLE_BASE_PATH)) {
        return handlePeople(request, env, url, reader, sessionCookies);
      }

      // The site's gated routes: the reader is in hand, and each handler
      // answers for itself, never falling through to the asset layer.
      for (const route of gatedRoutes) {
        if (route.match(pathname)) return route.handle(request, env, ctx, url, { reader, setCookies: sessionCookies });
      }

      // Directory-index resolution.
      //
      // assets.html_handling is "none" so that /web/button.html is served at
      // exactly that URL rather than 307'd to /web/button - the site's pages
      // and every redirect target are explicit .html paths. The trade-off is
      // that "none" also switches off automatic index.html lookup, so `/` and
      // the directory-style links (/brand/, /tools/, …) would 404 without this.
      // Netlify resolved them, so this keeps behaviour identical.
      if (isDirectory) {
        const indexUrl = new URL(url);
        indexUrl.pathname = resolved;
        const indexResponse = await env.ASSETS.fetch(new Request(indexUrl, request));
        if (indexResponse.status !== 404) {
          if (SITE.accessNav === 'hidden') return hiddenNav(request, env, url, indexResponse, gated, reader, sessionCookies);
          return gated ? privateHeaders(indexResponse, sessionCookies) : indexResponse;
        }
        // Discard the 404 body explicitly. Every index-less directory URL takes
        // this path and then makes a second subrequest below; leaving the stream
        // unread holds it open for the life of the request.
        indexResponse.body?.cancel();
      }

      // Everything else: hand back to the asset layer, which applies _redirects
      // and returns the 404 for genuinely unknown paths.
      const assetResponse = await env.ASSETS.fetch(request);
      if (SITE.accessNav === 'hidden') return hiddenNav(request, env, url, assetResponse, gated, reader, sessionCookies);
      if (gated) return privateHeaders(assetResponse, sessionCookies);
      return isEmbeddablePath(pathname) ? embeddableHeaders(assetResponse) : assetResponse;
    },
  };
}
