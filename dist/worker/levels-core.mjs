/* @bydefaultstudio/design-system v8.2.0 */
/**
 * levels-core.mjs - the pure half of level settings (levels-groups-plan.md D27).
 *
 * No Workers APIs and no I/O, so scripts/verify-levels.mjs imports it in plain
 * node. It holds the level maths, which targets may be changed at all, the
 * admin limits, and the Settings view.
 *
 * Every change reaches the site through a build (access-plan.md rule 1). The
 * gate never reads a setting: it reads the level the last build baked. So
 * there are three levels for any page, and this module keeps them apart:
 *
 *   code       what the page's source says (frontmatter, sectionAccess)
 *   live       what the last build baked: SITE.pages entry.level
 *   projected  what the NEXT build will bake: buildLevel(code, applied rows)
 *
 * A change is "waiting for a build" while projected differs from live. A
 * staged change (a draft) moves neither; it only previews what applying it
 * would make projected.
 *
 * One shape of settings throughout:
 *
 *   { pages: Map<path, level>, sections: Map<folder, level> }
 *
 * Levels rank public < team < admin < owner. "Raise" means a higher rank.
 */

export const LEVELS = ['public', 'team', 'admin', 'owner'];
export const LEVEL_RANK = Object.freeze({ public: 0, team: 1, admin: 2, owner: 3 });

export function isLevel(value) {
  return typeof value === 'string' && LEVELS.includes(value);
}

/** A level's rank, or team's for anything unknown (fail to the gated default, never below it). */
export function rankOf(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? LEVEL_RANK[level] : LEVEL_RANK.team;
}

/** The higher of two levels. */
export function maxLevel(a, b) {
  return rankOf(a) >= rankOf(b) ? a : b;
}

export const EMPTY_SETTINGS = Object.freeze({ pages: new Map(), sections: new Map() });

/**
 * The build's level for a path (D27 precedence): page setting beats section
 * floor beats code, and the floor only raises. The twin of the generator's
 * overlayLevel (cms/generator/generate-docs.js), which duplicates it because
 * the generator ships without worker/.
 */
export function buildLevel(codeLevel, pathname, section, settings = EMPTY_SETTINGS) {
  let base = settings.pages && settings.pages.has(pathname) ? settings.pages.get(pathname) : codeLevel;
  const floor = section && settings.sections && settings.sections.get(section);
  if (floor) base = maxLevel(base, floor);
  return base;
}

/** A page's code level: page-access.mjs writes `code` only where a setting moved it. */
export function codeLevelOf(entry) {
  return entry.code || entry.level;
}

/** What the next build will bake for a page entry, given the applied rows. */
export function projectedLevel(path, entry, settings) {
  return buildLevel(codeLevelOf(entry), path, entry.section, settings);
}

/**
 * The highest a page is or will be: live, projected (applied, waiting for a
 * build) and code. The admin limits judge by this, so an admin can neither
 * touch a page an owner just raised to owner nor one that is owner in code.
 */
function highestLevel(path, entry, settings) {
  return maxLevel(maxLevel(entry.level, codeLevelOf(entry)), projectedLevel(path, entry, settings));
}

/* ------ Which targets may change ------ */

/** The Settings section runs the site: its level is fixed. So is anything outside a section. */
export function isProtectedSection(folder) {
  return typeof folder !== 'string' || folder === '' || folder === 'settings';
}

/**
 * Whether a page may be changed in Settings at all. One rule: exactly the
 * pages the Page levels list shows, which are the pages of a listed section
 * other than Settings. That leaves out, without a list to keep in step, the
 * door pages (sign-in, Ask for access, locked), the home shelf, search, every
 * other root page, and anything with no section such as glossary entries.
 */
export function isSettablePage(path, pages, sections) {
  const entry = pages.get(path);
  if (!entry) return false;
  if (isProtectedSection(entry.section)) return false;
  return Object.prototype.hasOwnProperty.call(sections, entry.section);
}

export function isSettableSection(folder, sections) {
  return !isProtectedSection(folder) && Object.prototype.hasOwnProperty.call(sections, folder);
}

/**
 * The lowest a target may be set to. A section index never drops below team
 * (the existing indexLevel rule): its cards list the section's team and admin
 * pages. Everything else may go to public.
 */
export function floorFor(kind, target) {
  if (kind === 'page' && /^\/[a-z0-9-]+\/index\.html$/.test(target || '')) return 'team';
  return 'public';
}

/* ------ Who may change what ------ */

/** Whether any page in `folder` is, was built as, or will be built as an owner page. */
export function sectionHasOwnerPage(folder, pages, settings = EMPTY_SETTINGS) {
  for (const [path, entry] of pages) {
    if (entry.section === folder && highestLevel(path, entry, settings) === 'owner') return true;
  }
  return false;
}

/**
 * What the admin limits judge a target by, from the APPLIED rows read fresh
 * from D1 (never a cache):
 *   current     the highest the target is or will be
 *   ownerInside a page that is owner anywhere (code, live, projected), or a
 *               section holding such a page
 */
export function targetState(kind, target, pages, settings) {
  if (kind === 'section') {
    const floor = settings.sections.get(target) || 'public';
    return { current: floor, ownerInside: sectionHasOwnerPage(target, pages, settings) };
  }
  const entry = pages.get(target);
  const current = highestLevel(target, entry, settings);
  return { current, ownerInside: current === 'owner' };
}

/**
 * Whether `actorRole` may change a target to `requested` (null = back to code
 * or section) (D27 "who"):
 *
 *   owner  anything.
 *   admin  only public, team or admin; never owner; never a target that is or
 *          will be at owner; never lower, or reset, a target that holds an
 *          owner page.
 */
export function canChangeLevel(actorRole, { current, requested, ownerInside }) {
  if (actorRole === 'owner') return true;
  if (actorRole !== 'admin') return false;
  if (requested === 'owner') return false;
  if (current === 'owner') return false;
  if (ownerInside && (requested === null || rankOf(requested) < rankOf(current))) return false;
  return true;
}

export const REFUSALS = Object.freeze({
  // One answer for a page that does not exist and one an admin may not see,
  // so an admin cannot find owner pages by probing paths.
  unknown: 'That page or section is not one you can change here.',
  setOwner: 'Only an owner sets a page or section to owner.',
  lowerOwner: 'This holds an owner page. Only an owner lowers or resets it.',
  notAllowed: 'Changing levels needs an admin or owner sign-in.',
});

/** The refusal for a change an admin may not make, phrased without naming an owner page. */
export function refusalFor(actorRole, state) {
  if (actorRole !== 'admin' && actorRole !== 'owner') return REFUSALS.notAllowed;
  if (state.requested === 'owner') return REFUSALS.setOwner;
  if (state.current === 'owner') return REFUSALS.unknown;
  return REFUSALS.lowerOwner;
}

/* ------ Requests ------ */

/**
 * A stage request: { kind, target, level } where level null means back to code
 * (a page, back to its section) and a string is a level. Returns the
 * normalised value or an error. An unknown target and an unsettable one get
 * the same words (REFUSALS.unknown).
 */
export function validateLevelChange(body, { pages, sections }) {
  const kind = body && body.kind;
  if (kind !== 'section' && kind !== 'page') return { ok: false, error: 'The change is for a section or a page.' };
  const target = typeof (body && body.target) === 'string' ? body.target.trim().toLowerCase() : '';
  if (!target) return { ok: false, error: 'No section or page named.' };
  let level = body.level === null ? null : body.level;
  if (level !== null && !isLevel(level)) return { ok: false, error: 'The level is public, team, admin or owner.' };
  // A public floor raises nothing, so it is the same as no floor: one meaning,
  // one stored form.
  if (kind === 'section' && level === 'public') level = null;
  const settable = kind === 'section' ? isSettableSection(target, sections) : isSettablePage(target, pages, sections);
  if (!settable) return { ok: false, error: REFUSALS.unknown, unknown: true };
  if (level !== null && rankOf(level) < rankOf(floorFor(kind, target))) {
    return { ok: false, error: 'A section overview stays at team or above.' };
  }
  return { ok: true, value: { kind, target, level } };
}

/* ------ The Settings view ------ */

function settingOf(map, key) {
  return map && map.has(key) ? map.get(key) : null;
}

/** A Map of drafts keyed 'kind:target' -> { level } (level null = reset). */
export function draftKey(kind, target) {
  return `${kind}:${target}`;
}

function withDrafts(applied, drafts) {
  const pages = new Map(applied.pages);
  const sections = new Map(applied.sections);
  for (const [key, draft] of drafts) {
    const at = key.indexOf(':');
    const kind = key.slice(0, at);
    const target = key.slice(at + 1);
    const map = kind === 'section' ? sections : pages;
    if (draft.level === null) map.delete(target);
    else map.set(target, draft.level);
  }
  return { pages, sections };
}

/**
 * The whole Settings view a reader sees (D27). Pure, so scripts/verify-levels.mjs
 * drives it. `pages` is SITE.pages (live levels), `sections` the SECTIONS
 * object, `settings` the APPLIED rows from D1, `drafts` this reader's staged
 * changes, `baked` the rows the last build read (APPLIED_LEVELS), `role` the
 * viewer's.
 *
 * Each target carries one state:
 *   'staged'  this reader has a draft for it (nothing changes until applied)
 *   'waiting' applied, and the next build will change what readers get
 *   null      live as shown
 *
 * An admin never sees an owner page's title: a page that is owner in code,
 * live or projected is left out, and its section carries a count.
 */
export function buildLevelsView(pages, sections, settings, drafts, baked, role) {
  const isOwnerView = role === 'owner';
  const preview = withDrafts(settings, drafts);
  const sectionRows = [];
  let waiting = 0;
  let staged = 0;

  const folders = Object.keys(sections).filter((f) => !isProtectedSection(f))
    .sort((a, b) => sections[a].localeCompare(sections[b], 'en'));
  for (const folder of folders) {
    const floor = settingOf(settings.sections, folder);
    const sectionDraft = drafts.get(draftKey('section', folder));
    const shownFloor = sectionDraft ? sectionDraft.level : floor;
    const sectionWaiting = (floor || null) !== (settingOf(baked.sections, folder) || null);
    let sectionState = null;
    if (sectionDraft) { sectionState = 'staged'; staged += 1; }
    else if (sectionWaiting) { sectionState = 'waiting'; waiting += 1; }

    const pageRows = [];
    let ownerPages = 0;
    const inSection = [...pages].filter(([, e]) => e.section === folder)
      .sort((a, b) => (a[1].title || a[0]).localeCompare(b[1].title || b[0], 'en'));
    for (const [path, entry] of inSection) {
      if (!isOwnerView && highestLevel(path, entry, settings) === 'owner') { ownerPages += 1; continue; }
      const set = settingOf(settings.pages, path);
      const draft = drafts.get(draftKey('page', path));
      const live = entry.level;
      const projected = projectedLevel(path, entry, settings);
      let state = null;
      if (draft) { state = 'staged'; staged += 1; }
      else if (projected !== live) { state = 'waiting'; waiting += 1; }
      const shownSet = draft ? draft.level : set;
      pageRows.push({
        path,
        title: entry.title || path,
        code: codeLevelOf(entry),
        live,
        projected,
        // What the control shows: the level this page will have once any
        // staged change is applied and built.
        level: projectedLevel(path, entry, preview),
        set: shownSet,
        follows: shownSet === null,
        minLevel: floorFor('page', path),
        state,
      });
    }

    sectionRows.push({
      folder,
      label: sections[folder],
      floor: shownFloor,
      level: shownFloor || 'public',
      // The floor as applied, for the admin limits (a lowering is judged from here).
      appliedLevel: floor || 'public',
      setBy: shownFloor ? 'settings' : 'code',
      ownerInside: sectionHasOwnerPage(folder, pages, settings),
      state: sectionState,
      pagesCount: pageRows.length + ownerPages,
      ownerPages,
      pages: pageRows,
    });
  }

  return { viewer: { role, owner: isOwnerView }, sections: sectionRows, waiting, staged };
}
