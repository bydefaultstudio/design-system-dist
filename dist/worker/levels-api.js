/* @bydefaultstudio/design-system v8.2.0 */
/**
 * levels-api.js - the Levels API (levels-groups-plan.md D27): owners and admins
 * stage, apply and discard level changes for a section or a page from
 * Settings > People, with no code change.
 *
 * Mounted at /api/people/levels by worker/gate-entry.mjs after the gate (so it
 * sits before the broader /api/people/ prefix), which hands in the reader; only
 * an admin or an owner gets past the first line. Same origin only, exactly, as
 * the People API.
 *
 * A change moves Staged -> Applied -> Live:
 *   stage    a draft for this reader only. Nothing anyone sees changes.
 *   apply    every draft of this reader's becomes an applied row, at once or
 *            not at all per row, and a build is asked for.
 *   (build)  bakes the applied rows; once deployed the change is live.
 * The gate never reads these rows, so nothing opens or closes before its build.
 *
 * Every admin limit is checked against the applied rows read fresh from D1
 * (levels.js, no cache), on stage AND again on apply. A write lands only on the
 * row its author saw (version), so two people never overwrite each other.
 *
 * Routes (JSON in, JSON out):
 *   GET  /api/people/levels           the view and the build status
 *   POST /api/people/levels/stage     { kind, target, level }  (level null = back to code)
 *   POST /api/people/levels/discard   { kind, target } one draft, or {} all of this reader's
 *   POST /api/people/levels/apply     {}  apply this reader's drafts
 *   POST /api/people/levels/build     {}  Try again: ask for a build
 */
import { isSameOrigin, managesPeople, privateHeaders } from './gate.mjs';
import { SITE } from './site.mjs';
import { readCappedText } from './body-cap.mjs';
import { readApplied, readBuildTimes, readDrafts } from './levels.js';
import { RETRY_SECONDS, buildConfigured, requestRebuild } from './levels-build.mjs';
import {
  REFUSALS,
  buildLevelsView,
  canChangeLevel,
  draftKey,
  refusalFor,
  targetState,
  validateLevelChange,
} from './levels-core.mjs';

export const LEVELS_BASE_PATH = '/api/people/levels';

const BODY_MAX_BYTES = 4 * 1024;

const COPY = {
  notThrough: 'That request did not go through. Reload the page and try again.',
  failed: 'Something went wrong on our side. Nothing was changed. Try again.',
  unavailable: 'The level settings could not be read just now. Nothing was changed. Try again in a moment.',
  moved: 'Someone else changed this since you staged it. Nothing was applied. Review the list and stage it again.',
  nothingStaged: 'There are no staged changes to apply.',
  nothingWaiting: 'No change is waiting for a build.',
  noTrigger: 'This site has no build trigger set up. Changes go live at the next deploy.',
  tooSoon: 'A build was asked for a moment ago. Give it a minute before trying again.',
};

export async function handleLevels(request, env, url, reader, setCookies = [], ctx) {
  if (!reader || !managesPeople(reader.role)) return respond({ error: REFUSALS.notAllowed }, 403, setCookies);
  if (!isSameOrigin(request.headers, url.origin, request.method)) return respond({ error: COPY.notThrough }, 403, setCookies);

  const route = url.pathname.slice(LEVELS_BASE_PATH.length).replace(/^\//, '');
  const now = Math.floor(Date.now() / 1000);
  try {
    if (request.method === 'GET' && route === '') return respond(await view(env, ctx, reader, now), 200, setCookies);
    if (request.method !== 'POST') return respond({ error: COPY.failed }, 405, setCookies);

    const body = await readJson(request);
    if (!body) return respond({ error: COPY.notThrough }, 400, setCookies);

    let result;
    if (route === 'stage') result = await stage(env, reader, body, now);
    else if (route === 'discard') result = await discard(env, reader, body);
    else if (route === 'apply') result = await apply(env, ctx, reader, now);
    else if (route === 'build') result = await tryAgain(env, ctx, reader, now);
    else result = { status: 404, body: { error: COPY.failed } };
    return respond(result.body, result.status, setCookies);
  } catch (error) {
    // A D1 read or write failed. Nothing was half-applied: every write below
    // is one batch, which D1 runs as a transaction.
    console.error(JSON.stringify({ event: 'levels.failed', route, error: String(error && error.message) }));
    return respond({ error: COPY.unavailable }, 503, setCookies);
  }
}

/* ------ Read ------ */

async function view(env, ctx, reader, now) {
  const [applied, drafts, times] = await Promise.all([readApplied(env), readDrafts(env, reader.email), readBuildTimes(env)]);
  const out = buildLevelsView(SITE.pages, SITE.sections, applied, drafts, SITE.appliedLevels, reader.role);
  const configured = buildConfigured(env);
  let last = times.trigger;
  // A change applied after the deployed build read D1, with no build asked for
  // since, slipped past that build: ask for one now. This is what catches an
  // apply that landed while a build was already past its D1 read.
  if (configured && times.apply > SITE.levelsReadAt && times.apply > times.trigger) {
    last = (await requestRebuild(env, ctx, { now, last: times.trigger })).at;
  }
  out.build = buildStatus(configured, last, now);
  return out;
}

/**
 * What Settings says about the build: whether a trigger is set up, when one was
 * last asked for (only if after the deployed build read D1), and whether Try
 * again is allowed yet.
 */
function buildStatus(configured, last, now) {
  const asked = last > SITE.levelsReadAt ? last : 0;
  return {
    configured,
    askedAt: asked,
    readAt: SITE.levelsReadAt,
    // False when the live build did not read the settings (no LEVELS_FROM_D1):
    // then it was built at code levels, and every applied change, raises
    // included, is off the site until a build that reads them.
    readsSettings: SITE.levelsReadAt > 0,
    canRetry: configured && now - last >= RETRY_SECONDS,
  };
}

/* ------ Stage and discard ------ */

async function stage(env, reader, body, now) {
  const checked = validateLevelChange(body, { pages: SITE.pages, sections: SITE.sections });
  if (!checked.ok) return { status: checked.unknown ? 404 : 400, body: { error: checked.error } };
  const { kind, target, level } = checked.value;

  const applied = await readApplied(env);
  const row = applied.rows.get(draftKey(kind, target));
  const baseLevel = row ? row.level : null;
  // Staging what is already applied is no change: drop any draft instead. It
  // changes nothing, so it skips the limits, except on a page an admin may not
  // see, which still answers as unknown (a section's level is never hidden).
  if (level === baseLevel && (kind === 'section' || !refuse(reader.role, kind, target, level, applied))) {
    await env.DB.prepare('DELETE FROM level_draft WHERE staged_by = ?1 AND kind = ?2 AND target = ?3').bind(reader.email, kind, target).run();
    return { status: 200, body: { ok: true, staged: false } };
  }
  const refusal = refuse(reader.role, kind, target, level, applied);
  if (refusal) return refusal;

  await env.DB.prepare(
    'INSERT INTO level_draft (staged_by, kind, target, level, base_level, base_version, staged_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) '
    + 'ON CONFLICT(staged_by, kind, target) DO UPDATE SET level = excluded.level, base_level = excluded.base_level, '
    + 'base_version = excluded.base_version, staged_at = excluded.staged_at',
  ).bind(reader.email, kind, target, level, baseLevel, row ? row.version : null, now).run();
  return { status: 200, body: { ok: true, staged: true } };
}

async function discard(env, reader, body) {
  if (body.kind === undefined && body.target === undefined) {
    await env.DB.prepare('DELETE FROM level_draft WHERE staged_by = ?1').bind(reader.email).run();
    return { status: 200, body: { ok: true } };
  }
  const kind = body.kind;
  const target = typeof body.target === 'string' ? body.target.trim().toLowerCase() : '';
  if ((kind !== 'page' && kind !== 'section') || !target) return { status: 400, body: { error: COPY.notThrough } };
  await env.DB.prepare('DELETE FROM level_draft WHERE staged_by = ?1 AND kind = ?2 AND target = ?3').bind(reader.email, kind, target).run();
  return { status: 200, body: { ok: true } };
}

/** The refusal for a change this reader may not make, or null. */
function refuse(role, kind, target, requested, applied) {
  const { current, ownerInside } = targetState(kind, target, SITE.pages, applied);
  if (canChangeLevel(role, { current, requested, ownerInside })) return null;
  const error = refusalFor(role, { current, requested, ownerInside });
  // An owner-level target an admin may not see answers like an unknown one.
  return { status: error === REFUSALS.unknown ? 404 : 403, body: { error } };
}

/* ------ Apply ------ */

async function apply(env, ctx, reader, now) {
  const [applied, drafts] = await Promise.all([readApplied(env), readDrafts(env, reader.email)]);
  if (drafts.size === 0) return { status: 409, body: { error: COPY.nothingStaged } };

  // Every draft is checked before anything is written, so a refused or moved
  // draft stops the whole apply and the reader sees the list as it is.
  const moved = [];
  for (const draft of drafts.values()) {
    const checked = validateLevelChange({ kind: draft.kind, target: draft.target, level: draft.level }, { pages: SITE.pages, sections: SITE.sections });
    if (!checked.ok) return { status: checked.unknown ? 404 : 400, body: { error: checked.error } };
    const refusal = refuse(reader.role, draft.kind, draft.target, draft.level, applied);
    if (refusal) return refusal;
    const row = applied.rows.get(draftKey(draft.kind, draft.target));
    if ((row ? row.version : null) !== (draft.baseVersion === null ? null : Number(draft.baseVersion))) moved.push(draft);
  }
  if (moved.length) return { status: 409, body: { error: COPY.moved, moved: moved.map((d) => ({ kind: d.kind, target: d.target })) } };

  // One batch, one transaction. Each write is conditional on the version the
  // reader staged against, so a change that slipped in between the check
  // above and this batch is not overwritten: its write changes no row, and
  // the history and draft deletes that follow it are skipped with it
  // (changes() reads the statement before).
  const statements = [];
  const writes = [];
  for (const draft of drafts.values()) {
    const { kind, target, level } = draft;
    const before = draft.baseLevel;
    if (level === null) {
      statements.push(env.DB.prepare('DELETE FROM level_setting WHERE kind = ?1 AND target = ?2 AND version = ?3').bind(kind, target, draft.baseVersion));
    } else if (draft.baseVersion === null) {
      statements.push(env.DB.prepare(
        'INSERT INTO level_setting (kind, target, level, version, updated_by, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5) ON CONFLICT(kind, target) DO NOTHING',
      ).bind(kind, target, level, reader.email, now));
    } else {
      statements.push(env.DB.prepare(
        'UPDATE level_setting SET level = ?3, version = version + 1, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND target = ?2 AND version = ?6',
      ).bind(kind, target, level, reader.email, now, draft.baseVersion));
    }
    writes.push(statements.length - 1);
    statements.push(env.DB.prepare(
      'INSERT INTO level_setting_history (kind, target, old_level, new_level, changed_by, changed_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE changes() = 1',
    ).bind(kind, target, before, level, reader.email, now));
    statements.push(env.DB.prepare(
      'DELETE FROM level_draft WHERE staged_by = ?1 AND kind = ?2 AND target = ?3 AND changes() = 1',
    ).bind(reader.email, kind, target));
  }
  // Dated even when a write missed: a later apply time than the deployed
  // build's read only ever asks for one build too many, never one too few.
  statements.push(env.DB.prepare(
    'INSERT INTO level_build (id, last_apply_at) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET last_apply_at = ?1',
  ).bind(now));
  const results = await env.DB.batch(statements);
  const landed = writes.filter((i) => results[i] && results[i].meta && results[i].meta.changes > 0).length;
  const missed = writes.length - landed;

  let build = { configured: buildConfigured(env), triggered: false };
  if (landed > 0) build = await requestRebuild(env, ctx, { now, last: (await readBuildTimes(env)).trigger });
  return {
    status: missed ? 409 : 200,
    body: {
      ok: missed === 0,
      applied: landed,
      error: missed ? COPY.moved : undefined,
      build: { configured: build.configured, asked: build.triggered || build.at > SITE.levelsReadAt },
    },
  };
}

/* ------ Try again ------ */

async function tryAgain(env, ctx, reader, now) {
  if (!buildConfigured(env)) return { status: 409, body: { error: COPY.noTrigger } };
  const [applied, times] = await Promise.all([readApplied(env), readBuildTimes(env)]);
  // Counted over every page, owner pages included, whoever is asking.
  const waiting = buildLevelsView(SITE.pages, SITE.sections, applied, new Map(), SITE.appliedLevels, 'owner').waiting;
  if (waiting === 0 && times.apply <= SITE.levelsReadAt) return { status: 409, body: { error: COPY.nothingWaiting } };
  const rebuild = await requestRebuild(env, ctx, { now, last: times.trigger, gapSeconds: RETRY_SECONDS });
  if (!rebuild.triggered) return { status: 429, body: { error: COPY.tooSoon } };
  return { status: 200, body: { ok: true, askedAt: rebuild.at } };
}

/* ------ Helpers ------ */

async function readJson(request) {
  const read = await readCappedText(request, BODY_MAX_BYTES);
  if (!read || read.tooLarge || read.failed) return null;
  try {
    const body = JSON.parse(read.text || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function respond(body, status, setCookies) {
  return privateHeaders(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    setCookies,
  );
}
