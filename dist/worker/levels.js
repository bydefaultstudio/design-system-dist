/* @bydefaultstudio/design-system v8.2.0 */
/**
 * levels.js - the D1 reads behind Settings > People > Page levels
 * (levels-groups-plan.md D27).
 *
 * Only the Levels API calls these. The gate never does: a page's level at
 * request time is the one the last build baked (page-access.mjs), so a D1
 * outage can never open or close a page. There is no cache: every call reads
 * fresh, because the admin limits must judge the rows as they are now, and a
 * failed read throws so the API refuses rather than guessing.
 */
import { LEVEL_RANK, draftKey } from './levels-core.mjs';

function isKnownLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level);
}

/**
 * The applied rows, as { pages, sections } Maps of target -> level, and
 * `rows` as a Map of 'kind:target' -> { level, version, updatedAt } for the conditional
 * writes. Throws on a D1 error.
 */
export async function readApplied(env) {
  const { results } = await env.DB.prepare('SELECT kind, target, level, version, updated_at FROM level_setting').all();
  const pages = new Map();
  const sections = new Map();
  const rows = new Map();
  for (const row of results || []) {
    if (!isKnownLevel(row.level)) continue;
    if (row.kind === 'page') pages.set(row.target, row.level);
    else if (row.kind === 'section') sections.set(row.target, row.level);
    else continue;
    rows.set(draftKey(row.kind, row.target), { level: row.level, version: row.version, updatedAt: Number(row.updated_at) || 0 });
  }
  return { pages, sections, rows };
}

/**
 * One reader's staged changes, as a Map of 'kind:target' -> { kind, target,
 * level, baseLevel, baseVersion } (level null = back to code). Throws on a D1
 * error.
 */
export async function readDrafts(env, email) {
  const { results } = await env.DB.prepare(
    'SELECT kind, target, level, base_level, base_version FROM level_draft WHERE staged_by = ?1',
  ).bind(email).all();
  const drafts = new Map();
  for (const row of results || []) {
    if (row.kind !== 'page' && row.kind !== 'section') continue;
    if (row.level !== null && !isKnownLevel(row.level)) continue;
    drafts.set(draftKey(row.kind, row.target), {
      kind: row.kind,
      target: row.target,
      level: row.level,
      baseLevel: row.base_level,
      baseVersion: row.base_version,
    });
  }
  return drafts;
}

/**
 * When a build was last asked for and a change last applied (unix seconds, 0
 * for never), as { trigger, apply }. Throws on a D1 error.
 */
export async function readBuildTimes(env) {
  const row = await env.DB.prepare('SELECT last_trigger_at, last_apply_at FROM level_build WHERE id = 1').first();
  return { trigger: row ? Number(row.last_trigger_at) || 0 : 0, apply: row ? Number(row.last_apply_at) || 0 : 0 };
}
