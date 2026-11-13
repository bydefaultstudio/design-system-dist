/* @bydefaultstudio/design-system v8.2.0 */
/**
 * levels-build.mjs - asking for a build after a level change is applied (D27).
 *
 * Every applied change reaches readers only through a build, which bakes it
 * into page-access.mjs, the sidebar and the search index together. So Apply
 * asks Cloudflare Workers Builds to run one.
 *
 * It is optional. Without the secret and config an applied change waits for
 * the next deploy, and Settings says so instead of giving a time.
 *
 * Config: one secret, BUILDS_DEPLOY_HOOK, the Workers Builds deploy hook for
 * the production branch (Workers & Pages > the Worker > Settings > Builds >
 * Deploy hooks), as its full URL or its id. The hook needs no API token: its
 * id is the secret. `npx wrangler secret put BUILDS_DEPLOY_HOOK`
 *
 * Nothing here ever throws into the request: a failed trigger is logged and
 * the change stays applied and waiting; Settings offers Try again.
 */

// Two applies within this many seconds share one build: a build spends longer
// than this installing before it reads D1, so it still picks the second up.
// Anything later gets its own build. If a change still slips past a build
// that had already read D1, Settings notices once that build deploys (the
// change is newer than LEVELS_READ_AT and no build was asked for since) and
// asks again (levels-api.js), and the reader can press Try again.
export const SHARE_SECONDS = 20;
// The Try again button may ask at most this often, so a stuck page or a
// script in an admin's session cannot queue builds without limit.
export const RETRY_SECONDS = 60;

const HOOK_BASE = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/';
const HOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The deploy hook to call, or null when none is set or it is not one. Only a
 * Cloudflare deploy hook address is accepted, so a mistyped secret can never
 * send the Worker's request anywhere else.
 */
export function buildConfig(env) {
  const raw = env && typeof env.BUILDS_DEPLOY_HOOK === 'string' ? env.BUILDS_DEPLOY_HOOK.trim() : '';
  if (!raw) return null;
  const id = raw.startsWith(HOOK_BASE) ? raw.slice(HOOK_BASE.length).replace(/\/$/, '') : raw;
  if (!HOOK_ID.test(id)) {
    console.error(JSON.stringify({ event: 'levels.build.bad_hook' }));
    return null;
  }
  return { url: HOOK_BASE + id };
}

/** Whether a build can be asked for: the trigger is configured. */
export function buildConfigured(env) {
  return buildConfig(env) !== null;
}

/**
 * Ask for a build unless one was asked for within `gapSeconds`. `last` is the
 * last request time the caller already read (levels.js readBuildTimes).
 * Returns { configured, triggered, at }. The HTTP call runs in the background
 * through ctx.waitUntil, so a reader never waits on Cloudflare.
 */
export async function requestRebuild(env, ctx, { now = Math.floor(Date.now() / 1000), last = 0, gapSeconds = SHARE_SECONDS } = {}) {
  const config = buildConfig(env);
  if (!config) return { configured: false, triggered: false, at: last };
  if (now - last < gapSeconds) return { configured: true, triggered: false, at: last };
  // The conditional upsert is the claim: of two racing requests, only the one
  // that still sees the old time moves it, so one build is asked for.
  let claimed = false;
  try {
    const result = await env.DB.prepare(
      'INSERT INTO level_build (id, last_trigger_at) VALUES (1, ?1) '
      + 'ON CONFLICT(id) DO UPDATE SET last_trigger_at = ?1 WHERE level_build.last_trigger_at = ?2',
    ).bind(now, last).run();
    claimed = !!(result && result.meta && result.meta.changes > 0);
  } catch (error) {
    console.error(JSON.stringify({ event: 'levels.build.claim_failed', error: String(error && error.message) }));
    return { configured: true, triggered: false, at: last };
  }
  if (!claimed) return { configured: true, triggered: false, at: last };
  const fire = fireBuild(config);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(fire);
  else fire.catch(() => {});
  return { configured: true, triggered: true, at: now };
}

async function fireBuild(config) {
  try {
    // A deploy hook takes no body and no token: its id is the secret.
    const response = await fetch(config.url, { method: 'POST' });
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'levels.build.failed', status: response.status }));
    } else {
      console.info(JSON.stringify({ event: 'levels.build.triggered' }));
    }
    response.body?.cancel?.();
  } catch (error) {
    console.error(JSON.stringify({ event: 'levels.build.error', error: String(error && error.message) }));
  }
}
