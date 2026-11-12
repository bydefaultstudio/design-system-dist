/* @bydefaultstudio/design-system v8.1.0 */
/**
 * fleet-report.mjs - the site's half of the fleet dashboard (engine parity
 * phase F, F1; decisions PF-1 to PF-3). Engine code: ships with createGate().
 *
 * A site that passes `report: { to: 'https://…/api/fleet/report' }` to
 * createGate() tells the fleet service what it runs, once per deployment:
 * its own /os.json as the build wrote it, with the deployment's id and time
 * from the version metadata binding (CF_VERSION_METADATA), signed with the
 * site's key (the SITE_KEY secret, the same one forms use). The service never
 * fetches anything from a site, and /os.json stays behind the gate.
 *
 *   - When: on the first request a new deployment serves on one of the
 *     site's own domains (never localhost, never a preview address), sent in
 *     ctx.waitUntil, so no reader waits. Each isolate sends once; the service
 *     keeps one row per deployment, so several are harmless.
 *   - Off, with one log line saying why, when the binding or the key is
 *     missing.
 *   - A refusal (a wrong key, a report the service won't take) is logged and
 *     not sent again until the next deployment. An outage, or a service
 *     busy with this site's reports (429), is tried again after
 *     RETRY_SECONDS. A send that never settles (a cancelled waitUntil) is
 *     given up after STUCK_SECONDS, so the isolate can try again.
 *
 * The service itself passes `report: { deliver }` instead: a function given
 * the same report and env, answering { status }, so its own row goes through
 * the same checks without a request to itself.
 *
 * Logs carry the deployment id and the service's answer, never the key.
 */
import { isAllowedHost } from './gate.mjs';

/** The version metadata binding's name in wrangler.jsonc. */
export const VERSION_BINDING = 'CF_VERSION_METADATA';
/** How long an isolate waits before trying again after the service was down. */
export const RETRY_SECONDS = 15 * 60;
const SEND_TIMEOUT_MS = 10000;
/** A send still unsettled after this long was cancelled with its waitUntil. */
export const STUCK_SECONDS = 60;
// os.json is a few KB; anything far larger is not the file the build wrote
const MAX_OS_BYTES = 32 * 1024;

/**
 * The `report` option, checked: { to } with a plain https URL, { deliver }
 * with a function, or null when the site has none. A malformed one stops
 * createGate(), so a typo never ships a report that goes nowhere.
 */
export function reportOption(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('createGate: `report` must be an object: { to: \'https://…/api/fleet/report\' }');
  if (value.deliver !== undefined) {
    if (typeof value.deliver !== 'function' || value.to !== undefined) throw new Error('createGate: `report.deliver` must be a function, and comes without `report.to`');
    return Object.freeze({ deliver: value.deliver });
  }
  let to;
  try {
    to = new URL(value.to);
  } catch {
    throw new Error('createGate: `report.to` must be the fleet service\'s full https address');
  }
  if (to.protocol !== 'https:' || to.username || to.password || to.search || to.hash) {
    throw new Error('createGate: `report.to` must be a plain https address, with no credentials, query or fragment');
  }
  return Object.freeze({ to: to.href });
}

/** One of the site's own domains: never localhost, a preview address or an unknown Host. */
function isSiteHost(hostname) {
  const name = String(hostname || '').toLowerCase();
  if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') return false;
  return isAllowedHost(name);
}

/**
 * What an answer means for this deployment's report: 'done' (taken, or
 * already heard), 'refused' (it won't be taken: not sent again) or 'later'
 * (the service is down, or busy with this site's reports: a new deployment
 * shipped a minute after the last must still be heard).
 */
function outcomeOf(status) {
  if (status >= 200 && status < 300) return 'done';
  if (status === 429 || status >= 500 || status === 0) return 'later';
  return 'refused';
}

/** The service's own words for a refusal, short and plain, for the log. */
async function refusalText(res) {
  try {
    const payload = await res.json();
    return payload && typeof payload.error === 'string' ? payload.error.slice(0, 200) : '';
  } catch {
    return '';
  }
}

/** This deployment's /os.json from the asset layer, or { problem }. */
async function readOsJson(env, origin) {
  let res;
  try {
    res = await env.ASSETS.fetch(new Request(new URL('/os.json', origin), { method: 'GET' }));
  } catch {
    return { problem: 'fleet report: /os.json could not be read from the assets, so there is nothing to send.' };
  }
  if (!res || res.status !== 200) {
    res?.body?.cancel();
    return { problem: 'fleet report: this deployment has no /os.json, so there is nothing to send. A full build writes it.' };
  }
  const text = await res.text();
  if (text.length > MAX_OS_BYTES) return { problem: 'fleet report: /os.json is far larger than the build writes, so it was not sent.' };
  let os;
  try {
    os = JSON.parse(text);
  } catch {
    return { problem: 'fleet report: /os.json is not JSON, so it was not sent.' };
  }
  if (!os || typeof os !== 'object' || !os.site || typeof os.site.slug !== 'string' || !os.site.slug) {
    return { problem: 'fleet report: /os.json names no site slug, so the fleet service could not tell whose it is. Set "slug" in brand.json.' };
  }
  return { os };
}

/**
 * The gate's reporter for a checked `report` option, or null without one:
 * a function the gate calls at the start of every request, which costs a
 * few comparisons once this deployment has reported.
 */
export function createReporter(report, fetchImpl = fetch) {
  if (!report) return null;
  // Per isolate: the deployment this isolate serves, and how its report went.
  // `seq` numbers each send, so only the newest one's outcome is kept: a
  // send given up as stuck may still settle after its replacement.
  const state = { status: 'idle', retryAt: 0, sentAt: 0, seq: 0 };

  async function send(env, origin, meta) {
    const read = await readOsJson(env, origin);
    if (read.problem) {
      console.error(read.problem);
      return 'refused';
    }
    const body = { os: read.os, deployment: { id: meta.id, at: typeof meta.timestamp === 'string' ? meta.timestamp : null } };

    if (report.deliver) {
      try {
        const answer = await report.deliver(body, env);
        const outcome = outcomeOf(answer && Number.isInteger(answer.status) ? answer.status : 0);
        if (outcome === 'refused') console.error(JSON.stringify({ event: 'fleet.report_refused', deployment: meta.id, status: answer.status, error: answer.payload && typeof answer.payload.error === 'string' ? answer.payload.error.slice(0, 200) : '' }));
        return outcome;
      } catch (err) {
        console.error('fleet report: recording this deployment failed', err);
        return 'later';
      }
    }

    let res;
    try {
      res = await fetchImpl(report.to, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SITE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        // Never follow: a redirect would carry the key to an address the site never configured
        redirect: 'manual',
      });
    } catch (err) {
      console.error(JSON.stringify({ event: 'fleet.report_unreachable', deployment: meta.id, error: String(err && err.name) }));
      return 'later';
    }
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      res.body?.cancel();
      console.error(`fleet report: the fleet service answered with a redirect (${res.status}). Check \`report.to\`.`);
      return 'refused';
    }
    const outcome = outcomeOf(res.status);
    if (res.status === 401) {
      res.body?.cancel();
      console.error('fleet report: the fleet service refused this site\'s key. Check the SITE_KEY secret.');
    } else if (outcome === 'refused') {
      console.error(JSON.stringify({ event: 'fleet.report_refused', deployment: meta.id, status: res.status, error: await refusalText(res) }));
    } else {
      res.body?.cancel();
      if (outcome === 'done') console.log(JSON.stringify({ event: 'fleet.report_sent', deployment: meta.id, status: res.status }));
      else console.error(JSON.stringify({ event: 'fleet.report_unavailable', deployment: meta.id, status: res.status }));
    }
    return outcome;
  }

  return function maybeReport(request, env, ctx, url) {
    if (state.status === 'off') return;
    if (state.status === 'done') return;
    if (state.status === 'sending' && Date.now() - state.sentAt < STUCK_SECONDS * 1000) return;
    if (state.status === 'later' && Date.now() < state.retryAt) return;
    if (!isSiteHost(url.hostname)) return;

    const meta = env && env[VERSION_BINDING];
    if (!meta || typeof meta.id !== 'string' || !meta.id) {
      state.status = 'off';
      console.warn(`fleet report: off, because the version metadata binding is missing. Add "version_metadata": { "binding": "${VERSION_BINDING}" } to wrangler.jsonc.`);
      return;
    }
    if (report.to && !env.SITE_KEY) {
      state.status = 'off';
      console.warn('fleet report: off, because the SITE_KEY secret is not set. Ask for this site\'s key and set it with `wrangler secret put SITE_KEY`.');
      return;
    }

    const mine = ++state.seq;
    state.status = 'sending';
    state.sentAt = Date.now();
    const job = send(env, url.origin, meta).then(
      (outcome) => {
        if (mine !== state.seq) return;
        state.status = outcome === 'later' ? 'later' : 'done';
        state.retryAt = outcome === 'later' ? Date.now() + RETRY_SECONDS * 1000 : 0;
      },
      (err) => {
        if (mine !== state.seq) return;
        state.status = 'later';
        state.retryAt = Date.now() + RETRY_SECONDS * 1000;
        console.error('fleet report: sending failed', err);
      },
    );
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  };
}
