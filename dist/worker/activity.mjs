/* @bydefaultstudio/design-system v8.6.1 */
/**
 * activity.mjs - the sign-in activity log (engine, off until a site installs
 * the `activity` app; migration 0016_activity.sql).
 *
 * The gate (gate-entry.mjs) hands this module three kinds of event, only
 * while the app is installed and only for a signed-in reader:
 *
 *   sign-in    a code that verified (POST /api/auth/sign-in/email-otp, 200)
 *   page       a gated HTML page the reader opened: a browser navigation
 *              to a document (not a frame), or the router's fetch of the
 *              next page (x-barba: yes, a click through the sidebar). A
 *              browser too old to send Fetch Metadata (Safari before 16.4)
 *              cannot be told apart from a script's fetch, so it is counted;
 *              and a router fetch that fails over to a full load counts twice
 *   download   an Asset Library file served from /files/<id>/<name>: the
 *              whole file, or the first part of a ranged download, never a
 *              thumbnail or a ?view=1 preview
 *
 * Each is one row: the time, the reader's email, the kind, the path. No IP
 * address, no user agent, no query string. The write runs after the response
 * (ctx.waitUntil) and a failure is a log line, never a reader's lost page.
 * While migration 0016 is missing every write fails the same way: one line
 * per isolate says so, and the site works as before.
 *
 * Retention: rows older than `retentionDays` (395, about 13 months, unless
 * the site passes `activity: { retentionDays }` to createGate) are deleted
 * with a write, at most once an hour per isolate. No scheduled job needed.
 *
 * GET /api/activity      gated, the owner alone
 *   ?person=<email>&kind=<sign-in|page|download>&before=<id>
 *   The newest PAGE_SIZE events, filtered, plus (on an unfiltered first
 *   page, the page's opening load and its Reload) one line per person: their name, last sign-in, last seen, and how many sign-ins,
 *   pages and downloads the log holds for them. The page that reads it,
 *   /settings/activity.html, is owner only by its `access:`; this answer
 *   checks the reader's role itself, so a page map mistake cannot open it.
 */
import { isOwner, isSameOrigin, privateHeaders } from './gate.mjs';

export const ACTIVITY_API_PATH = '/api/activity';
export const ACTIVITY_KINDS = ['sign-in', 'page', 'download'];
export const DEFAULT_RETENTION_DAYS = 395;
export const PAGE_SIZE = 100;
const DAY = 24 * 60 * 60;
const SWEEP_EVERY = 60 * 60;
const MAX_PATH = 512;
const MAX_EMAIL = 320;

const COPY = {
  forbidden: 'This page is for the owner.',
  notThrough: 'That request did not go through. Reload the page and try again.',
  notReady: 'The activity log isn\'t set up on this deployment yet: its database is missing the activity table.',
  failed: 'Something went wrong on our side. Try again.',
};

// Per isolate: when the last sweep ran, and whether the missing table was said
let lastSweepAt = 0;
let saidMissing = false;

/** The createGate `activity` option as { retentionDays }; anything unusable is the default. */
export function activityOption(option) {
  const days = option && typeof option === 'object' ? option.retentionDays : undefined;
  if (days === undefined) return { retentionDays: DEFAULT_RETENTION_DAYS };
  if (!Number.isInteger(days) || days < 1) {
    console.warn(`activity: retentionDays must be a whole number of days, 1 or more; using ${DEFAULT_RETENTION_DAYS}.`);
    return { retentionDays: DEFAULT_RETENTION_DAYS };
  }
  return { retentionDays: days };
}

function tableMissing(err) {
  return /no such table/i.test(String(err && err.message ? err.message : err));
}

/** An email as the log keeps it: trimmed, lowercased, or null. */
export function normaliseEmail(email) {
  if (typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  return value && value.length <= MAX_EMAIL && value.includes('@') ? value : null;
}

/** A row the log can take, or null: a known kind, an email, a path with no query. */
export function activityRow(kind, email, path = '', now = Math.floor(Date.now() / 1000)) {
  if (!ACTIVITY_KINDS.includes(kind)) return null;
  const who = normaliseEmail(email);
  if (!who) return null;
  // A path the page can link to safely: one leading slash, never "//host"
  const where = typeof path === 'string' ? path.split('?')[0].replace(/^\/{2,}/, '/').slice(0, MAX_PATH) : '';
  return { at: now, email: who, kind, path: where };
}

/**
 * Whether a served download is one to log: GET, 200, or 206 for a range
 * starting at byte 0 (a resumed or seeking download asks again from later
 * on, and is the same download), and never a ?view=1 preview.
 */
export function isLoggedDownload(request, url, response) {
  if (request.method !== 'GET' || url.searchParams.get('view') === '1') return false;
  if (response.status === 200) return true;
  if (response.status !== 206) return false;
  return /^bytes=0-/.test(request.headers.get('range') || '');
}

/**
 * Write one row in the background. `ctx` may be missing (a test): the write
 * then runs unawaited. Never throws.
 */
export function recordActivity(env, ctx, row, { retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  if (!row || !env || !env.DB) return;
  const work = writeRow(env.DB, row, retentionDays).catch((err) => {
    if (tableMissing(err)) {
      if (!saidMissing) console.error('activity: the activity table is missing: apply migration 0016_activity.sql');
      saidMissing = true;
      return;
    }
    console.error(JSON.stringify({ event: 'activity.write_failed', kind: row.kind, error: String(err && err.message) }));
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
}

async function writeRow(db, row, retentionDays) {
  const insert = db.prepare('INSERT INTO activity_log (at, email, kind, path) VALUES (?, ?, ?, ?)')
    .bind(row.at, row.email, row.kind, row.path);
  if (row.at - lastSweepAt < SWEEP_EVERY) {
    await insert.run();
    return;
  }
  lastSweepAt = row.at;
  await db.batch([
    insert,
    db.prepare('DELETE FROM activity_log WHERE at < ?').bind(row.at - retentionDays * DAY),
  ]);
}

/** Test hook: forget the isolate's sweep time and missing-table note. */
export function resetActivityState() {
  lastSweepAt = 0;
  saidMissing = false;
}

/** The page's filters from the query string: { person, kind, before }, each null when unset or unusable. */
export function readFilters(url) {
  const person = normaliseEmail(url.searchParams.get('person') || '');
  const kind = url.searchParams.get('kind');
  const before = Number(url.searchParams.get('before'));
  return {
    person,
    kind: ACTIVITY_KINDS.includes(kind) ? kind : null,
    before: Number.isInteger(before) && before > 0 ? before : null,
  };
}

function json(status, payload, setCookies) {
  return privateHeaders(new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }), setCookies);
}

/** GET /api/activity: the Activity page's data, for the owner alone. */
export async function handleActivityApi(request, env, url, reader, setCookies = [], { retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  if (!reader || !isOwner(reader.role)) return json(403, { error: COPY.forbidden }, setCookies);
  if (!isSameOrigin(request.headers, url.origin, request.method)) return json(403, { error: COPY.notThrough }, setCookies);
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' }, setCookies);

  const { person, kind, before } = readFilters(url);
  const where = [];
  const binds = [];
  if (person) { where.push('email = ?'); binds.push(person); }
  if (kind) { where.push('kind = ?'); binds.push(kind); }
  if (before) { where.push('id < ?'); binds.push(before); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const queries = [
      // One more than a page, to know whether there is a next one
      env.DB.prepare(`SELECT id, at, email, kind, path FROM activity_log ${clause} ORDER BY id DESC LIMIT ?`).bind(...binds, PAGE_SIZE + 1),
    ];
    // The summary and names only with an unfiltered first page: a filter
    // change or "Show older" needs neither, and the summary reads every row
    if (!before && !person && !kind) {
      queries.push(env.DB.prepare(
        `SELECT email,
                MAX(CASE WHEN kind = 'sign-in' THEN at END) AS last_sign_in_at,
                MAX(at) AS last_seen_at,
                SUM(kind = 'sign-in') AS sign_ins,
                SUM(kind = 'page') AS pages,
                SUM(kind = 'download') AS downloads
           FROM activity_log GROUP BY email ORDER BY last_seen_at DESC`,
      ));
      queries.push(env.DB.prepare('SELECT lower(email) AS email, name FROM "user"'));
    }
    const [events, summary, users] = await env.DB.batch(queries);
    const rows = events.results || [];
    const more = rows.length > PAGE_SIZE;
    const payload = {
      retentionDays,
      events: rows.slice(0, PAGE_SIZE),
      more,
    };
    if (summary) {
      const names = new Map((users.results || []).map((u) => [u.email, u.name || '']));
      payload.people = (summary.results || []).map((p) => ({
        email: p.email,
        name: names.get(p.email) || '',
        lastSignInAt: p.last_sign_in_at ?? null,
        lastSeenAt: p.last_seen_at ?? null,
        signIns: p.sign_ins || 0,
        pages: p.pages || 0,
        downloads: p.downloads || 0,
      }));
    }
    return json(200, payload, setCookies);
  } catch (err) {
    if (tableMissing(err)) {
      console.error('activity: the activity table is missing: apply migration 0016_activity.sql');
      return json(503, { error: COPY.notReady }, setCookies);
    }
    console.error('activity: could not read the log', err);
    return json(500, { error: COPY.failed }, setCookies);
  }
}
