#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readIconAliases } = require('./icon-aliases');
const assetLibrary = require('./asset-library');
const formatRegistry = require('./formats');
const formatCard = require('./format-card');
const siteMap = require('./site-map');
const brandFile = require('./brand');
const locale = require('./locale');
const appsRegistry = require('./apps');
const osJson = require('./os-json');
// The engine's own version, from the package this generator ships in, so a
// generated file's banner can't freeze on the release it was first written in.
const ENGINE_VERSION = require(path.join(__dirname, '..', '..', 'package.json')).version;
const showcase = require('./showcase');
const { marked } = require('marked');

//------- Project discovery -------//
//
// Walk up from cwd: the first directory containing docs/docs.config.js or
// cms/docs.config.js is the project root, and the folder holding the config
// is the content dir. All config paths resolve from the project root. This
// keeps `cd cms/generator && npm run docgen` working when the generator runs
// from source, and lets a consumer run it straight from node_modules with no
// flags (node_modules sits inside the project root, so the walk finds it).
function locateProject() {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of ['docs', 'cms']) {
      const configPath = path.join(dir, candidate, 'docs.config.js');
      if (fs.existsSync(configPath)) {
        return { root: dir, contentDir: path.join(dir, candidate), configPath };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      console.error(`❌ No docs/docs.config.js or cms/docs.config.js found from ${process.cwd()} upward.`);
      console.error('   Create one next to your markdown files (see the generator README).');
      process.exit(1);
    }
    dir = parent;
  }
}

const PROJECT = locateProject();
const ROOT = PROJECT.root;
const DOCS_DIR = PROJECT.contentDir;
const TEMPLATE_FILE = path.join(__dirname, 'template.html');
// The bare type's template (PD-1): every page outside the docs layout
const BARE_TEMPLATE_FILE = path.join(__dirname, 'template-bare.html');
// What applyTemplateChrome resolves that the bare template shares: the docs
// CSS link and the UI scripts' paths
const CHROME = { docsCssHref: null, uiScripts: [] };
// Bundled fallback assets (docs.css, ui scripts, chrome icons) — present only
// in the shipped docs-kit package, not when running from repo source.
const KIT_ASSETS = path.join(__dirname, 'assets');
// The kit's default uiScripts, in load order: the docs chrome, then the core
// components. One list in component-modules.json, which build-package.js
// reads to ship exactly these files into dist/docs-kit/assets/js/.
const KIT_UI_SCRIPTS = require('./component-modules.json').kitUiScripts;

const userConfig = require(PROJECT.configPath);

// One config contract. Core keys have neutral defaults; the extension surface
// (extra*, bodyAttrs, wrapperAttrs, containerAttrs, brandManifest, brandsDir)
// defaults to off — that is the lean core a consuming project runs.
const CONFIG = {
  // Core
  outputDir: userConfig.outputDir || path.join(path.basename(DOCS_DIR), 'site'),
  basePath: userConfig.basePath || '',
  // The deployed origin, no trailing slash. Only pages shared outside the site
  // read it (the public Showcase pages' canonical and Open Graph URLs, which
  // must be absolute); unset, those pages emit relative tags and no canonical.
  siteUrl: (userConfig.siteUrl || '').replace(/\/+$/, ''),
  // A level for every page in an output folder that declares none
  // (levels-groups-plan.md D18): { social: 'admin' }. A page's own `access:`
  // still wins; a folder with no entry stays team. Read by sectionLevel().
  sectionAccess: userConfig.sectionAccess || {},
  designSystemPath: userConfig.designSystemPath || 'assets/css/design-system.css',
  brandCssPath: userConfig.brandCssPath || null,
  googleFontsUrl: userConfig.googleFontsUrl !== undefined ? userConfig.googleFontsUrl : null,
  siteName: userConfig.siteName || 'Documentation',
  footerText: userConfig.footerText || '',
  indexDescription: userConfig.indexDescription || 'Complete documentation for your project.',
  iconsDir: userConfig.iconsDir || null,
  docsCss: userConfig.docsCss || null,
  highlightJs: userConfig.highlightJs || 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  sectionFolders: userConfig.sectionFolders || {},
  // Section labels the site has renamed, old -> new. A page still naming the
  // old one, from a branch cut before the rename, fails the build rather than
  // landing in a section nobody maps.
  retiredSections: userConfig.retiredSections || {},
  filenameOverrides: userConfig.filenameOverrides || {},
  indexCards: userConfig.indexCards || null,
  // The home page's own header: a function ({ title, description }) => HTML,
  // used in place of the standard page header. The strings arrive escaped.
  indexHeader: typeof userConfig.indexHeader === 'function' ? userConfig.indexHeader : null,
  logoHtml: userConfig.logoHtml || null,
  contactHref: userConfig.contactHref || null,
  contactLabel: userConfig.contactLabel || 'Contact',
  sectionIcons: userConfig.sectionIcons || {},
  rootLinks: userConfig.rootLinks || [],
  markdownSourceBase: userConfig.markdownSourceBase || null,
  // Site search: search.js is a kit UI script and the indexes come from
  // `npx bd-search` after the site is assembled (C1). Every site that installs has search (D3); `search: false` opts out. A
  // legacy site keeps the old default, off, until it moves
  search: userConfig.search === undefined ? !!userConfig.install : userConfig.search === true,
  validateLayers: userConfig.validateLayers === true,
  // Page transitions are always on (engine parity C3, D5): one router,
  // barba-docs.js, on every site. `transitions` picks a named transition
  // per scenario from the kit's library, e.g. { open: 'fade' }; unset, each
  // scenario keeps the kit's default (TRANSITION_DEFAULTS).
  transitions: userConfig.transitions || null,
  // The feedback form (opt-in): the footer's "Was this helpful?" block, the
  // shared dialog, Share feedback / Report a problem in the doc bar's menu,
  // and feedback.js. It posts to /api/submit-form, which the site's own
  // Worker must provide — see the docs-kit README, "Feedback".
  feedback: userConfig.feedback === true,
  // A site that serves feedback.js from its own tree names it here; unset,
  // the kit's copy is shipped into assets/docs-kit/.
  feedbackScript: userConfig.feedbackScript || null,
  // The glossary reading drawer: on whenever cms/glossary/ exists, so a site
  // that builds a glossary gets glossary.js and its starter in
  // assets/docs-kit/. Every site uses it, By Default OS included; a site
  // that loads and starts glossary.js itself sets false. See the docs-kit README,
  // "Glossary".
  glossaryDrawer: userConfig.glossaryDrawer !== false,
  // By Default OS features. Each writes files a docs-kit project does not own
  // (worker/*.mjs, experiments/, a public /showcase/), and a project with its
  // own Worker has a worker/ folder for other reasons, so each is opt-in.
  showcase: userConfig.showcase === true,
  siteMap: userConfig.siteMap === true,
  accessGate: userConfig.accessGate === true,
  // How a page above the reader shows in navigation (levels-groups-plan.md
  // D19): 'locked' (the default, and By Default OS) lists every page and
  // nav.js paints locks; 'hidden' moves the sidebar list into each page
  // (#site-nav-source) so the Worker can remove what a reader cannot open
  // before it leaves (worker/hidden-nav.mjs). Hidden needs the Worker's
  // rewrite: without it every reader sees every title, as with 'locked'.
  accessNav: userConfig.accessNav === 'hidden' ? 'hidden' : 'locked',
  assetLibrary: userConfig.assetLibrary === true,
  uiScripts: userConfig.uiScripts || null, // null = the kit set, component-modules.json kitUiScripts
  // Extension surface (all off by default)
  extraHeadHtml: userConfig.extraHeadHtml || '',
  // Markup first in <body>, before the layout (a curtain, a banner: anything
  // that has to be in the document before the page is).
  extraBodyStartHtml: userConfig.extraBodyStartHtml || '',
  extraStylesheets: userConfig.extraStylesheets || [],
  extraScripts: userConfig.extraScripts || [],
  extraContentHtml: userConfig.extraContentHtml || '',
  extraBodyEndHtml: userConfig.extraBodyEndHtml || '',
  bodyAttrs: userConfig.bodyAttrs || '',
  wrapperAttrs: userConfig.wrapperAttrs || '',
  containerAttrs: userConfig.containerAttrs || '',
  // The brand settings file (brand.js, engine parity phase 0). cms/brand.json
  // when it exists and the config names none.
  brandManifest: userConfig.brandManifest
    || (fs.existsSync(path.join(PROJECT.root, 'cms', 'brand.json')) ? 'cms/brand.json' : null),
  // Where the two runtime files generated from it are written, from the
  // output root. A site that gates its artwork serves the logo manifest from
  // a gated folder (BlackDoctor: media/js/logo-manifest.js).
  brandOutputs: Object.assign(
    { themeConfig: 'assets/js/theme-config.js', logoManifest: 'assets/js/logo-manifest.js' },
    userConfig.brandOutputs || {}
  ),
  brandsDir: userConfig.brandsDir || null,
  // By Default mentions a client site keeps on purpose, each with a reason:
  // [{ file: 'brand/about.html', text: 'By Default', reason: '…' }]. The
  // build fails on any other (checkClientWording).
  allowWording: Array.isArray(userConfig.allowWording) ? userConfig.allowWording : [],
  // Site paths a public door page loads that a build step after docgen
  // copies into the output: ['/media/fonts/x.woff2']. The door check fails on
  // any other file it can't find (checkDoorPages).
  doorFilesAddedLater: Array.isArray(userConfig.doorFilesAddedLater) ? userConfig.doorFilesAddedLater : [],
  // The packages and apps this site has (apps.js, engine parity phase B):
  // { packages: ['brand', 'utilities'], off: ['color-palette'] }. Unset, the
  // site keeps every cms/apps page it has and loads app files itself, as
  // before phase B.
  install: userConfig.install === undefined ? null : userConfig.install,
};
// Legacy alias — the body of this file predates the unified contract.
const PROJECT_CONFIG = CONFIG;

// basePath contract: '' (site root, the default) or '/sub/path' — leading
// slash, no trailing slash. Fail loudly; a silently malformed prefix would
// break every nav link in the output.
if (CONFIG.basePath && (!CONFIG.basePath.startsWith('/') || CONFIG.basePath.endsWith('/'))) {
  console.error(`❌ Invalid basePath: "${CONFIG.basePath}" — it must start with "/" and must not end with "/", e.g. "/docs/site". Leave it unset to serve from the site root.`);
  process.exit(1);
}

// Page transitions stopped being a choice in engine parity C3: every site runs
// the kit's router. A leftover flag does nothing, so it warns rather than
// fails, and says what to delete.
if (userConfig.pageTransitions !== undefined) {
  console.warn(`⚠️  pageTransitions is gone: every site runs the kit's router (barba-docs.js). Delete pageTransitions from docs.config.js; to change how a navigation looks, set transitions (docs-kit README, "Page transitions").`);
}

// The router owns the Barba markup. A data-barba attribute in wrapperAttrs or
// containerAttrs would put a second set on the element, and was how a site
// ran its own router before C3.
if (/data-barba(?:-[a-z]+)?\s*=/.test(CONFIG.wrapperAttrs + CONFIG.containerAttrs)) {
  console.error('❌ wrapperAttrs/containerAttrs carry data-barba markup. The generator stamps it on every site now (engine parity C3): delete those attributes from docs.config.js, and the site\'s own Barba script and transition stylesheet with them.');
  process.exit(1);
}

// The kit router's transition library, by scenario. Mirrors TRANSITION_MAP
// and TRANSITIONS in assets/js/barba-docs.js; bd-verify-router keeps them
// equal. A new transition joins both.
const TRANSITION_DEFAULTS = {
  open: 'slide-up',
  close: 'slide-down',
  swap: 'slide-left',
  'swap-back': 'slide-right',
  fade: 'fade',
};
const TRANSITION_NAMES = ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'fade'];

if (CONFIG.transitions !== null) {
  const t = CONFIG.transitions;
  const problems = [];
  if (typeof t !== 'object' || Array.isArray(t)) {
    problems.push(`expected an object such as { open: 'fade' }, got ${JSON.stringify(t)}`);
  } else {
    for (const [scenario, name] of Object.entries(t)) {
      if (!Object.prototype.hasOwnProperty.call(TRANSITION_DEFAULTS, scenario)) {
        problems.push(`"${scenario}" is not a scenario (${Object.keys(TRANSITION_DEFAULTS).join(', ')})`);
      } else if (!TRANSITION_NAMES.includes(name)) {
        problems.push(`${scenario}: "${name}" is not a transition (${TRANSITION_NAMES.join(', ')})`);
      }
    }
  }
  if (problems.length) {
    console.error(`❌ Invalid transitions in docs.config.js:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}

if (userConfig.feedback !== undefined && typeof userConfig.feedback !== 'boolean') {
  console.error(`❌ Invalid feedback: expected true or false, got ${JSON.stringify(userConfig.feedback)}. The feedback form is opt-in — read the "Feedback" section of the docs-kit README before enabling it.`);
  process.exit(1);
}

if (userConfig.glossaryDrawer !== undefined && typeof userConfig.glossaryDrawer !== 'boolean') {
  console.error(`❌ Invalid glossaryDrawer: expected true or false, got ${JSON.stringify(userConfig.glossaryDrawer)}. Leave it unset for the glossary reading drawer, or set false when the site loads glossary.js itself — see the "Glossary" section of the docs-kit README.`);
  process.exit(1);
}

// When running from the shipped package with no explicit designSystemPath,
// serve the packaged framework CSS (a dist/ sibling of the docs-kit) so a
// zero-config project still gets a fully styled site.
const PACKAGED_DS_CSS = path.join(__dirname, '..', 'design-system.css');
const USE_PACKAGED_DS = !userConfig.designSystemPath && fs.existsSync(PACKAGED_DS_CSS);
if (USE_PACKAGED_DS) CONFIG.designSystemPath = 'assets/docs-kit/design-system.css';

const OUTPUT_DIR = path.resolve(ROOT, CONFIG.outputDir);
// Brand spaces (brandsDir) were removed in phase 0 (P0-4): a deployment holds
// one brand (access-plan.md D7), set in its brand.json.
if (CONFIG.brandsDir) {
  console.warn('⚠️  brandsDir is no longer read: brand spaces were removed. A site holds one brand, set in its brand.json (brandManifest). Delete brandsDir from docs.config.js.');
}

// Every page's level, for the access gate (access-plan.md §12.4;
// permissions-plan.md §4.1). Each emitter records its output URL as it writes
// a page, public, team or admin from the page's OWN `access:` frontmatter,
// never from _defaults.md, and writePageAccess() serialises the map at the end
// of a full build. Only the three literal strings count: a missing field, a
// typo or any other value is a team page (fail closed, §4.2). The home shelf
// and the section indexes are recorded too, as the index types, which the gate
// opens to every signed-in reader.
const pageAccess = new Map();
// Each published markdown source, by URL, to the page it is the source of, so
// the gate judges /cms/setup.md at setup.html's level instead of the default
// team. Written beside PAGE_ACCESS by writePageAccess().
const sourcePages = new Map();

// Every page's level by URL, filled from the file list BEFORE any page is
// rendered (see the main build): pageAccess fills as pages are written, so a
// body link to a page not yet written would otherwise find nothing. Read by
// levelOf() for the links stampBodyLinks() marks and the covers the index
// builders draw. A page in neither map reads as team: under 'hidden' a
// signed-out reader loses that link and a guest keeps it only where their
// grants reach the path, which is the gate's own default for the page.
const linkLevels = new Map();
function levelOf(pathname) {
  // A folder link (/website/) is its index, as the gate and stampBodyLinks read it.
  if (pathname.endsWith('/')) pathname += 'index.html';
  const known = pageAccess.get(pathname);
  return (known && known.level) || linkLevels.get(pathname) || 'team';
}

const LEVEL_RANK = { public: 0, team: 1, admin: 2, owner: 3 };
// Body links that point above their page's level, reported at the end of the
// build: under 'hidden' they fail it, since a reader who may open the page
// could never open the link, and the sentence would still name the page. A
// link to the home or a section index is never one: the gate opens those to
// every signed-in reader and their titles are the section labels - unless the
// section sets a level above team (indexLevel), when it counts like any page.
const bodyLinkViolations = [];
function isIndexPagePath(pathname) {
  return pathname === '/index.html' || /^\/[a-z0-9-]+\/index\.html$/.test(pathname);
}

/**
 * Stamp every link in a page's body that points at a site page with that
 * page's level, so the hidden-navigation cut (worker/hidden-nav.mjs) applies
 * to prose links and inline cards as it does to the sidebar, the index cards
 * and the pager. Without it a sentence linking an owner page named that page
 * to every reader, whatever their level (security audit 2026-11-09, finding
 * 7). A link that already carries data-access, an external one, a fragment,
 * or a target that is not a page is left as written. Under 'locked' the
 * attribute is inert on prose: nav.js locks cards, pager and sidebar only.
 * `mark: false` checks the links without writing the attribute, for a page
 * where nothing would ever read it.
 */
function stampBodyLinks(html, pagePath, pageLevel, { mark = true } = {}) {
  // Attribute values are matched whole, so a `>` inside one (a title, an
  // aria-label) does not end the tag early.
  const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')`;
  return html.replace(new RegExp(`<a\\b(${ATTRS}*?)\\shref="([^"]+)"(${ATTRS}*)>`, 'g'), (match, before, href, after) => {
    if (/\sdata-access=/.test(before + after)) return match;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return match;
    let target;
    try {
      target = new URL(href, `https://x${pagePath}`).pathname;
    } catch {
      return match;
    }
    if (target.endsWith('/')) target += 'index.html';
    if (!target.endsWith('.html')) return match;
    const level = levelOf(target);
    if (LEVEL_RANK[level] > LEVEL_RANK[pageLevel] && !(isIndexPagePath(target) && LEVEL_RANK[level] <= LEVEL_RANK.team)) bodyLinkViolations.push(`  ${pagePath} (${pageLevel}) links to ${target} (${level})`);
    return mark ? `<a${before} href="${href}"${after} data-access="${level}">` : match;
  });
}

/**
 * The four levels a page can declare; a missing field is its section's
 * default (sectionAccess), else team. A PRESENT value outside the four fails
 * the build (isValidAccess, checked where the
 * layer is) rather than falling to team - a mistyped "admin" would otherwise
 * open a page to the team with no error. The twin of normaliseLevel in
 * worker/auth-schema.mjs: the generator ships to consumers without a
 * worker/, so it cannot import it; scripts/verify-auth-gate.mjs reads the
 * frontmatter independently and counts the map against it.
 */
const ACCESS_LEVELS = ['public', 'team', 'admin', 'owner'];
function normaliseLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return ACCESS_LEVELS.includes(level) ? level : 'team';
}
function isValidAccess(value) {
  return value === undefined || value === null || value === '' || ACCESS_LEVELS.includes(String(value).trim().toLowerCase());
}

/**
 * The level a page in `folder` takes when its own frontmatter says nothing
 * (D18), or undefined for none. An unknown value in docs.config.js fails the
 * build at startup (validateSectionAccess), so this never invents a level.
 */
function sectionLevel(folder) {
  const map = CONFIG.sectionAccess;
  return folder && Object.prototype.hasOwnProperty.call(map, folder) ? map[folder] : undefined;
}

/**
 * A section index's level: its section's default, else team. An index used
 * to be team whatever its section said, so an admin or owner section's
 * contents page went into the search index with every card's title and
 * description on it, and a team reader found them by searching. Every place
 * that names the index reads this: the page map, the page's own data-access
 * (which decides search), the sidebar's Overview link and the link levels.
 */
function indexLevel(folder) {
  const level = sectionLevel(folder);
  // Never below team: a public section's index stays behind the sign-in, as
  // it always was, since it lists that section's team and admin pages too.
  let base = level && LEVEL_RANK[level] > LEVEL_RANK.team ? level : 'team';
  // D27: a page override on the index, or a section floor, raises it; still
  // never below team (validateLevelSet enforces the same).
  const over = overlayLevel(`/${folder}/index.html`, base);
  const eff = over === undefined ? base : over;
  return LEVEL_RANK[eff] < LEVEL_RANK.team ? 'team' : eff;
}

// Pages whose level came from a section default, listed at the end of a full
// build so a widening default is never silent (levels-groups-plan.md §5).
const levelsFromSection = [];

// The sidebar list each page carries under accessNav 'hidden', set once the
// sections are known and before any page is written. Empty under 'locked'.
let navSourceHtml = '';

/**
 * A page's own access value, or its section's default when it has none.
 * `label` names the page in the build's report of defaulted levels.
 */
function ownOrSectionAccess(ownAccess, folder, label) {
  let value;
  if (ownAccess !== undefined && ownAccess !== null && ownAccess !== '') {
    value = ownAccess;
  } else {
    const level = sectionLevel(folder);
    if (level !== undefined) levelsFromSection.push(`${label} -> ${level} (sectionAccess.${folder})`);
    value = level;
  }
  // D27: a Settings row raises or lowers the level the build bakes. Returns the
  // code value untouched when no row touches this target, so an untouched site
  // is byte-for-byte unchanged.
  const over = overlayLevel(label, value);
  return over === undefined ? value : over;
}

function validateSectionAccess() {
  const bad = Object.entries(CONFIG.sectionAccess).filter(([, level]) => !ACCESS_LEVELS.includes(level));
  if (bad.length) {
    console.error(`❌ sectionAccess in docs.config.js: ${bad.map(([f, l]) => `${f}: "${l}"`).join(', ')} (each must be one of: ${ACCESS_LEVELS.join(', ')})`);
    process.exit(1);
  }
}

/* ------ Level settings from Settings (levels-groups-plan.md D27) ------ */

// The settings a reader changed from Settings > People (one row per section or
// page), applied by the build so the sidebar, search, cards, the link-level
// check, hidden mode and page-access.mjs all use the FINAL level. The source is
// chosen once, logged, and never touches the network unless LEVELS_FROM_D1 is
// set in the build command:
//
//   LEVELS_FROM_D1=1  reads the live D1 table with `wrangler d1 execute` (the
//                     Workers Builds build command sets it; needs the db name
//                     in docs.config.js accessDb or the LEVELS_DB env var)
//   LEVELS_FILE=path  reads a JSON file, for tests and for a committed fallback
//   neither           no settings: every page builds at its code level
//
// The duplication of the level maths here (not an import of worker/levels-core)
// is deliberate: the generator ships to consumers without a worker/, the same
// reason normaliseLevel is duplicated. A protected target or an unknown/invalid
// row is warned and skipped, never a crash.
const LEVEL_DOOR_PAGES = new Set(['/auth/login.html', '/locked.html', '/support.html']);
function isProtectedLevelTarget(kind, target) {
  if (kind === 'section') return target === 'settings' || target === '';
  return LEVEL_DOOR_PAGES.has(target) || target === '/index.html' || target.startsWith('/settings/');
}
function levelFolderOf(pathname) {
  const m = /^\/([a-z0-9-]+)\/[^/]+$/.exec(pathname || '');
  return m ? m[1] : '';
}
function maxLevelName(a, b) {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

function loadLevelSettingsSource() {
  const pages = new Map();
  const sections = new Map();
  let raw = null;
  let origin = 'none';
  try {
    if (process.env.LEVELS_FROM_D1 === '1') {
      const db = process.env.LEVELS_DB || CONFIG.accessDb;
      if (!db) {
        console.error('❌ LEVELS_FROM_D1=1 but no database is named. Set accessDb in docs.config.js (or LEVELS_DB). The build stops so no applied level is dropped.');
        process.exit(1);
      } else {
        const out = execSync(`npx wrangler d1 execute ${db} --remote --json --command "SELECT kind, target, level FROM level_setting"`, { encoding: 'utf8' });
        raw = out;
        origin = `D1 (${db})`;
      }
    } else if (process.env.LEVELS_FILE) {
      raw = fs.readFileSync(path.resolve(ROOT, process.env.LEVELS_FILE), 'utf8');
      origin = `file (${process.env.LEVELS_FILE})`;
    } else if (CONFIG.levelsFallback) {
      const p = path.resolve(ROOT, CONFIG.levelsFallback);
      if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf8'); origin = `fallback (${CONFIG.levelsFallback})`; }
    }
  } catch (error) {
    // Fail closed. Building at code levels would silently drop every applied
    // level: a page raised in Settings would reopen and go back into search.
    // Stopping leaves the last good deploy live, at the levels it already has.
    console.error(`❌ Level settings: could not read ${origin === 'none' ? 'the level settings' : origin} — ${error.message}. The build stops so no applied level is dropped; the site stays at its current levels.`);
    process.exit(1);
  }
  if (raw === null) return { pages, sections, origin };
  const rows = parseLevelRows(raw);
  if (rows === null) {
    console.error(`❌ Level settings: ${origin} was not valid JSON. The build stops so no applied level is dropped; the site stays at its current levels.`);
    process.exit(1);
  }
  for (const row of rows) {
    if (!ACCESS_LEVELS.includes(row.level)) { console.warn(`⚠️  Level setting skipped (bad level ${JSON.stringify(row.level)}): ${row.kind} ${row.target}`); continue; }
    if (row.kind !== 'section' && row.kind !== 'page') { console.warn(`⚠️  Level setting skipped (bad kind): ${JSON.stringify(row.kind)}`); continue; }
    if (isProtectedLevelTarget(row.kind, row.target)) { console.warn(`⚠️  Level setting skipped (protected target): ${row.kind} ${row.target}`); continue; }
    (row.kind === 'section' ? sections : pages).set(row.target, row.level);
  }
  return { pages, sections, origin };
}

// Accepts either the wrangler `d1 execute --json` shape (an array whose first
// result has `.results`), or a plain array of rows, or an object
// { pages: {path: level}, sections: {folder: level} }.
function parseLevelRows(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (Array.isArray(data) && data.length && data[0] && Array.isArray(data[0].results)) data = data[0].results;
  if (Array.isArray(data)) return data.map((r) => ({ kind: r.kind, target: String(r.target || '').trim().toLowerCase(), level: r.level }));
  const rows = [];
  if (data && typeof data === 'object') {
    for (const [target, level] of Object.entries(data.pages || {})) rows.push({ kind: 'page', target: String(target).trim().toLowerCase(), level });
    for (const [target, level] of Object.entries(data.sections || {})) rows.push({ kind: 'section', target: String(target).trim().toLowerCase(), level });
  }
  return rows;
}

const LEVEL_SETTINGS = loadLevelSettingsSource();
// When the settings were read (unix seconds), written to page-access.mjs as
// LEVELS_READ_AT only when they came from D1, so a local build stays
// byte-for-byte stable. Settings compares it with the last build request.
const LEVELS_READ_AT = LEVEL_SETTINGS.origin.startsWith('D1') ? Math.floor(Date.now() / 1000) : 0;
// Each overlaid page's code level, filled by overlayLevel (D27).
const CODE_LEVELS = new Map();

/**
 * The build level for a target after the Settings overlay (D27), or undefined
 * when no setting touches it — so a site with no settings builds byte-for-byte
 * as before. Page setting beats section floor beats code; the floor only
 * raises. Protected targets are never overlaid.
 */
function overlayLevel(label, codeValue) {
  const pathname = String(label).startsWith('/') ? String(label) : '/' + label;
  // The level the code gives, before any Settings row: page-access.mjs carries
  // it as `code` where it differs, so the Worker can work out what an applied
  // but unbuilt change will bake (levels-core.mjs projectedLevel).
  CODE_LEVELS.set(pathname, normaliseLevel(codeValue));
  if (isProtectedLevelTarget('page', pathname)) return undefined;
  const folder = levelFolderOf(pathname);
  const hasPage = LEVEL_SETTINGS.pages.has(pathname);
  const floor = LEVEL_SETTINGS.sections.get(folder);
  if (!hasPage && !floor) return undefined;
  let base = hasPage ? LEVEL_SETTINGS.pages.get(pathname) : normaliseLevel(codeValue);
  if (floor) base = maxLevelName(base, floor);
  return base;
}

/** The effective build level for a path given its code level, applying any Settings row. */
function effectiveBuildLevel(pathname, codeLevel) {
  const over = overlayLevel(pathname, codeLevel);
  return over === undefined ? normaliseLevel(codeLevel) : over;
}

// The brand settings file (config: brandManifest; brand.js). Read, upgraded
// and validated once, here: a file that fails stops the build with every
// problem listed. ROOT_MANIFEST is its chrome view (name, fonts, favicons,
// OG image); BRAND is the whole file, for the runtime files and the checks.
// docs.config.js keys are the fallback for projects without one.
const ROOT_MANIFEST_PATH = CONFIG.brandManifest ? path.resolve(ROOT, CONFIG.brandManifest) : null;
// Project icons (config: iconsDir), falling back to the chrome icons bundled
// with the shipped docs-kit. Without either, pages build but icon slots warn.
// Set before the brand file loads: its icons.close must name one of these.
const ICONS_DIR = CONFIG.iconsDir
  ? path.resolve(ROOT, CONFIG.iconsDir)
  : path.join(KIT_ASSETS, 'icons');
// The version brand.json is written at, before any upgrade in memory: what
// /os.json reports as `brand`, so an old file shows on the fleet dashboard.
let BRAND_FILE_VERSION = null;
const BRAND = ROOT_MANIFEST_PATH ? loadSiteBrand(ROOT_MANIFEST_PATH) : null;
const ROOT_MANIFEST = BRAND ? brandFile.chromeManifest(BRAND) : null;
// The spelling of the engine's own words (brand.json wording.locale,
// locale.js): en-GB, as the engine is written, unless the brand says
// otherwise. Only engine-owned sources convert (isEngineSource); the site's
// own pages never do.
const LOCALE = BRAND ? brandFile.wording(BRAND).locale : locale.LOCALES[0];
const CONVERT_LOCALE = LOCALE !== locale.LOCALES[0];
// The runtime half, for the tool scripts' L() helpers: written, and loaded
// first on every page, only when the engine's words convert
const LOCALE_SCRIPT = 'assets/js/bd-locale.js';
// A site's own copy of an engine page is its own words, kept as written
const LOCALE_NOTE = CONVERT_LOCALE ? ` (not converted to ${LOCALE})` : '';
// Every page's <html lang>: the locale once it is set, plain "en" as before
const HTML_LANG = CONVERT_LOCALE ? LOCALE : 'en';

function loadSiteBrand(file) {
  const tokens = brandFile.definedTokens([
    path.resolve(ROOT, CONFIG.designSystemPath),
    CONFIG.brandCssPath && !/^(https?:)?\/\//.test(CONFIG.brandCssPath) && !CONFIG.brandCssPath.startsWith('/')
      ? path.resolve(ROOT, CONFIG.brandCssPath) : null,
  ]);
  try {
    const { brand, from } = brandFile.loadBrand(file, { root: ROOT, tokens, icons: brandFile.iconSet(ICONS_DIR, ROOT) });
    BRAND_FILE_VERSION = from;
    if (from < brandFile.BRAND_VERSION) {
      console.warn(`⚠️  ${path.relative(ROOT, file)} is version ${from}. Run npx bd-brand upgrade to rewrite it as version ${brandFile.BRAND_VERSION}.`);
    }
    return brand;
  } catch (err) {
    if (err.name !== 'BrandError') throw err;
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

/** The close icon the page bar and the feedback dialog draw (brand.json icons.close). */
function closeIconHtml() {
  return getIcon(brandFile.closeIcon(BRAND));
}

/**
 * {{close-icon}}: the brand's close icon, where an HTML source draws the
 * page's close (a tool bar's bar-close, the feedback dialog's close). Not
 * {{icon:close-large}}, which stays that icon whatever the brand sets.
 */
function expandCloseIcon(html) {
  return html.replace(/\{\{close-icon\}\}/g, () => closeIconHtml());
}

// The apps: every one the package ships and the site writes, and the ones
// this site installs. Read once; a bad install list stops the build here.
const APP_REGISTRY = appsRegistry.loadApps({ generatorDir: __dirname, siteAppsDir: path.join(DOCS_DIR, 'apps'), parseFrontmatter });
const INSTALL = appsRegistry.resolveInstall(APP_REGISTRY, CONFIG.install, {
  engineHome: !!BRAND && BRAND.slug === brandFile.ENGINE_HOME_SLUG,
  accessGate: CONFIG.accessGate,
  allowDraft: !!(CONFIG.install && CONFIG.install.allowDraft),
});
if (INSTALL.errors.length) {
  console.error(`\n❌ The apps this site installs can't be resolved:\n${INSTALL.errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}
if (!INSTALL.legacy) {
  // The Asset Library's build data and download map follow its install
  CONFIG.assetLibrary = INSTALL.installed.includes('asset-library');
  for (const slug of INSTALL.installed) {
    const overrides = APP_REGISTRY.apps.get(slug).overrides;
    if (overrides.length) console.log(`ℹ️  ${slug}: this site's own ${overrides.join(' and ')} replace${overrides.length === 1 ? 's' : ''} the package's${LOCALE_NOTE}.`);
  }
}

// The access gate's door pages and scripts come from the package by the
// install list (phase D): a legacy site, with no `install`, would build a
// gate with no sign-in page, and every reader, the owner too, would be
// locked out
if (CONFIG.accessGate && INSTALL.legacy) {
  console.error('\n❌ accessGate is on, but docs.config.js has no `install`, so the engine\'s sign-in, Ask for access and locked pages and their scripts aren\'t installed. Add `install: { packages: [...] }` (see the docs-kit README, "Apps").\n');
  process.exit(1);
}
// The gate answers at the site root: its addresses (engine-paths.mjs), its
// public lists and the sign-out link know no basePath, so a gated site under
// one would lock its own door pages away
if (CONFIG.accessGate && CONFIG.basePath) {
  console.error(`\n❌ accessGate is on with basePath "${CONFIG.basePath}". The access gate serves a site from its root: its sign-in, sign-out and public addresses have no prefix. Remove basePath, or serve the site from its own host.\n`);
  process.exit(1);
}

// The ask for access settings (phase D): one place, the engine's /support.html
if (BRAND && BRAND.access && Object.prototype.hasOwnProperty.call(BRAND.access, 'requestRoute')) {
  console.warn(`⚠️  brand.json's access.requestRoute is no longer read: Ask for access is ${appsRegistry.ENGINE_PATHS.support} on every site. Delete it.`);
}
if (CONFIG.accessGate && !INSTALL.legacy && BRAND && !(BRAND.access && BRAND.access.turnstileSiteKey)) {
  console.warn('⚠️  brand.json has no access.turnstileSiteKey, so Ask for access works only for a signed-in reader: the form service refuses a signed-out request that has no spam check.');
}

// Each installed app's guide: the site's own file, else the package's (PB-3)
const GUIDES = appsRegistry.resolveGuides(APP_REGISTRY, INSTALL, DOCS_DIR);
// The engine's pages (apps.js ENGINE_PAGES) build at the same address on
// every site (engine-paths.mjs): the not-installed and locked pages with
// site-absolute links, because the Worker serves them at other pages'
// addresses; the search page only where search is on; the sign-in, Ask for
// access and locked pages only where the access gate is on. None joins a
// section: no nav group, no card, no pager chain.
if (!CONFIG.search) GUIDES.sources.delete('search.md');
const ENGINE_PAGE_FILES = new Set();
for (const [page, address] of Object.entries(appsRegistry.ENGINE_PAGES)) {
  if (address.gate && !CONFIG.accessGate) continue;
  if (GUIDES.sources.has(page) || (!INSTALL.legacy && fs.existsSync(path.join(DOCS_DIR, page)))) {
    // Pinned: the Worker, the scripts and the emails link these addresses
    const own = CONFIG.filenameOverrides[page];
    if (own && (own.folder !== address.folder || own.name !== address.name)) {
      console.warn(`⚠️  filenameOverrides moves ${page}; the engine links it at /${address.folder ? `${address.folder}/` : ''}${address.name}, so it stays there.`);
    }
    const { gate, ...pinned } = address;
    CONFIG.filenameOverrides[page] = { ...(own || {}), ...pinned };
    ENGINE_PAGE_FILES.add(page);
  }
}
if (GUIDES.errors.length) {
  console.error(`\n❌ The app guides can't be resolved:\n${GUIDES.errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}
for (const guide of GUIDES.overridden) console.log(`ℹ️  ${guide}: this site's own guide replaces the package's${LOCALE_NOTE}.`);

// The pages of sections this site doesn't install, to the section's name (D14)
const OFF_SECTION_PAGES = new Map();

/** Where a cms page's source is: the site's cms/, or a guide the package ships. */
function docSource(filename) {
  return GUIDES.sources.get(filename) || path.join(DOCS_DIR, filename);
}

/**
 * Whether a page source is the engine's own words: a file outside this
 * site's cms/ (a guide or an app the package ships). The site's own pages,
 * and its own copies of the engine's, are never converted to its locale.
 * On the engine's own repo every source is in cms/, so nothing is.
 */
function isEngineSource(file) {
  const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
  const rel = path.relative(real(DOCS_DIR), real(file));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

// Headings by page source, for a page whose headings the locale changed:
// every heading in order, [converted text, original text] (locale.markdown)
const PAGE_HEADING_IDS = new Map();

/**
 * A page source as the build reads it: the file as written, or, for an
 * engine source on a site whose locale isn't en-GB, with the engine's words
 * converted (locale.js). Converted before any {{...}} expands, so a value
 * the site fills ({{brand:organisation}}) is never touched. Every page
 * source is read through here, so a title reads the same in the page, the
 * sidebar, the cards and the not-installed page.
 */
function readPageSource(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (!CONVERT_LOCALE || !isEngineSource(file)) return source;
  const { content, headingIds } = locale.page(source, file.endsWith('.html') ? 'html' : 'markdown');
  if (headingIds.some(([now, was]) => now !== was)) PAGE_HEADING_IDS.set(path.resolve(file), headingIds);
  return content;
}

/** The heading ids a converted page source keeps (readPageSource), or null. */
function pageHeadingIds(file) {
  return PAGE_HEADING_IDS.get(path.resolve(file)) || null;
}

/** Copy the generator writes into a page, in the site's locale. */
function engineWords(text) {
  return CONVERT_LOCALE ? locale.text(text) : text;
}

/** Every page source in cms/, plus the package's guides, less uninstalled apps' guides. */
function docFilenames() {
  const names = fs.readdirSync(DOCS_DIR).filter((file) => file.endsWith('.md') && !GUIDES.skip.has(file)
    && fs.statSync(path.join(DOCS_DIR, file)).isFile());
  for (const guide of GUIDES.sources.keys()) if (!names.includes(guide)) names.push(guide);
  return names.sort();
}

/**
 * The values {{brand:key}} fills: the brand's, or, on a site with no
 * brand.json, its name from docs.config.js for the keys that only name it.
 */
function siteTokens() {
  if (BRAND) return brandFile.brandTokens(BRAND);
  // The engine's Ask for access page reads the last two; empty means none
  const tokens = { name: CONFIG.siteName, siteName: CONFIG.siteName, organisation: CONFIG.siteName, supportEmail: '', turnstileSiteKey: '' };
  if (CONFIG.siteUrl) tokens.url = CONFIG.siteUrl;
  return tokens;
}

/**
 * A brand value as text in markdown: never markup, since marked runs with
 * sanitize off. brand.js refuses <, > and " in these fields already, so for a
 * valid brand this changes nothing; it holds for a site with no brand.json,
 * and for a check that ever misses one. & is left alone, so a valid value in
 * a code span still reads as written.
 */
function escapeBrandText(value) {
  return String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A markdown page's {{brand:key}} tokens, filled from siteTokens(), each
 * escaped (escapeBrandText unless the caller passes its own). An unknown key
 * stops the build, naming the page; `\{{brand:key}}` stays as written,
 * without the backslash.
 */
function expandBrandTokens(markdown, source, escape = escapeBrandText) {
  if (!markdown.includes('{{brand:')) return markdown;
  const tokens = siteTokens();
  return markdown.replace(/(\\?)\{\{brand:([a-zA-Z]+)\}\}/g, (match, escaped, key) => {
    if (escaped) return match.slice(1);
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) {
      console.error(`\n❌ ${source}: {{brand:${key}}} isn't a brand token (known: ${Object.keys(tokens).join(', ')}).\n`);
      process.exit(1);
    }
    return escape(tokens[key]);
  });
}

/** An installed app's source files, or null. */
function installedApp(slug) {
  if (!INSTALL.installed.includes(slug)) return null;
  return APP_REGISTRY.apps.get(slug) || null;
}

const SITE = {
  name: (ROOT_MANIFEST && (ROOT_MANIFEST.siteName || ROOT_MANIFEST.name)) || CONFIG.siteName,
  description: (ROOT_MANIFEST && ROOT_MANIFEST.description) || CONFIG.indexDescription,
  footerText: (ROOT_MANIFEST && ROOT_MANIFEST.footerText) || CONFIG.footerText,
};

/**
 * The site's name and description as markup: escaped once, here, for every
 * place they land (each page's <title> and og:title, the header logo, the
 * home page's meta description and subtitle). They come from brand.json,
 * which a settings pull request can change (engine-parity-d18.md, review
 * finding 1), so never as raw HTML. The footer is escaped in buildPageChrome.
 */
function siteTextHtml(site) {
  return { name: escapeAttr(String(site.name || '')), description: escapeAttr(String(site.description || '')) };
}
const SITE_HTML = siteTextHtml(SITE);

// Root a site-absolute href under basePath. The default '' keeps output
// byte-identical to a build without the option; external (http, //) and
// relative hrefs pass through untouched. Applied exactly once, at each
// output boundary — never on the internal page model.
function siteHref(href) {
  return href && href.startsWith('/') && !href.startsWith('//') ? CONFIG.basePath + href : href;
}

// Prefix a page-relative base onto a path unless it is already absolute
// (site-absolute paths resolve under basePath instead)
function prefixHref(base, p) {
  if (/^(https?:)?\/\//.test(p)) return p;
  return p.startsWith('/') ? siteHref(p) : base + p;
}

// Brand CSS <link> for a page at the given base ('' for root pages).
// prefixHref keeps relative paths depth-correct and roots site-absolute
// ones under basePath, so every page depth emits the same working href.
function brandCssLink(base) {
  return PROJECT_CONFIG.brandCssPath
    ? `<link rel="stylesheet" href="${prefixHref(base, PROJECT_CONFIG.brandCssPath)}">`
    : '';
}

// Per-brand font sources, emitted into the {{FONT_HEAD}} slot: Typekit kit,
// self-hosted preloads, Google Fonts. All come from the brand manifest
// (typekitId, fontPreload[], googleFontsUrl); a missing field emits nothing.
// fontPreload paths are site-relative and get the page's nav base prefixed.
// Falls back to docs.config.js googleFontsUrl for template instantiations
// without a root manifest. @font-face declarations for self-hosted files
// live in the brand's own theme.css, not here.
const FONT_PRELOAD_TYPES = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
function fontHeadHtml(manifest, navBase) {
  const m = manifest || { googleFontsUrl: PROJECT_CONFIG.googleFontsUrl };
  const lines = [];
  if (m.typekitId) {
    lines.push(`<link rel="stylesheet" href="https://use.typekit.net/${m.typekitId}.css">`);
  }
  for (const fontPath of m.fontPreload || []) {
    const ext = fontPath.split('.').pop().toLowerCase();
    const type = FONT_PRELOAD_TYPES[ext] ? ` type="${FONT_PRELOAD_TYPES[ext]}"` : '';
    lines.push(`<link rel="preload" href="${navBase}${fontPath}" as="font"${type} crossorigin>`);
  }
  if (m.googleFontsUrl) {
    lines.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
    lines.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    lines.push(`<link href="${m.googleFontsUrl}" rel="stylesheet">`);
  }
  if (!lines.length) return '';
  return '<!-- Brand fonts (from brand.json) -->\n    ' + lines.join('\n    ');
}

//------- Icon Map -------//

// ICONS_DIR is set beside the brand file's loading, which checks its close
// icon against the folder.
let ICON_MAP = {};

// Numbers as SVG path data actually writes them: optional sign, optional
// leading dot (".5"), optional exponent ("-1.52588e-05"). A naive \d+(\.\d+)?
// splits both of those into garbage.
const PATH_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Reduce an icon to its drawing: the sequence of path commands plus the
 * coordinates they use. Attributes, formatting and element order around the
 * paths are ignored — only the shape matters.
 * @param {string} svg - raw SVG source
 * @returns {{commands: string, coords: number[]}|null} null if it draws no paths
 */
function readGeometry(svg) {
  const d = (svg.match(/\sd="[^"]*"/g) || []).join('');
  if (!d) return null;
  return {
    commands: (d.match(/[A-Za-z]/g) || []).join(''),
    coords: (d.match(PATH_NUMBER) || []).map(Number),
  };
}

/**
 * Two names for the same drawing is the failure that reaches designers: they
 * look an icon up, find two entries, and have no basis to choose. Matching
 * filenames were always caught; matching artwork was not, which is how a
 * re-export saved under a new name becomes the registry's second copy.
 *
 * Compared numerically rather than as a string hash, so a re-export rounded to
 * fewer decimal places still matches its full-precision original — string
 * comparison of rounded coordinates misses those whenever a value sits near a
 * rounding boundary, which most icons have somewhere.
 * @param {Array<{key: string, geometry: object}>} shapes
 */
function warnDuplicateGeometry(shapes) {
  const TOLERANCE = 0.05; // sub-pixel at any size the wrapper renders
  const pairs = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i].geometry;
      const b = shapes[j].geometry;
      if (a.commands !== b.commands || a.coords.length !== b.coords.length) continue;
      if (a.coords.every((n, k) => Math.abs(n - b.coords[k]) <= TOLERANCE)) {
        pairs.push(`${shapes[i].key}=${shapes[j].key}`);
      }
    }
  }
  // One line, not one per pair — a warning repeated eleven times is a warning
  // nobody reads, and the twelfth is the one that matters.
  if (pairs.length) {
    console.warn(`⚠️  ${pairs.length} icon(s) duplicate another's artwork under a second name: ${pairs.join(', ')}`);
  }
}

/**
 * Scan the icons dir and build icon-name → normalised SVG string map.
 * Called once at the start of generateDocs().
 */
function buildIconMap() {
  if (!fs.existsSync(ICONS_DIR)) {
    console.warn(`⚠️  Icons directory not found: ${ICONS_DIR} — icon placeholders will render as comments`);
    ICON_MAP = {};
    return;
  }
  // Underscore-prefixed files are drafts — the sprite builder skips them too
  const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg') && !f.startsWith('_'));
  const aliases = readIconAliases({ rootDir: ROOT, iconsDir: ICONS_DIR, surface: 'the icon registry' });
  const map = {};
  const seen = {};
  const shapes = [];

  for (const file of files) {
    const key = file.replace(/\.svg$/i, '').toLowerCase().replace(/\s+/g, '-');
    if (aliases.has(key)) continue; // deprecated name — ships in the sprite, hidden from the docs

    // The {{icon:...}} shorthand and warnBrandRegistryGaps only match
    // [a-z0-9-] keys — a filename outside that charset would publish as
    // literal placeholder text, so flag it at build time
    if (!/^[a-z0-9-]+$/.test(key)) {
      console.warn(`⚠️  Icon "${file}" produces key "${key}" — not referenceable by {{icon:...}}; rename to lowercase kebab-case`);
    }

    // Handle duplicates — prefer capitalised filename, warn on collision
    if (seen[key]) {
      console.warn(`⚠️  Duplicate icon key "${key}" — "${file}" collides with "${seen[key]}". Keeping first.`);
      continue;
    }
    seen[key] = file;

    let svg = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8')
      .replace(/\n\s*/g, '') // collapse to single line
      .trim();

    // The file's own markup, kept for the icon manifest: the Icon Library tool
    // feeds it through the SVG Cleaner engine's icon mode, which adds data-icon
    // itself — handing it the normalised form below would double the attribute.
    const raw = svg;

    const geometry = readGeometry(svg);
    if (geometry) shapes.push({ key: key, geometry: geometry });

    // Normalise: replace fixed width/height with 100%
    svg = svg.replace(/(<svg[^>]*)\s+width=["']\d+["']/i, '$1 width="100%"');
    svg = svg.replace(/(<svg[^>]*)\s+height=["']\d+["']/i, '$1 height="100%"');

    // Add aria-hidden if not present
    if (!svg.includes('aria-hidden')) {
      svg = svg.replace(/<svg/, '<svg aria-hidden="true"');
    }

    // Add data-icon on the <svg> element for CSS targeting
    svg = svg.replace(/<svg/, `<svg data-icon="${key}"`);

    map[key] = { svg: svg, file: file, raw: raw };
  }

  ICON_MAP = map;
  warnDuplicateGeometry(shapes);
  console.log(`🎨 Icon map built: ${Object.keys(map).length} icons`);
}

/**
 * Return icon wrapped in the standard .svg-icn container.
 *
 * The wrapper carries data-icon as well as the <svg> inside it: the wrapper
 * is the documented hook (cms/iconography.md, `<span class="svg-icn"
 * data-icon="name">`) and component CSS keys on it — the password toggle's
 * eye swap reads `.svg-icn[data-icon="eye"]`, and without the attribute here
 * every generated page showed both eyes. The <svg> keeps its own copy for
 * docs-copy-chrome.js, which reads `.svg-icn svg[data-icon]`.
 * @param {string} name - kebab-case icon key
 * @returns {string} HTML string
 */
function getIcon(name) {
  const entry = ICON_MAP[name];
  if (!entry) {
    console.warn(`⚠️  Unknown icon: "${name}"`);
    return `<!-- unknown icon: ${name} -->`;
  }
  return `<span class="svg-icn" data-icon="${name}">${entry.svg}</span>`;
}

/**
 * Return raw SVG string (no wrapper). For contexts that build their own wrapper,
 * such as nav.js where icons have additional classes.
 * @param {string} name - kebab-case icon key
 * @returns {string} SVG string
 */
function getRawIcon(name) {
  const entry = ICON_MAP[name];
  if (!entry) {
    console.warn(`⚠️  Unknown icon (raw): "${name}"`);
    return `<!-- unknown icon: ${name} -->`;
  }
  return entry.svg;
}

/**
 * The lock a row shows when nav.js locks it for this reader. Only the access
 * gate locks anything, so without it there is no lock to draw and the
 * project's icon set need not hold one.
 */
function lockIcon(className) {
  if (!CONFIG.accessGate) return '';
  return `<span class="svg-icn ${className}" data-icon="lock" aria-hidden="true">${getRawIcon('lock')}</span>`;
}

//------- OS illustrations -------//

// A drawing the generator inlines on a book cover's media slot or a page
// header's illustration slot, coloured by the colour scope (design-system.css
// §2d layer 5, §37, §43, §55). The import (npm run os-illustration:import)
// writes the file; this only reads it. Spec: os-illustration-plan.md, until
// cms/os-illustration.md is written.
//
// Unlike an icon, a missing drawing fails the build: a cover or header that
// declared art and shipped without it is a broken page, not a blank slot.
const OS_ILLUSTRATIONS_DIR = path.join(ROOT, 'assets', 'images', 'os-illustrations');
// The nine hues §2d puts in scope. A hue outside this list would render the
// field in no colour at all, silently.
const OS_ILLUSTRATION_HUES = ['blue', 'purple', 'green', 'yellow', 'red', 'aqua', 'pink', 'peach', 'brown'];
// `light` is the default and is never written (§2d: omit data-field for it).
const OS_ILLUSTRATION_FIELDS = ['lighter', 'dark'];
const osIllustrationCache = new Map();

/**
 * Read one drawing once per build.
 * @param {string} slug - the file's basename in assets/images/os-illustrations/
 * @param {string} page - what declared it, for the error
 * @returns {{ svg: string, hue: string, motion: boolean }} the markup, the
 *   authored hue (data-os-illustration-hue, written by the import on an exact
 *   ramp match) and whether the drawing animates (data-motion)
 */
function getOsIllustration(slug, page) {
  if (!osIllustrationCache.has(slug)) {
    const file = path.join(OS_ILLUSTRATIONS_DIR, `${slug}.svg`);
    if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) {
      throw new Error(`${page}: os-illustration "${slug}" has no file at assets/images/os-illustrations/${slug}.svg`);
    }
    const svg = fs.readFileSync(file, 'utf8').trim();
    const hue = svg.match(/\sdata-os-illustration-hue="([a-z]+)"/);
    const motion = /<svg[^>]*\sdata-motion[\s>]/.test(svg);
    osIllustrationCache.set(slug, { svg, hue: hue ? hue[1] : '', motion });
  }
  return osIllustrationCache.get(slug);
}

function hasOsIllustration(slug) {
  return /^[a-z0-9-]+$/.test(slug) && fs.existsSync(path.join(OS_ILLUSTRATIONS_DIR, `${slug}.svg`));
}

/**
 * Resolve what a card or page declares into what the emitters write.
 * The hue is the declared one, else the drawing's authored one, else the
 * fallback (a page's section hue); a drawing with none of them has nothing
 * to colour it, so that fails.
 * @param {object} declared
 * @param {string} [declared.osIllustration] - drawing slug
 * @param {string} [declared.hue] - overrides the authored hue
 * @param {string} [declared.field] - `lighter` or `dark`; omit for light
 * @param {string} [declared.fallbackHue] - used when neither of the above is set
 * @param {string} page - what declared it, for the error
 * @returns {{ svg: string, color: string, field: string, motion: boolean } | null}
 */
function resolveOsIllustration({ osIllustration, hue, field, fallbackHue } = {}, page) {
  if (!osIllustration) return null;
  const art = getOsIllustration(osIllustration, page);
  const color = hue || art.hue || fallbackHue;
  if (!color) {
    throw new Error(`${page}: os-illustration "${osIllustration}" carries no authored hue, so it needs a hue`);
  }
  if (!OS_ILLUSTRATION_HUES.includes(color)) {
    throw new Error(`${page}: hue "${color}" is not in the colour scope (${OS_ILLUSTRATION_HUES.join(', ')})`);
  }
  if (field && !OS_ILLUSTRATION_FIELDS.includes(field)) {
    throw new Error(`${page}: field "${field}" is not ${OS_ILLUSTRATION_FIELDS.join(' or ')} (omit it for light)`);
  }
  return { svg: art.svg, color, field: field || '', motion: art.motion };
}

/**
 * The pause button beside an animated header drawing: the WCAG 2.2.2
 * mechanism that lets a header loop past five seconds. aria-pressed is the
 * paused state (os-illustration.js keeps it for the session); the two icons
 * swap on it, the password-toggle pattern. Only an animated drawing gets one.
 */
function renderOsIllustrationPause(illustration) {
  if (!illustration.motion) return '';
  return `<button class="button" type="button" data-variant="transparent" data-icon-only data-size="small" aria-pressed="false" aria-label="Pause the illustration" data-os-illustration-pause>${getIcon('pause')}${getIcon('play')}</button>`;
}

// data-color and data-field go on the same element: §2d reads the field only
// where the hue is set.
function osIllustrationAttrs(illustration) {
  return ` data-color="${illustration.color}"` + (illustration.field ? ` data-field="${illustration.field}"` : '');
}

// The home card whose href is a section's index, so the section's contents
// page can take the card's art for its header.
function homeCardForSection(sectionFolder) {
  return (CONFIG.indexCards || []).find(card => card.href === `/${sectionFolder}/`) || null;
}

// What a doc page's header draws. Figma's Covers page names every frame
// after the page it covers, so a page takes the drawing with its own slug
// when one exists, and a tool's docs page (`<tool>-docs`) shares the tool's.
// Frontmatter overrides it: `os-illustration: <slug>` for another drawing,
// `os-illustration: none` for no art, `hue:` and `field:` as on a home card.
// With no hue declared or authored, the page's section hue colours it, so a
// Figma colour that is not a code ramp step still renders in the section's
// hue rather than failing the build.
function pageOsIllustration(frontmatter, file) {
  const declared = frontmatter['os-illustration'];
  if (declared === 'none') return {};
  // Keyed on the source name, which is what the Figma frames are named after:
  // formats-email-signature.md is formats/email-signature.html, and only
  // the source name tells it apart from the Email Signature tool.
  const implied = file.filename.replace(/\.md$/, '').replace(/-docs$/, '');
  const slug = declared || (hasOsIllustration(implied) ? implied : '');
  if (!slug) return {};
  const card = homeCardForSection(SECTION_FOLDERS[frontmatter.section] || '');
  return {
    osIllustration: slug,
    hue: frontmatter.hue,
    field: frontmatter.field,
    fallbackHue: card ? card.hue : '',
  };
}

/**
 * Render the full icon registry as a markdown table, one row per ICON_MAP
 * entry, sorted alphabetically. Expanded from the {{icon-registry}}
 * placeholder before markdown conversion, so the table flows through the
 * same table/icon pipeline as hand-written registry tables.
 */
function renderIconRegistry() {
  const names = Object.keys(ICON_MAP).sort();
  if (names.length === 0) {
    console.warn('⚠️  {{icon-registry}}: icon map is empty — no icons found in assets/images/svg-icons/');
  }
  const rows = names.map(name => `| {{icon:${name}}} | \`${name}\` |`);
  return ['| Icon | data-icon |', '|---|---|', ...rows].join('\n');
}

/**
 * The Brand Book icon page claims to show every icon in the set. Its tables
 * are hand-curated into categories, so they can silently fall behind the
 * source directory — warn on every build when they do.
 */
function warnBrandRegistryGaps() {
  const brandRegistryFile = path.join(DOCS_DIR, 'brand-iconography.md');
  if (!fs.existsSync(brandRegistryFile)) return;
  const source = fs.readFileSync(brandRegistryFile, 'utf8');
  const listed = new Set([...source.matchAll(/\{\{icon:([a-z0-9-]+)\}\}/g)].map(m => m[1]));
  const missing = Object.keys(ICON_MAP).filter(name => !listed.has(name)).sort();
  if (missing.length) {
    console.warn(`⚠️  ${missing.length} icon(s) not listed in cms/brand-iconography.md: ${missing.join(', ')}`);
  }
}

//------- Icon Manifest -------//

/**
 * The Brand Book icon page is the only place the set is grouped and named:
 * one `## Category` heading over each table, whose rows read
 * `| {{icon:key}} | Display Name | \`key\` |`. Read that structure once so
 * the Icon Library tool filters by the categories the brand book shows,
 * rather than carrying a second list that drifts from it.
 * @returns {{order: string[], byKey: Object<string, {name: string, category: string}>}}
 */
function parseIconCategories() {
  const result = { order: [], byKey: {} };
  const brandRegistryFile = path.join(DOCS_DIR, 'brand-iconography.md');
  if (!fs.existsSync(brandRegistryFile)) {
    console.warn('cms/brand-iconography.md not found — every icon in the manifest falls under "Other"');
    return result;
  }

  // The body only: a frontmatter line starting "## " must not register a
  // category.
  const body = parseFrontmatter(fs.readFileSync(brandRegistryFile, 'utf8')).content;
  let category = null;
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1];
      if (!result.order.includes(category)) result.order.push(category);
      continue;
    }
    const row = line.match(/^\|\s*\{\{icon:([a-z0-9-]+)\}\}\s*\|\s*([^|]*?)\s*\|/);
    if (!row || !category) continue;
    const key = row[1];
    const existing = result.byKey[key];
    if (existing) {
      console.warn(`Icon "${key}" is listed twice in cms/brand-iconography.md (${existing.category}, ${category}) — the manifest keeps ${existing.category}`);
      continue;
    }
    result.byKey[key] = { name: row[2].trim() || titleFromKey(key), category: category };
  }
  return result;
}

/**
 * Figma exports carry internal ids ("clip0_14540_880") referenced by
 * url(#id) and href="#id". Inlined 175 times on one page they collide, and a
 * browser resolves url(#id) to the FIRST match document-wide, so later icons
 * pick up the wrong clip. Prefix every id and its references with the icon
 * key. The same three rewrites as scripts/build-icon-sprite.js, which cannot
 * be required from here — it is a CLI that runs on load.
 * @param {string} svg
 * @param {string} prefix
 * @returns {string}
 */
function namespaceIds(svg, prefix) {
  const ids = new Set();
  const idRe = /\sid="([^"]+)"/g;
  let match;
  while ((match = idRe.exec(svg))) ids.add(match[1]);
  let out = svg;
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ns = `${prefix}-${id}`;
    // Function replacers: a string replacement would read a "$&" or "$1"
    // inside an id as a substitution pattern.
    out = out
      .replace(new RegExp(`id="${safe}"`, 'g'), () => `id="${ns}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), () => `url(#${ns})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), () => `href="#${ns}"`);
  }
  return out;
}

/**
 * "arrow-up-right" → "Arrow Up Right", for icons the brand book has not
 * named yet.
 * @param {string} key
 * @returns {string}
 */
function titleFromKey(key) {
  return key.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * The Icon Library tool's data, inlined on that page alone as a JSON block.
 * Not a global script on purpose: the set is over 100 KB, and every entry in
 * extraScripts ships on all ~125 pages. Expanded from {{icon-manifest}} in a
 * tool body — an HTML body is the only place it resolves.
 *
 * The trade-off: _headers serves *.html with max-age=0, must-revalidate, so
 * the block re-transfers on every deploy (about 36 KB brotli), where a
 * fetched file under assets/ would sit in the hour cache. One page, static
 * data, no async render or Barba re-entry race — inline is still the simpler
 * correct answer.
 *
 * `raw` is the file's own markup (collapsed, ids namespaced), named as it
 * is in ICON_MAP and deliberately not the normalised {{icon:}} form; see the
 * note in buildIconMap. The tool re-derives the display form (100% sizing) in
 * one pass at render, which is cheaper than shipping both forms twice over.
 * @returns {string} HTML string
 */
function renderIconManifest() {
  const keys = Object.keys(ICON_MAP).sort();
  if (keys.length === 0) {
    console.warn('{{icon-manifest}}: icon map is empty — no icons found in assets/images/svg-icons/');
  }
  const categories = parseIconCategories();
  const OTHER = 'Other';
  const unlisted = [];
  const icons = keys.map(key => {
    const meta = categories.byKey[key];
    if (!meta) unlisted.push(key);
    return {
      key: key,
      name: meta ? meta.name : titleFromKey(key),
      category: meta ? meta.category : OTHER,
      raw: namespaceIds(ICON_MAP[key].raw, key),
    };
  });
  // warnBrandRegistryGaps matches {{icon:}} anywhere in the brand book; this
  // parser only reads table rows under a heading, so an icon can pass that
  // check and still land here. Name the ones that did.
  if (unlisted.length && categories.order.length) {
    console.warn(`${unlisted.length} icon(s) have no category row in cms/brand-iconography.md and fall under "Other": ${unlisted.join(', ')}`);
  }
  const used = new Set(icons.map(icon => icon.category));
  const order = categories.order.filter(name => used.has(name));
  if (used.has(OTHER) && !order.includes(OTHER)) order.push(OTHER);

  // \u003c keeps "</script>" and "<!--" out of the block whatever the markup holds
  // The brand names the export files (icon_<brand>_<key>_...), so a second
  // instance's arrow-up never collides with this one's in a downloads folder.
  const brandKey = BRAND ? BRAND.slug : null;
  const manifest = Object.assign(brandKey ? { brand: brandKey } : {}, { categories: order, icons: icons });
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c');
  console.log(`Icon manifest: ${icons.length} icons in ${order.length} categories, ${Math.round(json.length / 1024)} KB`);
  return `<script type="application/json" id="icon-manifest">${json}</script>`;
}

/**
 * The Asset Library's catalog and lock, read once per build and validated
 * together. Both emitters below need the same pair, and the validation prints
 * its warnings once. Errors fail the build the way an invalid `layer:` does:
 * the tool page and the Worker's index are generated from this data, and a
 * catalog naming a file the bucket does not hold would ship a Download that
 * 404s. No catalog at all is not an error — the engine ships without one and
 * the tool renders its empty state.
 */
let libraryData = null;
function loadValidatedLibrary() {
  if (libraryData) return libraryData;
  const { catalog, lock } = assetLibrary.loadLibrary(ROOT);
  if (catalog) {
    const result = assetLibrary.validateCatalog(catalog, lock, { rootDir: ROOT });
    for (const warning of result.warnings) console.warn(`asset library: ${warning}`);
    if (result.errors.length) {
      console.error('\n❌ Asset Library catalog and lock disagree — fix cms/asset-library/catalog.json, or run `npm run asset-library:build` on the machine that holds library/:');
      for (const error of result.errors) console.error(`  ${error}`);
      process.exit(1);
    }
  }
  libraryData = { catalog, lock };
  return libraryData;
}

/**
 * The Asset Library's data, inlined on its tool page from {{asset-manifest}}
 * — the same shape and the same reasoning as renderIconManifest above. The
 * budget is asset-library-plan.md §3: past 700 KB the manifest should be a
 * fetched file, not a block in the page.
 * @returns {string} HTML string
 */
function renderAssetManifest() {
  const { catalog, lock } = loadValidatedLibrary();
  if (!catalog) console.warn('{{asset-manifest}}: no cms/asset-library/catalog.json — the Asset Library renders empty');
  const manifest = assetLibrary.buildManifest(catalog, lock);
  const json = assetLibrary.manifestJson(manifest);
  if (json.length > assetLibrary.MANIFEST_FAIL_BYTES) {
    console.error(`\n❌ Asset manifest is ${Math.round(json.length / 1024)} KB, over the ${assetLibrary.MANIFEST_FAIL_BYTES / 1024} KB inline budget (asset-library-plan.md §3) — move it to a fetched file.`);
    process.exit(1);
  }
  if (json.length > assetLibrary.MANIFEST_WARN_BYTES) {
    console.warn(`Asset manifest is ${Math.round(json.length / 1024)} KB — nearing the inline budget (asset-library-plan.md §3)`);
  }
  console.log(`Asset manifest: ${manifest.assets.length} assets, ${Math.round(json.length / 1024)} KB`);
  return `<script type="application/json" id="asset-manifest">${json}</script>`;
}

/**
 * The format registry, inlined on the Format Library page from
 * {{format-manifest}}: every assets/data/formats/<platform>.json, checked by
 * the loader the verify script shares (cms/generator/formats.js). A bad file
 * stops the build rather than shipping a broken tile.
 * @returns {string} HTML string
 */
let formatPlatforms = null;
/**
 * The format registry, read and checked once per build. A bad file stops
 * the build: the tool page, every {{format:}} tag and the embed read it.
 * @returns {object[]} the platforms
 */
function loadFormatRegistry() {
  if (formatPlatforms) return formatPlatforms;
  const { platforms, errors } = formatRegistry.loadFormats(ROOT);
  if (errors.length) {
    console.error('\n❌ Format registry is invalid — fix assets/data/formats/:');
    errors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }
  formatPlatforms = platforms;
  return platforms;
}

/**
 * tools/formats-embed.html, the public embed of one format card
 * (cms/format-card.md). Written only when the registry has formats, so a
 * deployment without any ships no empty embed.
 */
function writeFormatsEmbed() {
  const platforms = loadFormatRegistry();
  if (!platforms.length) return;
  const html = formatCard.renderEmbedPage({ platforms, getIcon, themeLink: brandCssLink('/'), lang: HTML_LANG, localeScript: CONVERT_LOCALE ? `/${LOCALE_SCRIPT}` : null });
  const out = path.join(OUTPUT_DIR, formatCard.EMBED_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`📄 Generated: ${formatCard.EMBED_PATH}`);
}

function renderFormatManifest() {
  const platforms = loadFormatRegistry();
  if (!platforms.length) console.warn('{{format-manifest}}: no assets/data/formats/*.json — the Format Library renders empty');
  const json = formatRegistry.manifestJson(platforms);
  const count = platforms.reduce((n, p) => n + p.formats.length, 0);
  console.log(`Format manifest: ${count} formats across ${platforms.length} platforms, ${Math.round(json.length / 1024)} KB`);
  return `<script type="application/json" id="format-manifest">${json}</script>`;
}

/**
 * A card's access attributes: its level, and, above team, out of search. The
 * search index is one file every team reader fetches, so an admin or owner
 * card on a searched page (a team section index, the home shelf) would hand
 * its title and description to a team reader who searched for them, whatever
 * the gate does with the page itself.
 */
function cardAccessAttrs(access) {
  if (!access) return '';
  return LEVEL_RANK[access] > LEVEL_RANK.team ? ` data-access="${access}" data-pagefind-ignore` : ` data-access="${access}"`;
}

/**
 * Render a .book-cover anchor with the standard header/content/footer layout.
 *
 *   header  → full-screen icon (top right)
 *   content → card-title + optional card-description
 *   footer  → author (left) + add icon (right placeholder for future meta)
 *
 * @param {object} opts
 * @param {string} opts.href      - link target
 * @param {string} opts.title     - card title (required)
 * @param {string} [opts.subtitle] - card description (optional)
 * @param {string} [opts.author]  - footer author label (defaults to "Studio")
 * @param {string} [opts.access]  - data-access value (omitted if falsy)
 * @param {number} [opts.headingLevel] - heading level for the title (default 3)
 * @param {string} [opts.osIllustration] - drawing slug; makes it a media cover
 * @param {string} [opts.hue] - the art's hue (overrides the authored one)
 * @param {string} [opts.field] - `lighter` or `dark`; omit for light
 * @returns {string} HTML string
 */
function renderBookCover(opts) {
  // Cards render h3 by default. A caller with no group heading above the
  // list passes 2, so the page does not jump from h1 straight to h3.
  const level = opts.headingLevel || 3;
  const author = opts.author || 'Studio';
  const accessAttr = cardAccessAttrs(opts.access);
  const description = opts.subtitle
    ? `<p class="book-cover-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  // An os-illustration makes it a media cover (§37): the art in a media slot
  // before the header, the hue on the slot and on the header (whose corner
  // icon then draws in the art's ink), never on the cover itself (D10).
  const illustration = resolveOsIllustration(opts, `book cover "${opts.title}" (${opts.href})`);
  const variantAttr = illustration ? ' data-variant="media"' : '';
  const hueAttrs = illustration ? osIllustrationAttrs(illustration) : '';
  const media = illustration
    ? `\n        <div class="book-cover-media"${hueAttrs}>${illustration.svg}</div>`
    : '';
  // The lock is always in the markup and shown only on .is-locked, which
  // nav.js sets for a reader who cannot open the page (applyAccess).
  return `<a href="${siteHref(opts.href)}" class="book-cover"${variantAttr}${accessAttr}${MOTION.cover}>${media}
        <header class="book-cover-header"${hueAttrs}><div class="book-cover-trailing">${getIcon('open-full')}${lockIcon('book-cover-lock')}</div></header>
        <div class="book-cover-body">
          <h${level} class="book-cover-title"${flipAttr}>${opts.title}</h${level}>
          ${description}
        </div>
        <footer class="book-cover-footer">
          <span class="book-cover-byline"><em>by</em> ${author}</span>
        </footer>
      </a>`;
}

/**
 * Render a book-contents-item row for L1 section index pages.
 * Wide horizontal row — title + description left-aligned,
 * icon on the right (revealed on hover).
 * @param {Object} opts - { href, title, subtitle, access, headingLevel, identity, meta }
 * @returns {string} HTML string
 */
function renderBookContentsItem(opts) {
  // Cards render h3 by default. A caller with no group heading above the
  // list passes 2, so the page does not jump from h1 straight to h3.
  const level = opts.headingLevel || 3;
  const accessAttr = cardAccessAttrs(opts.access);
  const description = opts.subtitle
    ? `<p class="book-contents-item-description" data-text-wrap="pretty">${opts.subtitle}</p>`
    : '';
  const flipId = flipIdFromHref(opts.href);
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  // Optional slots. Both are left out entirely when empty rather than emitted
  // hollow — an empty slot still draws a gap inside the row's flex container.
  const identity = opts.identity
    ? `<div class="book-contents-item-leading">${opts.identity}</div>\n        `
    : '';
  // Meta goes inside the content column, under the description — a row has no
  // footer strip, so a trailing meta would compete with the title for width.
  const meta = opts.meta
    ? `\n          <span class="book-contents-item-meta">${opts.meta}</span>`
    : '';
  return `<a href="${siteHref(opts.href)}" class="book-contents-item"${accessAttr}${MOTION.contentsItem}>
        ${identity}<div class="book-contents-item-body">
          <h${level} class="book-contents-item-title"${flipAttr}>${opts.title}</h${level}>
          ${description}${meta}
        </div>
        <div class="book-contents-item-trailing">${getIcon('open-full')}${lockIcon('book-contents-item-lock')}</div>
      </a>`;
}

/**
 * Audience tag for a contents row, or '' for the default audience.
 *
 * The label tells the truth now (permissions-plan.md Phase 1, 2026-10-07):
 * the gate reads the same level this tag is drawn from, so "Public" is a page
 * a signed-out visitor can open and "Admin" is one only an admin can. Only
 * non-default levels are tagged. `team` covers nearly every page; tagging
 * those would be chrome, not signal.
 *
 * @param {string} access - a level from deriveDataAccess()
 * @returns {string} HTML for the meta slot, or ''
 */
function audienceTag(access) {
  if (access === 'public') return '<span class="tag">Public</span>';
  if (access === 'admin') return '<span class="tag" data-color="warning">Admin</span>';
  if (access === 'owner') return '<span class="tag" data-color="warning">Owner</span>';
  return '';
}

/**
 * Derive a Barba/GSAP Flip identifier from a destination href.
 * Only the filename slug is needed — the source and destination pages
 * resolve the element by attribute within their own DOM, and the two
 * pages are only ever in the DOM together during a single transition.
 * "color.html" → "color", "../tools/cpm-calculator.html" → "cpm-calculator"
 */
function flipIdFromHref(href) {
  if (!href) return '';
  return String(href).replace(/[?#].*$/, '').replace(/^.*\//, '').replace(/\.html$/, '');
}

//------- Section-to-Folder Mapping (config: sectionFolders) -------//
// Empty map = flat output: every page lands at the output root, no section
// index pages, no per-section subfolders.

const SECTION_FOLDERS = CONFIG.sectionFolders;

// Fallback section order when _defaults.md doesn't define one: config-map order
const DEFAULT_SECTION_ORDER = Object.keys(SECTION_FOLDERS);

/**
 * Slugify a section name for use as a Barba namespace.
 * "Brand Book" → "brand-book", "Design System" → "design-system", undefined → "page".
 */
function slugifySection(section) {
  if (!section) return 'page';
  return String(section).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
}

/**
 * A subsection label without its ordinal — "04 Visual Identity" → "Visual
 * Identity". The ordinal orders the sidebar; in a breadcrumb it is noise.
 */
function subsectionLabel(subsection) {
  return String(subsection).replace(/^\d+\s+/, '');
}

/**
 * The id a subsection's heading carries on its section index, which is also
 * the fragment a doc page's subsection crumb links to. One function for both
 * so the two cannot drift. Built from the label without its ordinal, so
 * renumbering a subsection never breaks a link: "04 Visual Identity" →
 * "visual-identity".
 */
// Ids the site's scripts add to every page after load, so a subsection
// heading must never take one. Keep in step with nav.js and search.js.
const RUNTIME_IDS = new Set([
  'main', 'nav-drawer', 'nav-drawer-title', 'sidebar-lock-note',
  'site-search', 'site-search-input', 'site-search-results',
]);

function subsectionAnchorId(subsection) {
  return slugifySection(subsectionLabel(subsection));
}

/**
 * The pages a section index lists. Layer Discipline (CLAUDE.md §17 Rule 5):
 * docs-site chrome components (asset-card, dont-card) still get standalone
 * pages but are hidden from every section index, so the browsable surface
 * stays portable. Keyed on layer, not section label — the old section gate
 * silently stopped filtering when pages moved or a section was renamed.
 *
 * Shared by the index and the breadcrumb: a subsection whose pages are all
 * filtered here gets no heading, so its crumb has nowhere to link to.
 */
function sectionIndexFiles(files) {
  return files.filter(f => f.frontmatter.layer !== 'docs-site');
}

/**
 * Section → the set of subsections that get a heading on its index. A doc
 * page links its subsection crumb only when its subsection is in here; one
 * that is not (a group whose pages are all docs-site) shows as plain text.
 */
function buildSubsectionHeadings(filesBySection) {
  const headings = {};
  for (const [section, files] of Object.entries(filesBySection)) {
    headings[section] = new Set(
      sectionIndexFiles(files).map(f => f.frontmatter.subsection).filter(Boolean)
    );
  }
  return headings;
}

/**
 * The human label behind a section slug — "brand-book" → "Brand Book". The
 * search index filters and labels results by section, and the label is the
 * only form a reader recognises. Root pages have no section and get ''.
 */
function sectionLabelFromSlug(slug) {
  if (!slug || slug === 'page') return '';
  return Object.keys(CONFIG.sectionFolders || {}).find(label => slugifySection(label) === slug) || '';
}

// Special filename overrides for files that don't follow the prefix-strip
// pattern (config: filenameOverrides)
const FILENAME_OVERRIDES = CONFIG.filenameOverrides;

/**
 * Derive output folder and filename for a markdown file
 */
function deriveOutputPath(filename, section) {
  // Check for explicit override
  if (FILENAME_OVERRIDES[filename]) {
    const override = FILENAME_OVERRIDES[filename];
    return { folder: override.folder, htmlName: override.name };
  }

  // Get section folder
  const folder = SECTION_FOLDERS[section];
  if (!folder) {
    // Fallback: use filename as-is at root (shouldn't happen for mapped sections)
    return { folder: '', htmlName: filename.replace('.md', '.html') };
  }

  // Strip section prefix from filename
  // e.g. "brand-values.md" with folder "brand" → strip "brand-" → "values.html"
  let baseName = filename.replace('.md', '');
  const prefixes = [folder + '-', section.toLowerCase().replace(/\s+/g, '-') + '-'];
  for (const prefix of prefixes) {
    if (baseName.startsWith(prefix)) {
      baseName = baseName.substring(prefix.length);
      break;
    }
  }

  return { folder, htmlName: baseName + '.html' };
}

/**
 * Load folder defaults from _defaults.md in a given directory.
 * Returns parsed frontmatter object, or empty object if no _defaults.md exists.
 */
const _defaultsCache = {};
function loadDefaults(dirPath) {
  if (_defaultsCache[dirPath] !== undefined) return _defaultsCache[dirPath];
  const defaultsFile = path.join(dirPath, '_defaults.md');
  if (fs.existsSync(defaultsFile)) {
    const raw = fs.readFileSync(defaultsFile, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    _defaultsCache[dirPath] = frontmatter;
    return frontmatter;
  }
  _defaultsCache[dirPath] = {};
  return {};
}

/**
 * The data-access value for a page or a link: its level, public, team or
 * admin, from the `access:` field, the same reading the gate compiles into
 * worker/page-access.mjs, so what the markup says and what the Worker does
 * cannot differ. Anything else, the Netlify-era `brand…` values included, is
 * team.
 *
 * The attribute is the client-side hint the locks read (nav.js applyAccess):
 * a sidebar link, a card or a pager link whose level the reader cannot open
 * is locked or hidden before the Worker is ever asked. It decides nothing -
 * the Worker is the control (access-plan.md §4.9, revised 2026-10-07).
 */
function deriveDataAccess(frontmatter) {
  return normaliseLevel(frontmatter.access);
}

/**
 * Parse a comma-separated string into a trimmed array.
 * Returns the provided fallback if the value is falsy.
 */
function parseList(value, fallback) {
  if (!value) return fallback || [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Get subsection ordering for a given section.
 * Looks for a section-specific key first (e.g. "design-system-subsection-order"),
 * then falls back to the generic "subsection-order" key.
 */
function getSubsectionOrder(defaults, section) {
  const slug = section.toLowerCase().replace(/\s+/g, '-');
  const key = `${slug}-subsection-order`;
  if (defaults[key]) return parseList(defaults[key], []);
  return parseList(defaults['subsection-order'], []);
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, content: content.trim() };
  }

  const frontmatterText = match[1];
  const markdownContent = match[2];

  const frontmatter = {};
  const lines = frontmatterText.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: markdownContent.trim() };
}

/**
 * Sitewide pre-pass: chipify any inline <code> matching one of the three
 * explicit conventions, anywhere in the document (paragraphs, lists, tables, etc.).
 *
 *   `.class-name`        → class chip,  copies `.class-name`
 *   `var(--token-name)`  → token chip,  copies `var(--token-name)`
 *   `#abc123`            → hex chip,    copies `#abc123` + colour swatch
 *
 * Anything else in <code> is left alone. Block code (<pre><code class="language-...">)
 * has a `class` attribute on the <code>, so the bare-tag regex below skips it.
 */
function chipifyExplicitPatterns(html) {
  return html.replace(/<code>([^<]+)<\/code>/g, (match, content) => {
    // Class: .foo-bar, .is-active, .cols-3
    if (/^\.[a-z][\w-]*$/i.test(content)) {
      return buildClassButton(content);
    }
    // Token: var(--foo-bar)
    if (/^var\(--[a-z0-9_-]+\)$/i.test(content)) {
      return buildTokenButton(content);
    }
    // Hex: #abc, #abcd, #abcdef, #abcdef12
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(content)) {
      return buildHexButton(content);
    }
    return match;
  });
}

function buildClassButton(className) {
  return `<button type="button" class="token-copy is-class" data-copy="${escapeAttr(className)}" aria-label="Copy ${escapeAttr(className)}"><code>${className}</code></button>`;
}

function buildTokenButton(varExpression) {
  return `<button type="button" class="token-copy is-token" data-copy="${escapeAttr(varExpression)}" aria-label="Copy ${escapeAttr(varExpression)}"><code>${varExpression}</code></button>`;
}

/**
 * Turn token-table cells into clickable copy buttons (legacy heuristic pass).
 *
 * Runs after chipifyExplicitPatterns and acts as a fallback for older docs that
 * still use bare `--token` syntax, unwrapped hex values, or font-stack literals
 * inside table cells. Cells already chipified by the explicit-pattern pass are
 * skipped to avoid double-wrapping.
 *
 * Skips the description column (last column when its <th> matches description|notes|usage).
 */
function injectTokenCopyButtons(tableInner) {
  // Identify the description column index from the header row, if any.
  let descriptionIndex = -1;
  const theadMatch = tableInner.match(/<thead>([\s\S]*?)<\/thead>/);
  if (theadMatch) {
    const headers = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1]);
    descriptionIndex = headers.findIndex(h => /description|notes|usage/i.test(h.replace(/<[^>]*>/g, '')));
  }

  // Walk every <tr> and rebuild its <td> cells.
  return tableInner.replace(/<tr>([\s\S]*?)<\/tr>/g, (rowMatch, rowInner) => {
    // Leave header rows alone.
    if (/<th[\s>]/.test(rowInner)) return rowMatch;

    let cellIndex = -1;
    const newInner = rowInner.replace(/<td>([\s\S]*?)<\/td>/g, (_, cell) => {
      cellIndex++;
      if (cellIndex === descriptionIndex) return `<td>${cell}</td>`;
      return `<td>${transformTokenCell(cell)}</td>`;
    });
    return `<tr>${newInner}</tr>`;
  });
}

/**
 * Transform a single token-table cell into a copy button.
 *
 * The new explicit-pattern pre-pass (chipifyExplicitPatterns) handles the
 * common cases: `.class`, `var(--token)`, and `#hex`. This legacy fallback
 * exists only for two narrow backward-compat cases on un-migrated docs:
 *
 *   1. <code>--bare-token</code>  → wraps in var() and chipifies
 *   2. bare #hex (no backticks)   → chipifies with swatch
 *
 * Everything else is left alone. Earlier versions had a "literal copy of any
 * single <code>" case plus a looksLikeValue heuristic that misfired badly
 * (e.g. chipifying "Centre items" because "items" contains "em"). Both removed.
 */
function transformTokenCell(cell) {
  const raw = cell.trim();
  if (!raw) return cell;

  // Already chipified by the sitewide explicit-pattern pre-pass — leave it alone.
  if (raw.includes('class="token-copy')) return cell;

  // Backward-compat 1: <code>--bare-token</code> → copies var(--bare-token)
  const codeVarMatch = raw.match(/^<code>(--[a-z0-9-]+)<\/code>$/i);
  if (codeVarMatch) {
    return buildVarButton(codeVarMatch[1]);
  }

  // Backward-compat 2: bare hex code with no backticks
  const hexMatch = raw.match(/^(#[0-9a-fA-F]{6,8}|#[0-9a-fA-F]{3,4})$/);
  if (hexMatch) {
    return buildHexButton(hexMatch[1]);
  }

  // Backward-compat 3: mixed cells containing one or more <code>--bare-token</code>
  // entries — chipify just the bare tokens, leave any other <code> untouched.
  if (/<code>--[a-z0-9-]+<\/code>/i.test(raw)) {
    return raw.replace(/<code>(--[a-z0-9-]+)<\/code>/gi, (_, inner) => buildVarButton(inner));
  }

  return cell;
}

function buildVarButton(varName) {
  const copyValue = `var(${varName})`;
  return `<button type="button" class="token-copy is-token" data-copy="${escapeAttr(copyValue)}" aria-label="Copy ${escapeAttr(copyValue)}"><code>${varName}</code></button>`;
}

function buildHexButton(hex) {
  return `<button type="button" class="token-copy has-swatch" data-copy="${hex}" aria-label="Copy ${hex}"><code>${hex}</code><span class="token-swatch" style="background:${hex};" aria-hidden="true"></span></button>`;
}

/**
 * Escape a string for safe inclusion in an HTML attribute value.
 */
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

//------- Image shortcode -------//

/**
 * {{image: src="…" alt="…" caption="…" width="s" ratio="16x9" float="left" frame="none"}}
 *
 * Markdown's ![alt](src) emits a bare <img> — no class, no attributes — so
 * any image that is sized, cropped, placed or floated has to be written as
 * raw HTML. A captioned one then has to split its attributes across two
 * elements: the box attributes belong on the <figure>, the ratio on the
 * <img> inside it. That split is the part an author gets wrong, so the
 * shortcode does it rather than documenting it.
 *
 * Expanded BEFORE marked() runs, which is not a preference:
 *
 * A renderer override cannot work. Marked wraps every image in <p>, so a
 * renderer returning a figure emits <p><figure>…</figure></p> — invalid,
 * because a paragraph takes phrasing content and a figure is flow content.
 * And there is no markdown syntax for a width or a float to hang off.
 *
 * Expanding after marked() cannot work either. By then the line is already
 * <p>{{image: src=&quot;…</p>, with every quote entity-escaped.
 *
 * A raw <figure> at column 0 passes through marked untouched, including
 * directly after a paragraph with no blank line between them — it is a
 * CommonMark type-6 HTML block, which may interrupt a paragraph.
 *
 * The uncaptioned branch emits a bare <img>, which is a type-7 block and may
 * NOT interrupt a paragraph. Written straight under a line of prose it is
 * swallowed into that paragraph, behind a <br> from breaks: true. A blank
 * line above it is therefore required, and cannot be inserted here: inside a
 * raw HTML block — a .demo-preview, a lab section — a blank line would end
 * the block and escape the rest of it. So it is documented instead
 * (cms/image.md), the way the no-blank-lines-in-a-demo rule is.
 */

// Closed value sets, checked so a typo fails the build rather than emitting
// an attribute no CSS rule matches — which looks like the feature is broken
// rather than like the value is wrong. They mirror design-system.css §24.
const IMAGE_SHORTCODE_VALUES = {
  width: ['s', 'm', 'l'],
  ratio: ['1x1', '3x2', '4x3', '16x9', '21x9'],
  align: ['left', 'center', 'right'],
  float: ['left', 'right'],
  frame: ['none', 'ground'],
};

// Where the picture sits and how wide it may grow describe the box, so they
// move to the <figure> when there is one — the caption is part of that box
// and has to be measured, placed and floated with it. The ratio is a property
// of the picture itself, so it stays on the <img> either way.
const IMAGE_BOX_PARAMS = ['width', 'align', 'float'];
// The frame is drawn on the picture, like the ratio, so it stays on the
// <img> too: a caption sits outside the frame (design-system.css §24).
const IMAGE_PARAMS = ['src', 'alt', 'caption', 'ratio', 'frame', ...IMAGE_BOX_PARAMS];

/**
 * Build the markup for one {{image: …}} line.
 * @param {string} params - everything between `{{image:` and `}}`
 * @param {string} line - the whole line, quoted back in any error
 * @returns {string} an <img> or a <figure> holding one
 */
function renderImageShortcode(params, line) {
  const fail = (reason) => {
    throw new Error(`{{image}}: ${reason}\n  ${line}\n  (grep cms/ for that line)`);
  };

  // No prototype: otherwise attrs.constructor is already set, and a parameter
  // by that name would be reported as a duplicate rather than as unknown.
  const attrs = Object.create(null);
  const pair = /([a-z]+)="([^"]*)"/g;
  let match;
  while ((match = pair.exec(params))) {
    if (attrs[match[1]] !== undefined) fail(`duplicate parameter "${match[1]}"`);
    attrs[match[1]] = match[2];
  }

  // Anything the pair pattern did not consume is a typo — an unquoted value,
  // a stray word, a curly quote pasted in from a document. Naming the
  // leftover points at the character rather than at the line again.
  const leftover = params.replace(/([a-z]+)="([^"]*)"/g, '').trim();
  if (leftover) fail(`could not parse "${leftover}" — every value needs straight double quotes`);

  for (const key of Object.keys(attrs)) {
    if (!IMAGE_PARAMS.includes(key)) {
      fail(`unknown parameter "${key}" — expected ${IMAGE_PARAMS.join(', ')}`);
    }
    const allowed = IMAGE_SHORTCODE_VALUES[key];
    if (allowed && !allowed.includes(attrs[key])) {
      fail(`${key}="${attrs[key]}" is not one of ${allowed.join(', ')}`);
    }
  }

  if (!attrs.src) fail('src is required');
  // Presence, not content: alt="" is the correct markup for a decorative
  // image and nothing here can tell the two apart. Leaving it out altogether
  // is an accessibility defect, which is why this fails the build where an
  // unknown {{icon:}} only warns.
  if (attrs.alt === undefined) fail('alt is required — use alt="" for a decorative image');

  const box = IMAGE_BOX_PARAMS
    .filter((key) => attrs[key])
    .map((key) => ` data-${key}="${attrs[key]}"`)
    .join('');
  const ratio = (attrs.ratio ? ` data-ratio="${attrs.ratio}"` : '')
    + (attrs.frame ? ` data-frame="${attrs.frame}"` : '');
  const src = escapeAttr(attrs.src);
  const alt = escapeAttr(attrs.alt);

  // No caption, no figure: there is only one element for the attributes to
  // sit on, and an empty <figure> around a picture says nothing to anyone.
  if (attrs.caption === undefined) {
    return `<img class="img"${box}${ratio} src="${src}" alt="${alt}">`;
  }

  // The caption is markdown — parseInline, so `code`, a link or emphasis
  // behaves the way it does in the sentence above it. Inline only: a
  // figcaption takes phrasing content, and a caption wanting a list or a
  // second paragraph is prose that belongs outside the figure.
  const caption = marked.parseInline(attrs.caption);
  return [
    `<figure${box}>`,
    `<img class="img"${ratio} src="${src}" alt="${alt}">`,
    `<figcaption>${caption}</figcaption>`,
    '</figure>',
  ].join('\n');
}

//------- Asset and video shortcodes -------//

/**
 * Parse the key="value" pairs of one media shortcode, strictly, the way
 * {{image:}} does: a duplicate, an unknown key, a value outside its set or
 * anything left unparsed fails the build naming the line.
 * @param {string} name - the shortcode, for messages ("asset", "video")
 * @param {string} params - everything between `{{name:` and `}}`
 * @param {string} line - the whole line, quoted back in any error
 * @param {string[]} allowed - the keys this shortcode takes
 * @param {Object<string, string[]>} values - closed value sets by key
 * @returns {{attrs: Object<string, string>, fail: function(string): never}}
 *   the parsed attributes, and the function that fails the build on this line
 */
function parseMediaShortcode(name, params, line, allowed, values) {
  const fail = (reason) => {
    throw new Error(`{{${name}}}: ${reason}\n  ${line}\n  (grep cms/ for that line)`);
  };
  const attrs = Object.create(null);
  const pair = /([a-z]+)="([^"]*)"/g;
  let match;
  while ((match = pair.exec(params))) {
    if (attrs[match[1]] !== undefined) fail(`duplicate parameter "${match[1]}"`);
    attrs[match[1]] = match[2];
  }
  const leftover = params.replace(/([a-z]+)="([^"]*)"/g, '').trim();
  if (leftover) fail(`could not parse "${leftover}" — every value needs straight double quotes`);
  for (const key of Object.keys(attrs)) {
    if (!allowed.includes(key)) fail(`unknown parameter "${key}" — expected ${allowed.join(', ')}`);
    if (values[key] && !values[key].includes(attrs[key])) {
      fail(`${key}="${attrs[key]}" is not one of ${values[key].join(', ')}`);
    }
  }
  return { attrs, fail };
}

// Mirrors docs-site.css section 5 (Asset Card).
const ASSET_SHORTCODE_VALUES = {
  ground: ['faded', 'plain', 'dark', 'none'],
  footer: ['bar', 'ground', 'none'],
};
const ASSET_PARAMS = ['src', 'alt', 'ground', 'title', 'footer', 'download'];

/**
 * {{asset: src="…" alt="…" ground="faded" title="Primary logo" footer="ground" download="…"}}
 *
 * One asset card holding one picture or file. The footer appears when there
 * is a title and footer is not "none"; download="<path>" adds a Download
 * button for that file (download="" downloads src). A picture that fills the
 * card edge to edge is ground="none", which keeps the bar footer: a ground
 * footer would sit on the photo. Copy buttons, specimens and light and dark
 * pairs are raw HTML (cms/asset-card.md).
 */
function renderAssetShortcode(params, line) {
  const { attrs, fail } = parseMediaShortcode('asset', params, line, ASSET_PARAMS, ASSET_SHORTCODE_VALUES);
  if (!attrs.src) fail('src is required');
  if (attrs.alt === undefined) fail('alt is required — use alt="" for a decorative image');
  if (attrs.footer && attrs.footer !== 'none' && !attrs.title) fail('a footer needs a title');
  if (attrs.download !== undefined && !attrs.title) fail('download needs a title, which names the button');
  // alt="" is right when the footer's title names the asset; with no title
  // to show, the card would say nothing to a screen reader.
  if (attrs.alt === '' && (!attrs.title || attrs.footer === 'none')) fail('alt="" needs a title in the footer to name the asset — give the image alt text');

  const ground = attrs.ground || 'faded';
  const footerStyle = attrs.footer || 'bar';
  const groundFooter = footerStyle === 'ground' && ground !== 'none';
  const cardAttrs = (ground !== 'faded' ? ` data-ground="${ground}"` : '')
    + (groundFooter ? ' data-footer="ground"' : '');
  const preview = `<div class="asset-card-preview"><img src="${escapeAttr(attrs.src)}" alt="${escapeAttr(attrs.alt)}" loading="lazy"></div>`;

  let footer = '';
  if (attrs.title && footerStyle !== 'none') {
    const title = escapeAttr(attrs.title);
    const file = attrs.download === '' ? attrs.src : attrs.download;
    const actions = file === undefined ? '' : '<div class="asset-card-actions">'
      + `<a class="button" data-size="small" data-icon-only href="${escapeAttr(file)}" download data-tooltip="Download" aria-label="Download ${escapeAttr(attrs.title)}">{{icon:download}}</a>`
      + '</div>';
    // A dark ground under a ground footer: the footer takes dark-mode
    // colours from the system's own tokens (docs-site.css section 5).
    const theme = groundFooter && ground === 'dark' ? ' data-theme="dark"' : '';
    footer = `<div class="asset-card-footer"${theme}><p class="asset-card-title">${title}</p>${actions}</div>`;
  }
  // One line, no blank lines: marked keeps an HTML block whole only until
  // the first blank line.
  return `<div class="asset-card"${cardAttrs}>${preview}${footer}</div>`;
}

const VIDEO_SHORTCODE_VALUES = { controls: ['play', 'full'] };
const VIDEO_PARAMS = ['src', 'poster', 'label', 'controls', 'captions'];

/**
 * {{video: src="…" poster="…" label="Campaign film" controls="full"}}
 *
 * One BD Video player (cms/bd-video.md). label names the region and the
 * video for a screen reader, so it is required, as alt is on {{image:}}.
 * controls="play" (the default) is the centre button alone; "full" adds the
 * scrubber, mute and fullscreen. captions="<file.vtt>" adds an English
 * captions track, shown by default: a video with speech needs one (WCAG
 * 1.2.2). Anything else (cues, an unmute prompt) is raw HTML.
 */
function renderVideoShortcode(params, line) {
  const { attrs, fail } = parseMediaShortcode('video', params, line, VIDEO_PARAMS, VIDEO_SHORTCODE_VALUES);
  if (!attrs.src) fail('src is required');
  if (!attrs.label) fail('label is required — it names the video for a screen reader');
  const label = escapeAttr(attrs.label);
  const controls = attrs.controls === 'full' ? ' data-bd-scrubber data-bd-mute data-bd-fullscreen' : '';
  const poster = attrs.poster ? ` poster="${escapeAttr(attrs.poster)}"` : '';
  // The label names the region; the <video> inside takes its context from
  // it rather than repeating the same name.
  const track = attrs.captions
    ? `<track kind="captions" src="${escapeAttr(attrs.captions)}" srclang="en" label="English" default>`
    : '';
  return `<div class="bd-video" role="region" aria-label="${label}"${controls}>`
    + `<video class="bd-video-player" src="${escapeAttr(attrs.src)}"${poster} playsinline preload="metadata">${track}</video>`
    + '</div>';
}

/**
 * Expand every {{asset: …}} and {{video: …}} line outside a fenced code
 * block. Same rules as {{image:}}: the whole line, from column 0.
 */
function expandMediaShortcodes(markdown) {
  if (!markdown.includes('{{asset:') && !markdown.includes('{{video:')) return markdown;
  const renderers = { asset: renderAssetShortcode, video: renderVideoShortcode };
  return mapLinesOutsideFences(markdown, (line) => {
    const name = line.startsWith('{{asset:') ? 'asset' : line.startsWith('{{video:') ? 'video' : null;
    if (!name) return line;
    const match = new RegExp(`^\\{\\{${name}:\\s*(.*?)\\s*\\}\\}[^\\S\\n]*$`).exec(line);
    if (!match) {
      throw new Error(
        `{{${name}}}: the shortcode has to be the whole line — it must close with }} and carry nothing after it`
        + `\n  ${line}\n  (grep cms/ for that line)`
      );
    }
    return renderers[name](match[1], line);
  });
}

/**
 * Expand every {{image: …}} line that is not inside a fenced code block.
 *
 * Fence state is tracked line by line rather than by splitting on a pattern,
 * because a fence is defined by its marker AND its length: a ```` block may
 * contain ``` lines, and only a run of the same character at least as long
 * closes it. Pairing on the first three characters instead — the obvious
 * shortcut — reads such a block's opener against the inner closer, and every
 * fence after it is inverted until the counts happen to re-sync. The failure
 * is silent both ways round: a shortcode in prose left literal, or one
 * expanded inside a code block that meant to show it.
 *
 * The {{icon:}} guard cannot be reused for any of this. It works by matching
 * rendered <code>/<pre> in an alternation, and before marked runs there is no
 * such markup to match.
 *
 * Inline code needs no guard: only a line beginning with the shortcode
 * matches, and a line of inline code begins with a backtick. Column 0 for the
 * same reason — an indented shortcode stays literal and visibly so, rather
 * than expanding into a figure marked would then read as an indented code
 * block. That is the one escape hatch, so it stays silent; anything else that
 * starts the line with the shortcode and does not parse is an error.
 */
function expandImageShortcodes(markdown) {
  if (!markdown.includes('{{image:')) return markdown;
  return mapLinesOutsideFences(markdown, (line) => {
    if (!line.startsWith('{{image:')) return line;

    const match = /^\{\{image:\s*(.*?)\s*\}\}[^\S\n]*$/.exec(line);
    if (!match) {
      throw new Error(
        `{{image}}: the shortcode has to be the whole line — it must close with }} and carry nothing after it`
        + `\n  ${line}\n  (grep cms/ for that line)`
      );
    }
    return renderImageShortcode(match[1], line);
  });
}

/**
 * Expand every {{format: …}} line outside a fenced code block into a format
 * card shell, and every {{format-table: <platform>}} line into the
 * platform's at-a-glance table (cms/generator/format-card.js). Column 0 and the whole line,
 * like {{image:}}, so a mention in prose or code stays text. A bad id or
 * layer stops the build, naming the page.
 * @param {string} markdown
 * @param {string} source the page, for the error
 */
function expandFormatShortcodes(markdown, source) {
  if (!markdown.includes('{{format:') && !markdown.includes('{{format-table:')) return markdown;
  const platforms = loadFormatRegistry();
  const byId = formatCard.indexFormats(platforms);
  return mapLinesOutsideFences(markdown, (line) => {
    if (line.startsWith('{{format:')) return formatCard.expandTag(line, byId, getIcon, source);
    if (line.startsWith('{{format-table:')) return formatCard.expandTable(line, platforms, source);
    return line;
  });
}

/**
 * Run fn over every line that is not inside a fenced code block.
 *
 * Fence state is tracked line by line rather than by splitting on a pattern,
 * because a fence is defined by its marker AND its length: a ```` block may
 * contain ``` lines, and only a run of the same character at least as long
 * closes it.
 */
function mapLinesOutsideFences(markdown, fn) {
  let fence = null;
  return markdown.split('\n').map((line) => {
    const marker = /^([`~]{3,})/.exec(line);

    if (fence) {
      // Closes only on the same character, at least as long, and alone on the
      // line — a closing fence takes no info string.
      const closes = marker
        && marker[1][0] === fence.char
        && marker[1].length >= fence.length
        && line.slice(marker[1].length).trim() === '';
      if (closes) fence = null;
      return line;
    }

    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      return line;
    }

    return fn(line);
  }).join('\n');
}

/**
 * Convert markdown to HTML using marked. `headingIds` is the locale's list
 * of the page's headings in order, [converted text, original text]
 * (readPageSource), for an engine page on a site whose locale isn't en-GB.
 */
function markdownToHtml(markdown, source = 'a cms/*.md page', headingIds = null) {
  // Configure marked options
  marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert \n to <br>
    pedantic: false,
    sanitize: false,
    smartLists: true,
    smartypants: false,
    langPrefix: 'language-', // Prefix for language classes (for Highlight.js)
  });

  // Expand {{icon-registry}} into the full registry table before markdown
  // conversion. Only a line holding nothing but the placeholder matches, so
  // inline mentions like `{{icon-registry}}` in docs survive as text.
  // [^\S\n] (not \s) keeps the line's trailing newline out of the match, and
  // the function replacer keeps renderIconRegistry lazy — it only runs when
  // a page actually contains the placeholder.
  markdown = markdown.replace(/^\{\{icon-registry\}\}[^\S\n]*$/m, renderIconRegistry);

  // {{logo-spec:<variant id>}}: the brand's logo drawn with its Layout Spec
  // (logo-spec.js), so a guide's clear-space figure comes from the same data
  // as the Logo Tool. Line-only, like the registry; an id brand.json doesn't
  // have stops the build.
  markdown = expandLogoSpecs(markdown);

  // {{brand:key}}: the site's own name and addresses, so a guide the engine
  // ships reads as this site's (PB-3). Everywhere in the page, code included,
  // because an example URL is where a guide most often names its host. A
  // backslash before it keeps it literal, for a page that documents the token.
  markdown = expandBrandTokens(markdown, source);

  // {{page-types}} inlines the PAGE_TYPES table as JSON for the Page Layouts
  // wireframe. Same line-only match and lazy replacer as the registry above,
  // so a doc can still mention the placeholder inline as text.
  markdown = markdown.replace(/^\{\{page-types\}\}[^\S\n]*$/m, renderPageTypes);

  // Expand {{image: …}} into an <img>, or a <figure> when it carries a
  // caption. Before marked(), like the registry above and unlike {{icon:}} —
  // see expandImageShortcodes for why that is the only order that works.
  markdown = expandImageShortcodes(markdown);

  // {{asset: …}} and {{video: …}}: an asset card and a BD Video player,
  // before marked for the same reason as {{image:}}.
  markdown = expandMediaShortcodes(markdown);

  // {{format: <id>}} becomes a format card shell, before marked for the
  // same reason as {{image:}}; its {{icon:}} shorthand is expanded by the
  // icon pass after marked, like the rest of the page's.
  markdown = expandFormatShortcodes(markdown, source);

  // {{icon-manifest}} is a tool-body placeholder (cms/apps/<slug>.html). In
  // markdown it would publish as literal text, so say so at build time. Same
  // line-only match as the registry, so a doc can still mention it inline.
  for (const name of ['icon-manifest', 'asset-manifest', 'format-manifest']) {
    if (new RegExp(`^\\{\\{${name}\\}\\}[^\\S\\n]*$`, 'm').test(markdown)) {
      console.warn(`{{${name}}} only resolves in a tool body (cms/apps/<slug>.html) — here it renders as text`);
    }
  }

  let html = marked(markdown);

  // Add IDs to headings for anchor links
  html = markSearchIgnoredBlocks(html);

  const headingSlug = (text) => text.toLowerCase()
    .replace(/&[#\w]+;/g, '') // Drop escaped entities: "don&#39;t" → "dont", not "don39t"
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim();
  // A heading the locale converted keeps the id of its original text, so
  // #colour still lands on "Color" and every link to it holds. Matched in
  // order, unchanged headings included, so a "Color" written as such keeps
  // its own id beside a converted "Colour". A heading's {{brand:key}} is
  // filled first, as the rendered heading's is.
  const keptIds = (headingIds || []).map(([now, was]) => [
    headingSlug(expandBrandTokens(now, source)), headingSlug(expandBrandTokens(was, source)),
  ]);
  let nextHeading = 0;

  html = html.replace(/<h([1-6])>([^<]+)<\/h[1-6]>/g, (match, level, text) => {
    const slug = headingSlug(text);
    let id = slug;
    for (let i = nextHeading; i < keptIds.length; i++) {
      if (keptIds[i][0] !== slug) continue;
      id = keptIds[i][1];
      nextHeading = i + 1;
      break;
    }

    return `<h${level} id="${id}">${text}</h${level}>`;
  });

  // Add target="_blank" and rel="noopener noreferrer" to external links
  html = html.replace(/<a\s+([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (match, before, href, after) => {
    // Check if link is external (starts with http:// or https://)
    if (href.startsWith('http://') || href.startsWith('https://')) {
      let newMatch = match;

      // Add target="_blank" if it doesn't exist
      if (!newMatch.includes('target=')) {
        newMatch = newMatch.replace(/>$/, ' target="_blank">');
      }

      // Add or update rel attribute
      if (newMatch.includes('rel=')) {
        newMatch = newMatch.replace(/rel=["']([^"']*)["']/i, (m, rel) => {
          // Check if noopener noreferrer already exists in rel
          if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
            return `rel="${rel} noopener noreferrer"`;
          }
          return m;
        });
      } else {
        // Add new rel attribute
        newMatch = newMatch.replace(/>$/, ' rel="noopener noreferrer">');
      }

      return newMatch;
    }
    return match;
  });

  // Sitewide pre-pass: chipify any inline <code> matching .class / var(--token) / #hex.
  // Works anywhere in the document — paragraphs, lists, tables, callouts.
  html = chipifyExplicitPatterns(html);

  // Wrap bare tables (markdown-generated) in a scroll container — skip demo tables that already have classes
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="table-scroll"><table class="table">$1</table></div>');

  // Turn token-table cells into copy buttons.
  // Skips the "Description" column (last column when its header text matches description|notes|usage).
  // Each non-description cell whose content is a recognisable token, value, or hex
  // is replaced with a <button class="token-copy"> that copies the right thing on click.
  html = html.replace(/<table class="table">([\s\S]*?)<\/table>/g, (_, tableInner) => {
    return `<table class="table">${injectTokenCopyButtons(tableInner)}</table>`;
  });

  // Add copy buttons to code blocks — deterministic, page-local ids.
  // markdownToHtml runs once per output page, so a per-call counter keeps ids
  // stable across builds (no git churn) and page-locally unique (all copy-button
  // targets are resolved with a page-scoped querySelector).
  let codeBlockIndex = 0;
  html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attributes, code) => {
    const codeId = 'code-' + codeBlockIndex++;

    return `
      <div class="code-block-wrapper">
        <button class="button copy-btn" data-size="xsmall" data-icon-only data-clipboard-target="#${codeId}" data-tooltip="Copy" type="button" aria-label="Copy code"><span class="copy-btn-default">${getIcon('copy')}</span><span class="copy-btn-copied">${getIcon('check')}</span></button>
        <pre><code id="${codeId}"${attributes}>${code}</code></pre>
      </div>
    `;
  });

  // Expand icon shorthand: {{icon:name}} (skip matches inside <code> or <pre> blocks)
  html = html.replace(/(<code[^>]*>[\s\S]*?<\/code>)|(<pre[^>]*>[\s\S]*?<\/pre>)|\{\{icon:([a-z0-9-]+)\}\}/g,
    (match, code, pre, name) => {
      if (code || pre) return match; // preserve code blocks as-is
      return getIcon(name);
    });


  // The body's reveals, last, over the rendered markup (MOTION).
  html = stampBodyMotion(html);
  assertStamped(html, new RegExp('<div\\b' + ATTRS + '\\sclass="(?:[^"]*\\s)?demo-preview(?:\\s[^"]*)?"' + ATTRS + '>', 'g'), 'demo frames', 'markdownToHtml');
  return html;
}

/**
 * Generate table of contents from HTML content
 */
function generateTableOfContents(html) {
  const headingRegex = /<h([1-6])[^>]*id="([^"]*)"[^>]*>.*?<\/h[1-6]>/g;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const id = match[2];
    const text = match[0].replace(/<[^>]*>/g, '').trim();

    // Only include H1 and H2 headings in TOC
    if (level <= 2) {
      headings.push({ level, id, text });
    }
  }

  // Empty in, empty out — a falsy return collapses both TOC renderings
  // (tocAside and tocDropdown), rather than shipping a wrapper around
  // "no headings" copy.
  if (headings.length === 0) {
    return '';
  }

  // Labelled "Table of contents", not "On this page": the dropdown's
  // <summary> already says "On this page", and a nav label repeating its
  // disclosure's name gets announced twice.
  let toc = '<nav class="toc" aria-label="Table of contents"><ul class="toc-list"' + MOTION.tocList + '>';

  headings.forEach((heading) => {
    const { level, id, text } = heading;
    toc += `<li class="toc-item toc-level-${level}"${MOTION.tocItem}><a href="#${id}" class="toc-link">${text}</a></li>`;
  });

  toc += '</ul></nav>';
  return toc;
}

// ── Styleguide coverage ──
//
// cms/styleguide.md carries every foundation and component in one scroll. This
// keeps it honest: the page it generates is only trustworthy if it is complete.
const STYLEGUIDE_SOURCE = 'styleguide.md';

/**
 * The slug a styleguide section declares, derived from the page it must cover.
 *
 * Taken from the output basename rather than the cms filename so the gate
 * compares the section against what the build actually writes.
 *
 * Basenames are unique across the pages this gate sees today, but nothing in
 * the code guarantees it: deriveOutputPath honours CONFIG.filenameOverrides,
 * which can send any page anywhere (styleguide.md and glossary.md are already
 * pulled to the output root that way). Two Foundations or Components pages overridden into
 * different folders with the same basename would collide here. Hence
 * assertUniqueSlugs below — the invariant is asserted rather than assumed.
 */
// Output folders whose foundation and core pages must appear on the styleguide.
// `web` is the folder Components had before 2026-11-12, kept for a site that
// still builds one.
const STYLEGUIDE_FOLDERS = new Set(['foundations', 'components', 'web']);
// Output folders whose core pages are this brand's content, never the engine's.
const BRAND_CONTENT_FOLDERS = new Set(['brand', 'formats']);

function styleguideSlug(htmlPath) {
  return path.basename(htmlPath, '.html');
}

/**
 * Strip the regions of a source file where markup is quoted rather than live:
 * HTML comments, <pre> and <code>.
 *
 * The coverage gate scans raw text for an attribute, so without this a section
 * commented out while debugging still counts as covered — the component
 * vanishes from the page and the build stays green, which is the exact failure
 * the gate exists to prevent. A <code> or <pre> block showing the attribute as
 * an example counts too.
 */
function stripQuotedMarkup(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<pre\b[\s\S]*?<\/pre>/g, '')
    .replace(/<code\b[\s\S]*?<\/code>/g, '');
}

/**
 * Reconcile the styleguide against the pages it is supposed to show.
 *
 * An entry is declared by `data-component="<slug>"` on the section presenting
 * that component. This replaced a "Full docs:" link when the page became a
 * raw-HTML presentation — an HTML body has no markdown link syntax to key on —
 * but it is the better anchor either way: an attribute is written by the
 * author and never by a demo, which closes the "a link inside a demo counts as
 * coverage" hole the old form had. It is also the section's CSS and JS hook,
 * so a declaration that goes missing takes the styling with it rather than
 * failing silently in one place only.
 *
 * @param {Array<{filename: string, title: string, htmlPath: string}>} expected
 * @returns {{missing: string[], stale: string[]}}
 */
function validateStyleguideCoverage(expected, known) {
  const source = path.join(DOCS_DIR, STYLEGUIDE_SOURCE);
  if (!fs.existsSync(source)) return { missing: [], stale: [], empty: false };

  const body = stripQuotedMarkup(fs.readFileSync(source, 'utf8'));
  const declared = new Set();
  // Either quote style: a single-quoted attribute is valid HTML, and silently
  // not matching it reports the page as missing a declaration that is visibly
  // right there on the tag.
  for (const match of body.matchAll(/\sdata-component=("([^"]*)"|'([^']*)')/g)) {
    const slug = (match[2] !== undefined ? match[2] : match[3]).trim();
    if (slug) declared.add(slug);
  }

  return {
    missing: expected
      .filter(page => !declared.has(styleguideSlug(page.htmlPath)))
      .map(page => `  ${page.title} — cms/${page.filename}`),
    // The digest drifts both ways: a component that is removed or drafted
    // leaves its section behind, presenting something the system no longer has.
    //
    // Checked against every page the build produces, not just the pages the
    // gate requires. `styleguide-exempt` means a page need not appear — it has
    // never meant it must not, and scoping this to the required set would turn
    // the opt-out into a ban (CLAUDE.md §8). The same allowance covers showing
    // a docs-site or brand component here deliberately.
    stale: [...declared]
      .filter(slug => !known.has(slug))
      .map(slug => `  data-component="${slug}" — no cms page produces this`),
    // A styleguide that declares nothing at all is not a passing styleguide.
    // Without this the gate is satisfied by an empty file, since `missing` is
    // the only other thing standing between it and a green build.
    empty: declared.size === 0,
  };
}

// ── Page types ──
//
// What a page IS, which decides which chrome it gets. One table, read by every
// emitter — no emitter decides chrome inline, so the answer to "does this kind
// of page have a pager?" is in exactly one place.
//
// Declared per page with an optional `type:` frontmatter field. Absent means
// `doc`, which is what all but a handful of pages are; an invalid value fails
// the build the way an invalid `layer:` does.
//
//   header    the Page Header component
//   stickyBar 'full' = breadcrumb + .md dropdown + close; false = none
//   toc       the on-this-page rail, and with it the 2-column content grid
//   pager     prev/next through the reading order
//   chrome    feedback block + footer
//   frame     'grid' = the 1080px content grid; 'wide' = full measure;
//             'free' = no frame at all, the body brings its own layout
//   article   whether the framed body is wrapped in <article>. Off for the two
//             listing types: a shelf of covers or a contents list is
//             navigation, not a composition, and every prose rule scoped to
//             `.docs-main > article` would otherwise reach it. Meaningless on
//             a free frame, which emits no wrapper at all, so those say false
//   body      'markdown' | 'html' — 'html' skips markdownToHtml entirely
//
// `shelf` and `contents` are assigned by the generator for the pages it builds
// itself (home, section indexes). They are in the table because the renderer
// keys on them, not because anyone authors them.
const PAGE_TYPES = {
  shelf:    { level: 0, header: true,  stickyBar: false,  toc: false, pager: false, chrome: true,  frame: 'grid', article: false, body: 'markdown' },
  contents: { level: 1, header: true,  stickyBar: false,  toc: false, pager: false, chrome: true,  frame: 'grid', article: false, body: 'markdown' },
  doc:      { level: 2, header: true,  stickyBar: 'full', toc: true,  pager: true,  chrome: true,  frame: 'grid', article: true,  body: 'markdown' },
  page:     { level: 2, header: true,  stickyBar: 'full', toc: false, pager: true,  chrome: true,  frame: 'wide', article: true,  body: 'html' },
  // The loosest type on purpose. A tool can look like anything; its only
  // requirement is that the reader can get out, which is the data-page-close
  // contract enforced at build time — not chrome this emits.
  tool:     { level: 2, header: false, stickyBar: false,  toc: false, pager: false, chrome: false, frame: 'free', article: false, body: 'html' },
  bare:     { level: null, header: false, stickyBar: false, toc: false, pager: false, chrome: false, frame: 'free', article: false, body: 'html' },
};

/**
 * Element motion (assets/js/bd-animate.js): the attributes every generated
 * surface carries, chosen by the owner on 2026-10-14 from
 * experiments/motion.html and recorded in handovers/HANDOVER-motion.md.
 * One table, so a change is one edit and every emitter reads it; the
 * engine's doc page (cms/bd-animate.md) is the vocabulary. Nothing in a doc
 * body animates but demo frames, figures and scrolling tables: headings,
 * paragraphs, lists and code stay still, by the owner's word.
 *
 * Each value is an attribute string ready to drop into an opening tag.
 * `enter` plays once as the page arrives (held behind the curtain on a hard
 * load, during the slide on a swap); `animate` reveals on scroll; a
 * `stagger` parent sequences its direct animated children; a `replay`
 * parent plays its entrances when its state class turns on. A sticky bar
 * only ever fades: a transform on a sticky element re-anchors it. A sticky
 * element never takes `animate` (a scroll reveal): bdAnimateFreeze finishes
 * entrances before the router holds sticky elements, not reveals, and a
 * reveal ending mid-transition clears the hold's inline translate.
 */
const MOTION = {
  headerGroup: ' data-bd-stagger',
  headerPart: ' data-bd-enter="slide-up"',
  bar: ' data-bd-enter="fade"',
  shelf: ' data-bd-stagger="4"',
  cover: ' data-bd-animate="slide-up"',
  contents: ' data-bd-stagger="4"',
  contentsItem: ' data-bd-animate="slide-up"',
  tocList: ' data-bd-stagger',
  tocItem: ' data-bd-enter="fade"',
  pager: ' data-bd-animate="slide-up"',
  block: ' data-bd-animate="slide-up"',
  // The article re-measures its reveals when its height changes (a demo
  // collapsed above an unrevealed table would otherwise leave it waiting
  // for a start line that moved).
  article: ' data-bd-refresh',
  sidebarGroup: ' data-bd-stagger',
  sidebarItem: ' data-bd-enter="slide-up"',
  // The tool canvas (cms/tool-canvas.md), stamped at build time by
  // stampToolMotion so a tool author writes none of it.
  toolCanvas: ' data-bd-stagger',
  toolPreview: ' data-bd-enter="scale"',
  toolDockEnd: ' data-bd-enter="slide-left"',
  toolDockBottom: ' data-bd-enter="slide-up"',
  // Fades, never slides: the actions ride inside the dock, which already
  // travels in, and a slide inside a slide moved them twice (Phase 5 of
  // the micro-interactions track, handovers/HANDOVER-micro-interactions.md).
  toolActions: ' data-bd-enter="fade"',
  toolPanel: ' data-bd-replay="open"',
  toolPanelBody: ' data-bd-stagger',
  toolPanelChild: ' data-bd-enter="slide-up"',
};

// Tags that never close, so the walker below does not wait for them.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// An attribute list: quoted values may hold `>`, so `[^>]*` is not enough.
const ATTRS = '(?:"[^"]*"|\'[^\']*\'|[^\'">])*';
// The two end tags HTML lets an author omit that occur in prose and lists:
// an open <p> is closed by the next block, an open <li> by the next <li>.
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);

function classTokens(attrs) {
  const m = attrs.match(/\sclass\s*=\s*"([^"]*)"/);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

/**
 * Walk the opening tags of an HTML string with a stack of open ancestors,
 * and let `decide({ name, attrs, cls, parent, ancestors })` return the
 * attributes to add to a tag ('' leaves it). Comments and the bodies of
 * <script> and <style> are skipped whole; a void or self-closing tag is a
 * child without depth; a closing tag pops to the nearest open element of
 * its name, so an omitted end tag is closed by its ancestor's rather than
 * stranding the walk. Classes are read as tokens, never by attribute
 * order: the search pass rewrites `<div class="demo-preview">` to
 * `<div data-pagefind-ignore class="demo-preview">`, which is exactly the
 * kind of thing an order-sensitive match misses in silence. Regex, not a
 * DOM: the tool bodies are hand-authored and a parser round-trip would
 * rewrite their formatting.
 */
function stampTags(html, decide) {
  const TAG = new RegExp('<!--[\\s\\S]*?-->|<(script|style)\\b' + ATTRS + '>[\\s\\S]*?<\\/\\1\\s*>|<(\\/?)([a-zA-Z][\\w-]*)(' + ATTRS + ')>', 'g');
  const stack = [];
  const inserts = [];
  let tag;
  while ((tag = TAG.exec(html)) !== null) {
    if (tag[0].startsWith('<!--') || tag[1]) continue;
    const closing = tag[2] === '/';
    const name = tag[3].toLowerCase();
    const attrs = tag[4];
    if (closing) {
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && ((top.name === 'p' && CLOSES_P.has(name)) || (top.name === 'li' && name === 'li'))) stack.pop();
    const selfClosed = /\/\s*$/.test(attrs) || VOID_TAGS.has(name);
    const entry = { name, attrs, cls: classTokens(attrs) };
    const add = decide({ ...entry, parent: stack[stack.length - 1] || null, ancestors: stack });
    if (add) {
      // Before the closing `>`, or before a self-closing `/>`.
      const slash = attrs.search(/\/\s*$/);
      inserts.push({ at: slash >= 0 ? tag.index + 1 + tag[3].length + slash : tag.index + tag[0].length - 1, add });
    }
    if (!selfClosed) stack.push(entry);
  }
  let out = '';
  let last = 0;
  inserts.forEach(({ at, add }) => {
    out += html.slice(last, at) + add;
    last = at;
  });
  return out + html.slice(last);
}

// An element that already says how it moves, or that it does not
// (`data-bd-enter="none"`), is the author's: the stamping leaves it alone.
function authored(attrs) {
  return /\sdata-bd-(enter|animate|text)(?=[\s=\/]|$)/.test(attrs);
}

/**
 * The tool canvas's motion, stamped on a tool body at build time (the table
 * above): the canvas sequences its bar, preview, docks and actions; each
 * accordion panel replays its body's direct children when it opens. A panel
 * that is not an accordion item has no state to replay on, so its children
 * join the page cascade instead. A child that renders nothing (a script, a
 * template, `hidden`, the system's own hidden states) or that must not be
 * touched (a live region) takes no entrance.
 */
function stampToolMotion(html) {
  return stampTags(html, ({ name, attrs, cls, parent }) => {
    if (authored(attrs)) return '';
    if (cls.includes('tool-canvas')) return MOTION.toolCanvas;
    if (cls.includes('tool-actions')) return MOTION.toolActions;
    if (cls.includes('tool-panel') && cls.includes('accordion-item')) return MOTION.toolPanel;
    if (cls.includes('tool-panel-body')) return MOTION.toolPanelBody;
    if (parent && parent.cls.includes('tool-canvas')) {
      if (cls.includes('bar')) return MOTION.bar;
      if (cls.includes('tool-preview')) return MOTION.toolPreview;
      if (cls.includes('tool-dock')) return /\sdata-edge="bottom"/.test(attrs) ? MOTION.toolDockBottom : MOTION.toolDockEnd;
      return '';
    }
    if (parent && parent.cls.includes('tool-panel-body')) {
      if (name === 'template' || name === 'br' || name === 'wbr') return '';
      if (/\shidden(?=[\s=\/]|$)/.test(attrs) || cls.includes('is-hidden') || cls.includes('visually-hidden')) return '';
      if (/\srole="(status|alert|log)"|\saria-live=/.test(attrs)) return '';
      return MOTION.toolPanelChild;
    }
    return '';
  });
}

/**
 * The body's reveals (the table above): demo frames, figures and scrolling
 * tables, and nothing else. A figure or table inside a demo frame is left
 * to the frame, so nothing reveals twice.
 */
function stampBodyMotion(html) {
  return stampTags(html, ({ name, attrs, cls, ancestors }) => {
    if (authored(attrs)) return '';
    if (cls.includes('demo-preview')) return MOTION.block;
    if (name === 'figure' || cls.includes('table-scroll')) {
      return ancestors.some((a) => a.cls.includes('demo-preview')) ? '' : MOTION.block;
    }
    return '';
  });
}

/**
 * A silent miss is the failure mode here (the search pass once hid every
 * frame from an order-sensitive match), so a body that holds a surface the
 * table names must come out carrying it.
 */
function assertStamped(html, re, what, where) {
  const tags = html.match(re) || [];
  const missed = tags.filter((tag) => !/\sdata-bd-/.test(tag));
  if (missed.length) {
    throw new Error(`${where}: ${missed.length} of ${tags.length} ${what} came out with no data-bd-* attribute: ${missed[0].slice(0, 80)}`);
  }
}

const DEFAULT_PAGE_TYPE = 'doc';
/**
 * The PAGE_TYPES table itself, inlined as a JSON block by {{page-types}}.
 *
 * This exists so the Page Layouts wireframe draws from the real table rather
 * than a copy of it. The wireframe was built against a hand transcription and
 * carried a comment saying it would drift — the same way the chrome matrix
 * drifted out of page-layouts.md within four days of being copied there. A
 * generated block cannot drift: it is the object.
 *
 * Only the chrome fields ship. `base`, `source` and each region's prose are
 * presentation the page owns, have no counterpart here, and so cannot fall
 * out of step with anything.
 *
 * Small enough to inline (well under 1 KB) and wanted on one page, so it
 * follows {{icon-manifest}} rather than extraScripts — renderIconManifest
 * writes that trade-off out in full.
 *
 * @returns {string} a JSON script block
 */
function renderPageTypes() {
  // \u003c keeps "</script>" out of the block whatever a future field holds
  const json = JSON.stringify(PAGE_TYPES).replace(/</g, '\\u003c');
  return `<script type="application/json" id="page-types">${json}</script>`;
}

/**
 * Resolve a page's type preset, then apply the per-page overrides.
 *
 * The overrides are the escape hatch that keeps a type a default rather than a
 * cage. Three of the four already existed and were read by generatePage;
 * `chrome` is new, and is what lets a framed tool keep its footer and feedback
 * block without the `tool` type forcing them on every tool.
 *
 * Frontmatter values are strings, so these compare against the literal 'false'
 * / 'true' — only an explicit flag flips the preset.
 */
function resolvePageType(frontmatter = {}) {
  const name = frontmatter.type || DEFAULT_PAGE_TYPE;
  // hasOwnProperty, not a truthiness test on the lookup: `type: "constructor"`
  // (or toString, valueOf, …) finds a function on Object.prototype, passes a
  // plain `if (!preset)` check, and spreads to nothing — producing
  // data-level="undefined" and no chrome from a typo the gate exists to catch.
  if (!Object.prototype.hasOwnProperty.call(PAGE_TYPES, name)) return null;
  const preset = PAGE_TYPES[name];

  const resolved = { ...preset, name };
  if (frontmatter.toc === 'false') resolved.toc = false;
  if (frontmatter.bar === 'false') resolved.stickyBar = false;
  if (frontmatter.bar === 'true') resolved.stickyBar = 'full';
  if (frontmatter.pagination === 'false') resolved.pager = false;
  if (frontmatter.chrome === 'false') resolved.chrome = false;
  if (frontmatter.chrome === 'true') resolved.chrome = true;
  // header can be opted into as well as out of, because `tool` hard-codes it
  // off — which is why five tools used to hand-draw the same page header.
  if (frontmatter.header === 'false') resolved.header = false;
  if (frontmatter.header === 'true') resolved.header = true;
  return resolved;
}

// ── Spaces ──
//
// The values a page's chrome takes from where it lives. Since brand spaces
// were removed (phase 0, P0-4) there is one space, the site itself; the
// descriptor stays because every emitter already reads it, and a second
// space would again be a change here, not a fork of every emitter.

const ROOT_SPACE = {
  key: null,
  manifest: ROOT_MANIFEST,
  // Which space rendered this page, as an attribute (data-space) nav.js reads
  // to keep a non-root space out of the site's search. Empty for the site.
  spaceAttr: '',
  slugPrefix: '',
  footerText: () => SITE.footerText,
  defaultsDir: () => DOCS_DIR,
};

/**
 * {{logo-spec:<id>}} on a line of its own, outside fenced code (``` or ~~~,
 * any length, indented or not, closed only by the same mark at least as
 * long), so a doc can show the block as an example. A malformed id stops the
 * build rather than staying on the page as text.
 */
function expandLogoSpecs(markdown) {
  let fence = null; // { mark, length } while inside a fenced block
  return markdown.split('\n').map((line) => {
    const opener = line.match(/^[^\S\n]*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence.mark && opener[1].length >= fence.length && !line.slice(opener[0].length).trim()) fence = null;
      return line;
    }
    if (opener) { fence = { mark: opener[1][0], length: opener[1].length }; return line; }
    const block = line.match(/^[^\S\n]*\{\{logo-spec:([^}]*)\}\}[^\S\n]*$/);
    if (!block) return line;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(block[1])) {
      console.error(`\n❌ {{logo-spec:${block[1]}}}: a logo id is lower-case and hyphenated, as brand.json writes it.\n`);
      process.exit(1);
    }
    return renderLogoSpecFigure(block[1]);
  }).join('\n');
}

/**
 * The figure {{logo-spec:<id>}} expands to. logo-spec.js draws it in the
 * browser from the logo manifest; the caption is filled there too, from the
 * logo's measured X, so no number is written into the page.
 */
function renderLogoSpecFigure(id) {
  const known = BRAND ? BRAND.logos.variants.map((v) => v.id) : [];
  if (!known.includes(id)) {
    console.error(`\n❌ {{logo-spec:${id}}}: ${BRAND ? `brand.json has no logo "${id}" (it has ${known.join(', ')})` : 'the site has no brand.json'}.\n`);
    process.exit(1);
  }
  return `<figure class="logo-spec border border-faded" data-logo-spec="${id}">
  <div class="logo-spec-stage"></div>
  <figcaption class="logo-spec-caption text-size-small text-secondary"></figcaption>
</figure>`;
}

/**
 * Fill the page template's slots. Every page the generator writes goes through
 * here — home, section indexes, doc pages, the brand book, brand overviews.
 *
 * Callers build their own content and pass finished strings; this function
 * knows the slot names and nothing about what a page means. That is the point:
 * adding a slot to the template is a change here and nowhere else.
 *
 * Replacements use function values throughout. A plain string replacement
 * treats `$&`, `$'` and `` $` `` in the *replacement* as patterns, so a page
 * whose content happened to contain them would silently corrupt itself.
 */
function renderPage(template, {
  space,
  navBase,
  // The home page links its assets with a bare relative path but sets NAV_BASE
  // to './' — an empty NAV_BASE would turn a dynamic import('{{NAV_BASE}}…')
  // into a bare module specifier. The two bases are therefore not always equal.
  assetBase = null,
  title,
  description = '',
  header = '',
  stickyBar = '',
  content = '',
  toc = '',
  frame = 'grid',
  article = true,
  pageNav = '',
  access,
  scripts = '',
  sectionSlug,
  pageSection,
  order,
  level,
  chrome: hasChrome = true,
  // Sidebar start state for this page. nav.js reads data-sidebar-default and
  // matches the literal 'collapsed'; a user's saved preference still wins.
  sidebar = null,
  containerExtra = '',
  // Whether the site search indexes this page. Engine pages are in by default;
  // a brand instance's pages are out (a prospect's search must never surface
  // another tenant — ROADMAP, "Per-instance search indexes"), and a page can
  // opt out with `search: "false"` in frontmatter. Both indexes key on the one
  // this emits, so there is no second exclusion list to keep in step.
  searchable = space.key === null,
}) {
  const assets = assetBase === null ? navBase : assetBase;
  // The indexes are one file every team reader fetches, so a page above team
  // never enters them: its text would reach the team through search when the
  // page itself refuses them (security audit, 2026-11-08, finding 2).
  const indexed = searchable && (access === 'public' || access === 'team');
  const sectionLabel = indexed ? sectionLabelFromSlug(pageSection) : '';
  const searchMeta = sectionLabel
    ? `    <meta data-pagefind-filter="section[content]" data-pagefind-meta="section[content]" content="${escapeAttr(sectionLabel)}">\n`
    : '';
  const chrome = brandChromeSlots(space.manifest, assets);

  // {{PAGE_BODY}} is filled LAST, and the order matters.
  //
  // .replace() with a string needle takes the first occurrence in the document.
  // Every other slot sits either side of the body in the template, so if the
  // body went in first, a page whose *content* contained a slot token would
  // have the page's own copy substituted and the real slot left as a literal
  // {{PAGE_NAV}} in the shipped HTML. That is not hypothetical here: this
  // generator's own documentation page prints template tokens in code fences.
  // Filling the body last means every real slot is already gone, and whatever
  // the content says stays text. markdownToHtml makes the same move for
  // {{icon:}} by skipping <code> and <pre>.
  //
  // {{NAV_BASE}} is the one exception left — it is replaceAll, so a doc quoting
  // it verbatim still gets it rewritten. Nothing does, and the alternative is
  // sentinels for a case that has not come up.
  return template
    // Text, never markup: a title or site name with "<" or "&" stays as written
    .replaceAll('{{PAGE_TITLE}}', () => escapeAttr(title))
    .replaceAll('{{META_DESCRIPTION}}', () => description)
    .replace('{{SEARCH_META}}', () => searchMeta)
    .replace('{{MAIN_ATTRS}}', () => (indexed ? ' data-pagefind-body' : ''))
    .replace('{{PAGE_HEADER}}', () => header)
    .replace('{{PAGE_STICKY_BAR}}', () => stickyBar)
    .replace('{{DESIGN_SYSTEM_PATH}}', () => prefixHref(assets, PROJECT_CONFIG.designSystemPath))
    .replace('{{BRAND_CSS}}', () => brandCssLink(assets))
    .replace('{{SPACE_ATTR}}', () => space.spaceAttr)
    .replace('{{FONT_HEAD}}', () => fontHeadHtml(space.manifest, navBase))
    .replace('{{PAGE_NAV}}', () => pageNav)
    .replace('{{PAGE_CHROME}}', () => hasChrome ? buildPageChrome(space.footerText()) : '')
    .replace('{{FAVICON_LINKS}}', () => chrome.faviconLinks)
    .replace('{{OG_IMAGE}}', () => chrome.ogImage)
    .replace('{{PAGE_ACCESS}}', () => access)
    .replace('{{PAGE_SCRIPTS}}', () => scripts)
    // replaceAll: these are page-scoped constants, and the router's container
    // attributes are appended to a site's own containerAttrs, which may use
    // them too — a single .replace() would let chrome injected earlier in
    // the document steal the one substitution and leave the container
    // carrying literal tokens.
    .replaceAll('{{SECTION_SLUG}}', () => sectionSlug)
    .replaceAll('{{PAGE_SECTION}}', () => pageSection)
    .replaceAll('{{PAGE_ORDER}}', () => String(order))
    .replaceAll('{{PAGE_LEVEL}}', () => String(level))
    .replace('{{CONTAINER_EXTRA}}', () => containerExtra)
    .replace('{{LAYOUT_ATTRS}}', () => sidebar ? ` data-sidebar-default="${escapeAttr(sidebar)}"` : '')
    .replace('{{NAV_SOURCE}}', () => (navSourceHtml ? `\n      <div id="site-nav-source" hidden>${navSourceHtml}</div>` : ''))
    .replaceAll('{{NAV_BASE}}', () => navBase)
    .replace('{{PAGE_BODY}}', () => buildPageBody({ frame, content, toc, article }));
}

/**
 * The feedback block and footer, emitted into {{PAGE_CHROME}}.
 *
 * Kept together because they are one decision: either a page ends with the
 * site's closing furniture or it does not. `tool` pages default to not.
 */
/**
 * The page body — content, and the frame around it, emitted into {{PAGE_BODY}}.
 *
 * `free` returns the content untouched. That is the whole point of the `tool`
 * type: no measured grid, no article wrapper, nothing between <main> and the
 * markup the tool wrote.
 *
 * `wide` is the same grid as `doc` with its max-width lifted (docs-site.css
 * §1, `.docs-content-grid[data-width="wide"]`), so a custom body can use the
 * full column while keeping the page's padding and rhythm.
 */
function buildPageBody({ frame, content, toc = '', article = true }) {
  if (frame === 'free') return content;

  const widthAttr = frame === 'wide' ? ' data-width="wide"' : '';
  // The listing types drop the <article>: a shelf or a contents list is
  // navigation, and the element would announce it as a composition to a
  // screen reader while inviting prose rules scoped to it to leak in. The
  // table decides (PAGE_TYPES.article); this only obeys.
  const body = article
    ? `<article${MOTION.article}>
                    ${content}
                </article>`
    : content;
  return `<div class="docs-content-grid padding-global"${widthAttr}>
            <!-- Main Content -->
            <div class="docs-main">
                ${tocDropdown(toc)}
                ${body}
            </div>

            <!-- Table of Contents -->
            ${tocAside(toc)}
        </div>`;
}

/**
 * The feedback form's markup. In the shipped package it sits in the kit's
 * assets/feedback/; in this repo, which is where it is edited, it is
 * cms/chrome/. One source either way: scripts/build-package.js copies the
 * latter into the former. A missing partial with the flag on fails the build,
 * because a bar item that opens nothing is worse than no form.
 */
function readFeedbackPartial(kitName, sourceName) {
  const candidates = [
    path.join(KIT_ASSETS, 'feedback', kitName),
    path.join(__dirname, '..', 'chrome', sourceName),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.error(`❌ feedback is on but its markup is missing (looked for ${candidates.join(' and ')}) — reinstall the docs-kit package.`);
    process.exit(1);
  }
  return fs.readFileSync(found, 'utf8');
}

/**
 * The feedback dialog as this site shows it. The follow-up switch, between
 * its `<!-- follow-up -->` markers, stays on the engine home only: a client
 * site's feedback never carries a name or an email, so it offers no
 * follow-up (PC-9). A partial that has lost its markers fails the build
 * rather than ship the switch to a client. `engineHome` is this site's
 * brand by default; scripts/verify-feedback-dialog.js passes it.
 */
function feedbackDialogHtml(html, engineHome = Boolean(BRAND && BRAND.slug === brandFile.ENGINE_HOME_SLUG)) {
  if (engineHome) return html.replace(/[ \t]*<!-- \/?follow-up -->\n?/g, '');
  const cut = html.replace(/[ \t]*<!-- follow-up -->[\s\S]*?<!-- \/follow-up -->\n?/, '');
  if (cut === html || /feedback-follow-up/.test(cut)) {
    console.error('❌ the feedback dialog has no <!-- follow-up --> block to remove — reinstall the docs-kit package.');
    process.exit(1);
  }
  return cut;
}

let _extraContentHtml = null;
// The engine's one credit line (P0-3), on a client site's footer only: By
// Default's own site is the engine's home and needs none. Its text is the
// engine's, exactly as written here; the wording checks admit this string
// and no other By Default mention (brand.js ENGINE_CREDIT).
function engineCreditHtml() {
  if (!BRAND || BRAND.slug === brandFile.ENGINE_HOME_SLUG) return '';
  return `\n                    <p class="text-size-small text-secondary" data-engine-credit>${brandFile.ENGINE_CREDIT}</p>`;
}

/** The page's closing chrome. `footerText` is the brand's plain text, escaped here. */
function buildPageChrome(footerText) {
  // Icons are expanded here, not inherited from the template's pre-pass. This
  // block used to be substituted into the template before that pass ran; now
  // it is injected per page afterwards, so it has to expand its own. Cached
  // rather than computed at module load, because the icon map is built at the
  // start of generateDocs and is empty before then.
  if (_extraContentHtml === null) {
    const feedbackBlock = CONFIG.feedback ? readFeedbackPartial('block.html', 'feedback.html') : '';
    _extraContentHtml = (CONFIG.extraContentHtml + feedbackBlock)
      .trimEnd()
      .replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name));
  }

  return `${_extraContentHtml}

        <footer class="footer">
            <div class="footer-inner">
                <div class="footer-bottom" data-layout="center">
                    <p class="text-size-small text-secondary">${escapeAttr(String(footerText || ''))}</p>${engineCreditHtml()}
                </div>
            </div>
        </footer>`;
}

/**
 * Wrap a table of contents in the docs-toc aside. Empty in, empty out.
 * Both TOC renderings are emitted by buildPageBody from the same raw list;
 * docs-site.css §8 shows exactly one of them, keyed on content-area width.
 */
// Authored blocks that are UI, not prose. A swatch list indexes as "off-white
// Hex CSS brown Hex CSS" and a demo preview indexes its own sample copy, so a
// search for "off-white" or a demo's placeholder text would match the page that
// merely displays it. The names inside them still reach the symbol index, which
// reads them deliberately.
//
// Matched on the class, not on attribute order: `<div data-theme="dark"
// class="demo-preview">` is as valid as the other way round, and an
// order-sensitive rewrite silently misses it. A swatch grid is a <ul>, so
// the element is matched as well as the class.
const SEARCH_IGNORED_BLOCKS = ['demo-preview', 'swatch-grid'];
const SEARCH_IGNORE_RE = new RegExp(
  `<(div|ul)(?![^>]*data-pagefind-ignore)((?:\\s[^>]*)?\\sclass="[^"]*\\b(?:${SEARCH_IGNORED_BLOCKS.join('|')})\\b)`,
  'g'
);

function markSearchIgnoredBlocks(html) {
  return html.replace(SEARCH_IGNORE_RE, '<$1 data-pagefind-ignore$2');
}

function tocAside(tableOfContents) {
  if (!tableOfContents) return '';
  return `<aside class="docs-toc" data-pagefind-ignore>
      <span class="toc-header">On this page</span>
      <div class="toc-wrapper">${tableOfContents}</div>
    </aside>`;
}

/**
 * The narrow-state TOC: a disclosure at the top of the article column,
 * directly under the sticky breadcrumb bar. Same list markup as the aside;
 * the aside, being later in the DOM, keeps the scroll-position highlighting
 * (template.html keys links by heading id — last copy wins), which a closed
 * disclosure has no use for anyway.
 */
function tocDropdown(tableOfContents) {
  if (!tableOfContents) return '';
  return `<details class="docs-toc-dropdown" data-pagefind-ignore>
      <summary>On this page</summary>
      <div class="disclosure-content">${tableOfContents}</div>
    </details>`;
}

/**
 * Generate index page HTML
 */
/**
 * The home header a site supplies (config: indexHeader). It stands in for the
 * standard page header, so it owes the page what that one gives it: an h1.
 */
function renderIndexHeader() {
  const html = CONFIG.indexHeader({ title: SITE_HTML.name, description: SITE_HTML.description });
  if (typeof html !== 'string' || !/<h1[\s>]/i.test(html)) {
    throw new Error('indexHeader must return the home header as an HTML string that holds the page\'s <h1>');
  }
  return html;
}

function generateIndexPage(template, filesBySection) {
  let cards = '';

  if (CONFIG.indexCards) {
    // Curated index (config: indexCards): one card per entry in a 2-column grid
    cards = `<div class="docs-section">
      <div class="book-shelf"${MOTION.shelf}>`;

    // The shelf shows art only when every card has it: a half-illustrated
    // shelf reads as broken, so art is added one card at a time without
    // showing until the last one lands. And no two neighbours share a hue,
    // or the shelf reads as one band (D18).
    // A section this site doesn't install has no card (D14)
    const shelf = CONFIG.indexCards.filter((card) => {
      const folder = String(card.href || '').replace(/^\//, '').split('/')[0];
      return !appsRegistry.sectionOff(INSTALL, folder);
    });
    const missingArt = shelf.filter(card => !card.osIllustration).map(card => card.title);
    const illustrated = missingArt.length === 0;
    if (!illustrated && missingArt.length < shelf.length) {
      console.warn(`Home shelf renders plain covers: no osIllustration on ${missingArt.join(', ')}`);
    }
    // Every declared drawing is resolved whether or not the shelf shows it,
    // so a bad slug or hue fails at the commit that wrote it, not on the day
    // the last card lands.
    const hues = shelf.map(card => {
      const art = resolveOsIllustration(card, `book cover "${card.title}"`);
      return art ? art.color : '';
    });
    if (illustrated) {
      hues.forEach((hue, i) => {
        if (i && hue === hues[i - 1]) {
          console.warn(`Home shelf: "${shelf[i - 1].title}" and "${shelf[i].title}" are neighbours in the same hue (${hue})`);
        }
      });
    }

    for (const card of shelf) {
      cards += `
        ${renderBookCover({ ...card, access: card.access || levelOf(card.href), osIllustration: illustrated ? card.osIllustration : '', headingLevel: 2 })}`;
    }

    cards += `
      </div>
    </div>`;
  } else {
    // Default index: pages grouped by section, one card per page
    const defaults = loadDefaults(DOCS_DIR);
    const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
    const sortedSections = Object.keys(filesBySection).sort((a, b) => {
      const indexA = sectionOrder.indexOf(a);
      const indexB = sectionOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

    for (const section of sortedSections) {
      const files = [...filesBySection[section]].sort((a, b) => {
        const orderA = a.frontmatter.order || 999;
        const orderB = b.frontmatter.order || 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title);
      });

      cards += `<div class="docs-section">
      <h2 class="book-shelf-title">${section}</h2>
      <div class="book-shelf"${MOTION.shelf}>`;
      for (const file of files) {
        cards += `
        ${renderBookCover({ href: file.htmlPath, title: file.title, subtitle: file.frontmatter.subtitle, access: deriveDataAccess(file.frontmatter) })}`;
      }
      cards += `
      </div>
    </div>`;
    }
  }

  const indexContent = cards;

  const access = deriveDataAccess(loadDefaults(DOCS_DIR));
  // The shelf is an index: the gate opens it to every signed-in reader, and
  // the cards on it lock by what the reader may open (permissions-plan.md
  // §3.2). Its level is fixed at team - a generated page has no frontmatter,
  // and _defaults.md cannot open a page (the map's banner says so).
  pageAccess.set('/index.html', { level: 'team', section: '', type: 'shelf', title: 'Home' });

  // Home lives at the repo root, so its NAV_BASE is the current directory.
  // It must be './' not '' — an empty base turns the GoTrue dynamic
  // import('{{NAV_BASE}}assets/...') into a bare module specifier, which
  // throws "Failed to resolve module specifier" and breaks auth (the home
  // page is data-access="team"), causing a login redirect loop.
  return renderPage(template, {
    space: ROOT_SPACE,
    navBase: './',
    assetBase: '',
    title: 'Home',
    description: SITE_HTML.description,
    // A site can supply its own home header (config: indexHeader). It must
    // carry the page's h1, as the standard header does.
    header: CONFIG.indexHeader
      ? renderIndexHeader()
      : buildPageHeaderHtml({ title: SITE_HTML.name, subtitle: SITE_HTML.description }),
    content: indexContent,
    access,
    sectionSlug: 'home',
    pageSection: 'home',
    order: 0,
    level: PAGE_TYPES.shelf.level,
    frame: PAGE_TYPES.shelf.frame,
    article: PAGE_TYPES.shelf.article,
    chrome: PAGE_TYPES.shelf.chrome,
  });
}

/**
 * The Tools index's bookshelf: a cover per page, opening the tool a guide
 * names (guideTarget), with the tool's drawing when every cover has one.
 */
function renderToolsShelf(files, section) {
  const covers = files.map((file) => {
    const target = guideTarget(file, section);
    return { file, target, art: pageOsIllustration(file.frontmatter, file) };
  });
  const missingArt = covers.filter((c) => !c.art.osIllustration).map((c) => c.file.title);
  const illustrated = missingArt.length === 0;
  if (!illustrated && missingArt.length < covers.length) {
    console.warn(`Tools shelf renders plain covers: no os-illustration for ${missingArt.join(', ')}`);
  }
  let html = `<div class="docs-section"><div class="book-shelf"${MOTION.shelf}>`;
  for (const { file, target, art } of covers) {
    html += `
        ${renderBookCover({
          href: target.href,
          title: file.title,
          subtitle: file.frontmatter.subtitle,
          access: target.access,
          headingLevel: 2,
          ...(illustrated ? art : {}),
        })}`;
  }
  return `${html}
      </div></div>`;
}

/**
 * Generate a section overview page with card grid
 */
function generateSectionIndexPage(section, template, files, filesBySection) {
  const sectionFolder = SECTION_FOLDERS[section];
  if (!sectionFolder) return null;

  // docs-site pages are hidden here (sectionIndexFiles). An app-layer page
  // misfiled into a portable section is a content error for review to catch,
  // not for the index to hide.
  files = sectionIndexFiles(files);

  // Sort files by order
  const sorted = [...files].sort((a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });

  let cards = '';

  // Tools is a bookshelf on every site (Erlen, 2026-11-10): one cover per
  // tool, like the home shelf, and like it, art only when every cover has
  // some, so a half-illustrated shelf never ships. Each cover opens its tool.
  if (sectionFolder === 'tools') cards = renderToolsShelf(sorted, section);

  // Generic subsection grouping (works for all sections)
  const defaults = loadDefaults(DOCS_DIR);
  const subsectionOrder = getSubsectionOrder(defaults, section);
  const ungrouped = cards ? [] : sorted.filter(f => !f.frontmatter.subsection);
  const grouped = {};
  for (const file of cards ? [] : sorted) {
    const sub = file.frontmatter.subsection;
    if (sub) {
      if (!grouped[sub]) grouped[sub] = [];
      grouped[sub].push(file);
    }
  }

  // Ungrouped files first
  if (ungrouped.length > 0) {
    cards += `<div class="docs-section"><div class="book-contents"${MOTION.contents}>`;
    for (const file of ungrouped) {
      // Absolute href so the link resolves correctly from any depth and survives
      // Barba transitions that don't update the chrome's data-base.
      // A guide that names its tool opens the tool, at the tool's level
      // (guideTarget), as the sidebar link does.
      const { href: cardHref, access: cardAccess } = guideTarget(file, section);
      cards += renderBookContentsItem({
        href: cardHref,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        access: cardAccess,
        meta: audienceTag(cardAccess),
        headingLevel: 2,
      });
    }

    cards += `</div></div>`;
  }

  // Subsections in configured order
  const subs = Object.keys(grouped).sort((a, b) => {
    const idxA = subsectionOrder.indexOf(a);
    const idxB = subsectionOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const sub of subs) {
    // The id is what a doc page's subsection crumb lands on. It goes on the
    // h2, not the .docs-section div: §39B's scroll-margin-top covers
    // headings, main and section, so a div would land under the sticky bar.
    const groupEntries = grouped[sub].map((file) => { const t = guideTarget(file, section); return { level: t.access, path: t.href }; });
    cards += `<div class="docs-section"${accessAnyAttr(groupEntries)}><h2 class="book-contents-title" id="${subsectionAnchorId(sub)}">${sub}</h2><div class="book-contents"${MOTION.contents}>`;
    for (const file of grouped[sub]) {
      const target = guideTarget(file, section);
      cards += renderBookContentsItem({
        href: target.href,
        title: file.title,
        subtitle: file.frontmatter.subtitle,
        access: target.access,
        meta: audienceTag(target.access),
      });
    }
    cards += `</div></div>`;
  }

  const navBase = '../';

  // Section's index in the global sectionOrder — used by the level-based
  // transition system to resolve L1 → L1 sibling navigation (e.g. clicking
  // Design System overview while on Brand Book overview slides forward).
  // Mirrors the same default chain buildPageOrder uses (line ~790).
  const sectionDefaults = loadDefaults(DOCS_DIR);
  const globalSectionOrder = parseList(sectionDefaults['section-order'], DEFAULT_SECTION_ORDER);
  const sectionIndex = globalSectionOrder.indexOf(section);
  const sectionOrderValue = sectionIndex === -1 ? 999 : sectionIndex;
  const homeCard = homeCardForSection(sectionFolder) || {};

  // A contents page is an index: open to every signed-in reader, cards
  // locked by what they may open (permissions-plan.md §3.2) - at its
  // section's level when the section sets one (indexLevel). Generated pages
  // have no frontmatter, and _defaults.md cannot open a page.
  const level = indexLevel(sectionFolder);
  if (level !== 'team') levelsFromSection.push(`${sectionFolder}/index.html -> ${level} (sectionAccess.${sectionFolder})`);
  pageAccess.set(`/${sectionFolder}/index.html`, {
    level,
    section: sectionFolder,
    type: 'contents',
    title: section,
  });

  return renderPage(template, {
    space: ROOT_SPACE,
    navBase,
    title: `${section} - Overview`,
    description: `Overview of all ${section} pages.`,
    // The section's home card carries its description, art and hue. The
    // header shows the art whatever the shelf decided (the shelf rule is about
    // a half-illustrated row, which a single header is not), so a section's
    // contents page has its art from the commit that declared it.
    header: buildPageHeaderHtml({
      title: section,
      subtitle: homeCard.subtitle,
      illustration: resolveOsIllustration(homeCard, `${section} index`),
    }),
    // Off since 2026-10-15 (owner): a contents page is an overview the reader
    // arrives at from the sidebar or the shelf, and the bar above it carried
    // only a close to home and a Copy link. The sidebar and the header logo
    // are the way back. Flip the preset to bring it back.
    //
    // No .md source behind a generated index, so the dropdown carries Copy link
    // alone — buildBar omits the markdown items when mdHref is null. No trail
    // either: the trail starts at the section, so here it would be the
    // current page alone, linking nowhere.
    stickyBar: PAGE_TYPES.contents.stickyBar
      ? buildBar({
          crumbs: [],
          closeHref: siteHref('/index.html'),
          closeLabel: 'Home',
        })
      : '',
    content: cards,
    // The page's level, which also keeps an index above team out of search.
    access: level,
    sectionSlug: `${slugifySection(section)}-overview`,
    pageSection: slugifySection(section),
    order: sectionOrderValue,
    level: PAGE_TYPES.contents.level,
    frame: PAGE_TYPES.contents.frame,
    article: PAGE_TYPES.contents.article,
    chrome: PAGE_TYPES.contents.chrome,
  });
}

/**
 * Build a flat ordered list of all pages following the nav order
 */
function buildPageOrder(filesBySection) {
  const defaults = loadDefaults(DOCS_DIR);
  const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
  const hiddenSections = [];
  const sortedSections = Object.keys(filesBySection)
    .filter(s => !hiddenSections.includes(s))
    .sort((a, b) => {
    const indexA = sectionOrder.indexOf(a);
    const indexB = sectionOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  const sortByOrder = (a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  };

  const ordered = [];
  for (const section of sortedSections) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    // Ungrouped files first (no subsection), matching nav sidebar order
    const ungrouped = files.filter(f => !f.frontmatter.subsection).sort(sortByOrder);
    ordered.push(...ungrouped);

    // Then subsection groups in configured order
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }
    const subsections = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const sub of subsections) {
      ordered.push(...grouped[sub].sort(sortByOrder));
    }
  }
  return ordered;
}

/**
 * Build a per-section sidebar position map for Phase 3 directional transitions.
 *
 * Returns an object keyed by `file.htmlPath` whose value is the file's integer
 * position within its own section's sidebar list. Position 0 is reserved for
 * the section's "Overview" link, so real files start at position 1.
 *
 * The walk mirrors `buildNavSectionsHtml` exactly — section sort order, files
 * sorted by frontmatter.order, ungrouped files before subsection groups,
 * subsections in configured order. Using a single function for both the map
 * and the nav HTML would be cleaner, but the sidebar already has enough
 * responsibilities; a separate walk is easier to reason about.
 *
 * Tool app links: the sidebar renders the app URL (derived from actionUrl),
 * not file.htmlPath. We key the map by file.htmlPath because that's what the
 * destination doc page's container looks up. Clicked sidebar links use the
 * integer written directly into their `data-order` attribute, so the two
 * paths stay consistent.
 */
function buildSidebarOrderMap(filesBySection) {
  const defaults = loadDefaults(DOCS_DIR);
  const map = {};

  const sortByOrder = (a, b) => {
    const orderA = a.frontmatter.order || 999;
    const orderB = b.frontmatter.order || 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  };

  for (const section of Object.keys(filesBySection)) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    let pos = 1; // 0 is the Overview link

    // Ungrouped files first
    const ungrouped = files.filter(f => !f.frontmatter.subsection).sort(sortByOrder);
    for (const file of ungrouped) {
      map[file.htmlPath] = pos++;
    }

    // Then subsection groups in configured order
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }
    const subs = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const sub of subs) {
      for (const file of grouped[sub].sort(sortByOrder)) {
        map[file.htmlPath] = pos++;
      }
    }
  }

  return map;
}

/**
 * Generate prev/next navigation HTML for a page
 */
function generatePageNav(file, pageOrder) {
  const index = pageOrder.findIndex(p => p.filename === file.filename);
  if (index === -1) return '';

  const prev = index > 0 ? pageOrder[index - 1] : null;
  const next = index < pageOrder.length - 1 ? pageOrder[index + 1] : null;

  if (!prev && !next) return '';

  // Compute relative href from current file's folder to target file
  function relativeHref(target) {
    const fromFolder = file.htmlFolder || '';
    const toFolder = target.htmlFolder || '';
    if (fromFolder === toFolder) return target.htmlName;
    if (fromFolder && !toFolder) return '../' + target.htmlName;
    if (!fromFolder && toFolder) return target.htmlPath;
    return '../' + target.htmlPath;
  }

  /**
   * One markup shape for both directions — the arrow always leads, and
   * data-direction="next" reverses the row in CSS. The section line renders
   * only when the target sits in a different section, marking the move from
   * one book to the next.
   *
   * The title is a span, not a heading: it labels a link rather than opening
   * a section, and two h3s in the page footer would put phantom entries in
   * the document outline that screen-reader users navigate by.
   *
   * @param {string} direction - "prev" or "next"
   * @param {object} target    - the page being linked to
   * @param {string} label     - visible eyebrow ("Previous" / "Next")
   * @param {string} arrow     - rendered arrow icon
   *
   * Every link carries the target's level as data-access and a lock icon,
   * hidden until nav.js marks the link .is-locked for a reader who cannot
   * open it - signed out on a public page, a guest whose groups do not reach
   * it, a team member next to an admin page. The level is each page's own
   * access field, the same one that writes worker/page-access.mjs, so a link
   * never looks open and then meets the locked page.
   */
  function renderLink(direction, target, label, arrow) {
    // Truthiness matters as well as inequality: a page with no `section` in
    // frontmatter yields '', and '' !== 'Docs' would emit an empty span that
    // still draws a gap inside the column flex container.
    const sectionLabel = target.section && target.section !== file.section
      ? `<span class="page-nav-section">${target.section}</span>`
      : '';
    return `<a href="${relativeHref(target)}" class="page-nav-link" data-direction="${direction}" rel="${direction}" data-access="${normaliseLevel(target.ownAccess)}">
      ${arrow}${lock}
      <span class="page-nav-text">
        <span class="page-nav-label">${label}</span>
        ${sectionLabel}
        <span class="page-nav-title">${target.title}</span>
      </span>
    </a>`;
  }

  const arrowLeft = `<span class="svg-icn page-nav-arrow">${getRawIcon('chevron-left-large')}</span>`;
  const arrowRight = `<span class="svg-icn page-nav-arrow">${getRawIcon('chevron-right-large')}</span>`;
  const lock = lockIcon('page-nav-lock');

  // No placeholder for a missing neighbour: grid-column pins each link to its
  // own half, so the surviving link keeps its side on its own.
  let html = '<nav class="page-nav" aria-label="Page navigation"><div class="page-nav-inner"' + MOTION.pager + '>';
  if (prev) html += renderLink('prev', prev, 'Previous', arrowLeft);
  if (next) html += renderLink('next', next, 'Next', arrowRight);
  html += '</div></nav>';
  return html;
}

/**
 * Build footer text from project config (shared by internal and brand docs).
 * A brand manifest's footerText overrides the site default.
 */
function buildFooterHtml(override) {
  return override || SITE.footerText || '';
}

/**
 * The opening block of every page the generator writes — documentation pages,
 * the brand book, the site home, section overviews and brand overviews.
 *
 * It is the Page Header component (design-system.css §44), emitted into
 * {{PAGE_HEADER}}. That slot sits inside the page's <main> and outside the
 * content grid, which is what the component expects: full bleed, with
 * .page-header-container supplying the measure.
 *
 * One function for all seven call sites on purpose. Before this there were
 * seven copies of the same markup — four emitting a `.docs-hero` into the page
 * content and three emitting `<div class="page-header"><div class="container-s">`
 * — and they had already drifted: two carried a description and two did not,
 * one carried an eyebrow, two carried an action link in a `.button-group`
 * rather than the component's own actions slot.
 *
 * No data-text-wrap on the subtitle: §44 sets text-wrap on
 * .page-header-subtitle itself and wins the specificity tie on source order,
 * so the attribute would be inert and imply behaviour that does not happen.
 */
function buildPageHeaderHtml({ title, subtitle = '', eyebrow = '', actions = '', flipId = '', illustration = null } = {}) {
  if (!title) return '';
  const flipAttr = flipId ? ` data-flip-id="${escapeAttr(flipId)}"` : '';
  const parts = [];
  if (eyebrow) parts.push(`<p class="eyebrow"${MOTION.headerPart}>${eyebrow}</p>`);
  parts.push(`<h1 class="page-header-title"${flipAttr}${MOTION.headerPart}>${title}</h1>`);
  if (subtitle) parts.push(`<p class="page-header-subtitle"${MOTION.headerPart}>${subtitle}</p>`);
  if (actions) parts.push(`<div class="page-header-actions"${MOTION.headerPart}>${actions}</div>`);
  // The cascade's group is whichever element holds the parts directly.
  // An os-illustration beside the text (§43). The .page-header-content
  // wrapper is part of the slot's contract: the CSS lays the two out as
  // columns, so it is emitted with the slot and only with the slot. The hue
  // on the header becomes its field and text colour.
  if (illustration) {
    return `<header class="page-header" data-align="center"${osIllustrationAttrs(illustration)}>
      <div class="page-header-container">
        <div class="page-header-content"${MOTION.headerGroup}>
          ${parts.join('\n          ')}
        </div>
        <div class="page-header-illustration">${illustration.svg}${renderOsIllustrationPause(illustration)}</div>
      </div>
    </header>`;
  }
  return `<header class="page-header" data-align="center">
      <div class="page-header-container"${MOTION.headerGroup}>
        ${parts.join('\n        ')}
      </div>
    </header>`;
}

/**
 * A glossary term's drawing: the os-illustration named after its slug, when
 * one exists (the import names the glossary drawings by term). Coloured as a
 * page header is: the drawing's authored hue, else the Glossary home card's,
 * so a drawing with no authored hue still renders in the section's colour.
 * Null when the term has none, which keeps its page and drawer as they were.
 * @param {string} slug - the entry's slug, cms/glossary/<slug>.md
 * @returns {{ svg: string, color: string, field: string, motion: boolean } | null}
 */
/**
 * Every drawing a page already takes: what pageOsIllustration resolves for
 * each cms/*.md (its source name, a -docs page's tool, or a frontmatter
 * os-illustration), plus each home card's. Built once and cached.
 */
let claimedOsIllustrationsCache = null;
function claimedOsIllustrations() {
  if (claimedOsIllustrationsCache) return claimedOsIllustrationsCache;
  const claimed = new Set((CONFIG.indexCards || []).map(c => c.osIllustration).filter(Boolean));
  for (const filename of docFilenames()) {
    const { frontmatter } = parseFrontmatter(readPageSource(docSource(filename)));
    const art = pageOsIllustration(frontmatter, { filename });
    if (art.osIllustration) claimed.add(art.osIllustration);
  }
  claimedOsIllustrationsCache = claimed;
  return claimed;
}

function glossaryOsIllustration(slug) {
  if (!hasOsIllustration(slug)) return null;
  // A drawing that already belongs to a page is that page's art, not the
  // term's: a doc page claims it by its source name (cms/<slug>.md) and a
  // home card by its osIllustration. Glossary art is drawn for the glossary
  // in its own hue, so `tabs` or `typography` don't borrow a component cover
  // in another colour (Kobbie, 2026-11-05).
  if (claimedOsIllustrations().has(slug)) return null;
  const card = (CONFIG.indexCards || []).find(c => c.href === `/${GLOSSARY_FOLDER}.html`);
  return resolveOsIllustration(
    { osIllustration: slug, fallbackHue: card ? card.hue : '' },
    `cms/${GLOSSARY_FOLDER}/${slug}.md`
  );
}

/**
 * The art strip at the top of a glossary entry (docs-site.css, "Art strip"):
 * the term's hue painted edge to edge, the drawing centred at the strip's
 * height. The entry page emits it before the page header; the reading drawer
 * lifts its contents into its own strip (glossary.js), so one builder serves
 * both. data-os-illustration-loop makes an animated drawing loop while on
 * screen with its pause button, as a page header's does (os-illustration.js).
 */
function buildGlossaryArtHtml(illustration) {
  if (!illustration) return '';
  const loop = illustration.motion ? ' data-os-illustration-loop' : '';
  return `<div class="glossary-art"${osIllustrationAttrs(illustration)}${loop}>${illustration.svg}${renderOsIllustrationPause(illustration)}</div>
        `;
}

/**
 * The core Breadcrumb component (design-system.css §18) for a bar. Empty when
 * the trail is the current page alone — a crumb that only names the page you
 * are on links nowhere and repeats the heading.
 *
 * @param {Array<{label: string, href?: string}>} crumbs section first, current last
 */
function buildBreadcrumb(crumbs) {
  if (!crumbs || crumbs.length < 2) return '';
  const separator = '<span class="breadcrumb-separator" aria-hidden="true">/</span>';
  const items = crumbs.map((crumb, i) => {
    if (i === crumbs.length - 1) {
      return `<li class="breadcrumb-item"><span aria-current="page">${crumb.label}</span></li>`;
    }
    const label = crumb.href ? `<a href="${crumb.href}">${crumb.label}</a>` : `<span>${crumb.label}</span>`;
    return `<li class="breadcrumb-item">${label}${separator}</li>`;
  });
  // A trail with a middle crumb carries the overflow item at position two,
  // hidden until breadcrumb.js finds the labels no longer fit. A disclosure
  // of links (cms/dropdown.md), so no menu roles and no aria-haspopup.
  if (crumbs.length > 2) {
    items.splice(1, 0, `<li class="breadcrumb-item breadcrumb-overflow" hidden><div class="dropdown"><button class="dropdown-trigger" type="button" aria-expanded="false" aria-label="More levels">${getIcon('ellipsis')}</button><div class="dropdown-menu"></div></div>${separator}</li>`);
  }
  return `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <ol class="breadcrumb-list">
              ${items.join('\n              ')}
            </ol>
          </nav>
        `;
}

/**
 * The page bar — breadcrumb, markdown-source dropdown, and the close
 * that takes the reader back up a level. Emitted into {{PAGE_STICKY_BAR}}.
 *
 * One function for both spaces. The root and brand generators each carried a
 * full copy of this markup and had already drifted apart in whitespace; a
 * change to the dropdown had to be made twice or the two spaces disagreed.
 *
 * @param {Array<{label: string, href?: string}>} crumbs
 *                                   the trail, section first, current page
 *                                   last. A crumb with no href is plain text;
 *                                   the last is always the current page
 * @param {string}      closeHref    where the close points (absolute)
 * @param {string}      closeLabel   what the close goes back to, for its label
 * @param {string|null} mdHref       markdown source; null omits the .md items,
 *                                   which is what a project without a served
 *                                   markdownSourceBase needs
 */
function buildBar({ crumbs, closeHref, closeLabel, mdHref = null, width = 'docs' }) {
  // role="presentation" on the wrapper: role="menu" may only own menu items,
  // groups and separators, and this div exists purely to carry the auth gate.
  // Presentation hands its children straight to the menu. One divider, where
  // the kind of item changes (the page's link, then its markdown source) —
  // not one between every item; the tools' overflow menu follows the same rule.
  const mdSourceItems = mdHref ? `<div data-auth-role="team" role="presentation">
                <div class="dropdown-divider" role="separator"></div>
                <a href="${mdHref}" class="dropdown-item js-md-download" role="menuitem" download>
                  ${getIcon('download')}
                  <span>Download .md file</span>
                </a>
                <a href="${mdHref}" class="dropdown-item js-md-open" role="menuitem" target="_blank" rel="noopener noreferrer">
                  ${getIcon('external-link')}
                  <span>Open .md in new tab</span>
                </a>
              </div>` : '';

  // The order inside .bar-actions is the component's universal rule: content,
  // actions, overflow, close — close last, because it is the terminal cell
  // (design-system.css §41). No role="toolbar" here: this bar carries a
  // breadcrumb, and the class names the box while the role names the contents.
  const widthAttr = width ? ` data-width="${width}"` : '';
  return `<div class="bar" data-density="regular"${widthAttr} data-sticky="true" data-pagefind-ignore${MOTION.bar}>
      <div class="bar-container">
        <div class="bar-content">${buildBreadcrumb(crumbs)}</div>
        <div class="bar-actions">
          <div class="dropdown">
            <button class="dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Markdown source options">
              ${getIcon('ellipsis-large')}
            </button>
            <div class="dropdown-menu is-right" role="menu">
              <button type="button" class="dropdown-item js-copy-url" role="menuitem">
                ${getIcon('link')}
                <span>Copy link</span>
              </button>
              ${mdSourceItems}
              ${feedbackMenuItems()}
            </div>
          </div>
          <a href="${closeHref}" class="bar-close" data-page-close aria-label="Back to ${closeLabel}">
            ${closeIconHtml()}
          </a>
        </div>
      </div>
    </div>`;
}

/**
 * The two feedback items at the end of a bar's menu, when the site has the
 * feedback form on (CONFIG.feedback). Each opens the feedback
 * dialog (cms/chrome/feedback-dialog.html) through feedback.js, which listens
 * for [data-feedback-open] on the document. Tool bars author the same two
 * items in their own markup (cms/apps/*.html), as bar-groups the overflow
 * menu collects.
 */
function feedbackMenuItems() {
  if (!CONFIG.feedback) return '';
  return `<div class="dropdown-divider" role="separator"></div>
              <button type="button" class="dropdown-item" role="menuitem" data-feedback-open="share">
                ${getIcon('chat')}
                <span>Share feedback</span>
              </button>
              <button type="button" class="dropdown-item" role="menuitem" data-feedback-open="problem">
                ${getIcon('warning')}
                <span>Report a problem</span>
              </button>`;
}

/**
 * Build script tags for a page based on section and frontmatter.
 * - Any page can request additional scripts via the "scripts" frontmatter field.
 *   e.g. scripts: "splide, splide-auto-scroll"
 */
function buildPageScripts(section, frontmatter, navBase = '../') {
  const base = navBase;

  // Script registry — maps keywords to script tag paths (load order matters)
  const SCRIPT_REGISTRY = {
    // Third-party (per-page)
    'splide':           'https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js',
    'splide-auto-scroll': 'https://cdn.jsdelivr.net/npm/@splidejs/splide-extension-auto-scroll@0.5.3/dist/js/splide-extension-auto-scroll.min.js',
    'splide-intersection': 'https://cdn.jsdelivr.net/npm/@splidejs/splide-extension-intersection@0.2.0/dist/js/splide-extension-intersection.min.js',
  };

  const scripts = [];

  // Add per-page scripts from frontmatter (e.g. scripts: "splide")
  if (frontmatter.scripts) {
    const requested = frontmatter.scripts.split(',').map(s => s.trim().toLowerCase());
    for (const key of requested) {
      if (SCRIPT_REGISTRY[key] && !scripts.includes(SCRIPT_REGISTRY[key])) {
        scripts.push(SCRIPT_REGISTRY[key]);
      }
    }
  }

  if (scripts.length === 0) return '';

  return scripts.map(src => `    <script src="${src}" defer></script>`).join('\n');
}

/**
 * Generate page HTML
 */
// ── "Use in another product" appendix ──
// Core Design System components are consumable from the artefact package
// (see cms/setup.md). Each core component page gets a generated consumption
// block so the install command and the component's own artefacts are on the
// page where they're needed. The module list is shared with
// scripts/build-package.js via component-modules.json — a component whose
// JS ships in dist/js/ automatically gets its script include documented.
const COMPONENT_MODULES = require('./component-modules.json');
const { isPortableComponentPage, isBrandContent } = require('./portable');
const { loadGlossary, renderGlossaryList, renderTopicChips, entryAppendix, glossaryFeed, escapeHtml: escapeGlossaryText } = require('./glossary');

// The glossary (cms/glossary/), loaded once per run in generateDocs and read by
// generatePage for {{glossary-terms}}. Null when the directory does not exist.
let GLOSSARY = null;
const GLOSSARY_FOLDER = 'glossary';

// An alias pointing at a module that isn't shipped would silently fall back to
// "No JavaScript, nothing else to include" — the exact wrong claim the alias
// exists to prevent, on a page that needs a script to work at all. Fail loudly.
for (const [slug, moduleName] of Object.entries(COMPONENT_MODULES.moduleAliases || {})) {
  if (!COMPONENT_MODULES.modules.includes(moduleName)) {
    throw new Error(
      `component-modules.json: moduleAliases "${slug}" → "${moduleName}" is not in modules[]`
    );
  }
}

// A dependency the package does not ship would be a <script> tag that 404s
// on the page that tells a product what to include. Fail loudly here too.
for (const [slug, deps] of Object.entries(COMPONENT_MODULES.moduleDependencies || {})) {
  for (const dep of deps) {
    if (!COMPONENT_MODULES.modules.includes(dep)) {
      throw new Error(`component-modules.json: moduleDependencies "${slug}" → "${dep}" is not in modules[]`);
    }
  }
}

// An external library entry names files the product must source itself, so a
// malformed one would print a broken include block on the page that tells a
// product what to copy. Check the shape, and that the module it belongs to
// is one the package ships.
for (const [slug, entry] of Object.entries(COMPONENT_MODULES.externalScripts || {})) {
  const moduleName = (COMPONENT_MODULES.moduleAliases || {})[slug] || slug + '.js';
  if (!COMPONENT_MODULES.modules.includes(moduleName)) {
    throw new Error(`component-modules.json: externalScripts "${slug}" names a module that is not in modules[]`);
  }
  if (!entry || typeof entry.label !== 'string' || !Array.isArray(entry.scripts) || !entry.scripts.length) {
    throw new Error(`component-modules.json: externalScripts "${slug}" needs a label and a non-empty scripts[]`);
  }
}

// The React adapter names are advertised as importable on each component
// page, so an entry naming an export the package does not have would ship a
// copy-pasteable import that throws. Check against react/index.mjs.
const REACT_INDEX = require('path').join(__dirname, '..', '..', 'react', 'index.mjs');
if (require('fs').existsSync(REACT_INDEX)) {
  const exported = new Set(
    [...require('fs').readFileSync(REACT_INDEX, 'utf8').matchAll(/^export\s*\{([^}]+)\}/gm)]
      .flatMap((m) => m[1].split(','))
      .map((name) => name.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean)
  );
  for (const [slug, exportName] of Object.entries(COMPONENT_MODULES.reactAdapters || {})) {
    if (!exported.has(exportName)) {
      throw new Error(
        `component-modules.json: reactAdapters "${slug}" → "${exportName}" is not exported from react/index.mjs`
      );
    }
  }
}

function buildComponentUsage(file) {
  // Keyed on layer + filename, not section label (see portable.js) — the old
  // section gate would have silently dropped this block from every core page
  // the moment the section was renamed.
  if (!isPortableComponentPage(file.markdownPath, file.frontmatter)) return '';

  const slug = file.markdownPath.replace(/\.md$/, '');
  // Most components own a module named after themselves. Where two components
  // share one implementation (drawer rides on dialog.js), the alias map is what
  // stops the page claiming it needs no JavaScript at all.
  const moduleName = (COMPONENT_MODULES.moduleAliases || {})[slug] || slug + '.js';
  const cssName = slug + '.css';
  const hasJs = COMPONENT_MODULES.modules.includes(moduleName);
  const hasOwnCss = (COMPONENT_MODULES.componentCss || []).includes(cssName);
  const isHeadless = (COMPONENT_MODULES.headless || []).includes(moduleName);

  // Three style stories: companion file (ships as dist/css/<name>.css),
  // headless (no CSS at all), or the default (rules live in design-system.css).
  const stylesPart = hasOwnCss
    ? `This component's styles ship as \`dist/css/${cssName}\` — copy it into the product's served assets and link it after \`design-system.css\`.`
    : isHeadless
      ? engineWords(`This component ships no CSS — it is behaviour only.`)
      : `This component's styles ship in \`design-system.css\`.`;

  // A component whose behaviour leans on another module (Swatch's copy
  // actions are copy-button.js) lists that one first, so the include block a
  // product copies is complete.
  const deps = (COMPONENT_MODULES.moduleDependencies || {})[slug] || [];
  const scripts = deps.concat(moduleName);
  const shipsAs = scripts.map((name) => `\`dist/js/${name}\``).join(' and ');
  // A module that leans on a library the package does not ship (bd-animate
  // on GSAP) says so and lists the library's files first, so the include
  // block a product copies is complete rather than quietly short.
  const external = (COMPONENT_MODULES.externalScripts || {})[slug] || null;
  const externalPart = external ? ` It also needs ${external.label}, loaded before it.` : '';
  const includes = (external ? external.scripts : []).concat(scripts);
  const jsPart = hasJs
    ? `${stylesPart} ${engineWords('Its behaviour')} ships as ${shipsAs} — copy ${scripts.length > 1 ? 'them' : 'it'} into the product's served assets and include ${scripts.length > 1 ? 'each' : 'it'} once per page.${externalPart}

\`\`\`html
${includes.map((name) => `<script src="assets/js/${name}" defer></script>`).join('\n')}
\`\`\``
    : `${stylesPart} No JavaScript, nothing else to include.`;

  // A React product renders this contract through the packaged adapter
  // rather than by hand, so name it where the consumer is already standing.
  const adapterName = (COMPONENT_MODULES.reactAdapters || {})[slug];
  const reactPart = adapterName
    ? `

In React, render this contract through the packaged adapter instead of writing the markup by hand:

\`\`\`jsx
import { ${adapterName} } from '@bydefaultstudio/design-system/react';
\`\`\`

The adapter renders the contract above and bridges this component's events to props — see [React](/docs/react.html).`
    : '';

  return `

---

## Use in another product

The design system installs once per product:

\`\`\`bash
${COMPONENT_MODULES.install}
\`\`\`

${jsPart}${reactPart}
`;
}

/**
 * Fill the Glossary page's placeholders from cms/glossary/. Line-anchored like
 * {{icon-registry}}, so a mention inside prose stays text. A placeholder on a
 * page while the glossary directory is missing fails the build rather than
 * shipping the literal.
 */
function expandGlossaryPlaceholders(content, file) {
  // Comments are left alone: the page's own authoring note names the
  // placeholders, and must neither count as one nor be rewritten.
  const live = content.replace(/<!--[\s\S]*?-->/g, '');
  if (!/\{\{glossary-(terms|topics|count)\}\}/.test(live)) return content;
  if (!GLOSSARY) throw new Error(`cms/${file.filename} uses a {{glossary-}} placeholder, but cms/glossary/ does not exist`);
  const entryHref = slug => siteHref(`/${GLOSSARY_FOLDER}/${slug}.html`);
  for (const name of ['terms', 'topics']) {
    const line = new RegExp(`^[^\\S\\n]*\\{\\{glossary-${name}\\}\\}[^\\S\\n]*$`, 'm');
    if (live.includes(`{{glossary-${name}}}`) && !line.test(live)) {
      throw new Error(`cms/${file.filename}: {{glossary-${name}}} must sit on a line of its own`);
    }
  }
  return content.replace(
    /(<!--[\s\S]*?-->)|^[^\S\n]*\{\{glossary-(terms|topics)\}\}[^\S\n]*$|\{\{glossary-count\}\}/gm,
    (match, comment, block) => {
      if (comment) return match;
      if (block === 'terms') {
        return renderGlossaryList(GLOSSARY, entryHref, slug => {
          const art = glossaryOsIllustration(slug);
          return art ? art.color : '';
        });
      }
      if (block === 'topics') return renderTopicChips(GLOSSARY);
      return String(GLOSSARY.published.length);
    }
  );
}

/**
 * One page per published glossary entry, at /glossary/<slug>.html, plus the
 * feed at /glossary/index.json. A `doc` page in everything but source: the
 * short definition is the lede, the markdown body the article, related terms
 * and the source appended so they reach the TOC. The bar closes to the
 * Glossary index, which is where every entry is reached from.
 */
function generateGlossaryPages(template, glossary, level) {
  const type = PAGE_TYPES.doc;
  const dir = path.join(OUTPUT_DIR, GLOSSARY_FOLDER);
  const indexHref = siteHref('/glossary.html');
  // Root-relative, not `${slug}.html`: the reading drawer on /glossary.html
  // shows this article one folder up from where it was built.
  const entryHref = slug => siteHref(`/${GLOSSARY_FOLDER}/${slug}.html`);
  const topicHref = slug => siteHref(`/glossary.html?topic=${slug}`);
  fs.mkdirSync(dir, { recursive: true });

  // Entries that were published and no longer are must not linger as pages.
  // Only this emitter writes the folder, so anything else in it is stale.
  const keep = new Set(glossary.published.map(e => `${e.slug}.html`).concat('index.json'));
  for (const name of fs.readdirSync(dir)) {
    if (!keep.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }

  glossary.published.forEach((entry, position) => {
    const content = markdownToHtml(entry.body + entryAppendix(entry, glossary, entryHref, topicHref));
    // Escaped here, as the Showcase emitter does: renderPage and the header
    // and bar builders take their text as markup.
    const title = escapeGlossaryText(entry.title);
    const short = escapeGlossaryText(`${entry.short}.`);
    const html = renderPage(template, {
      space: ROOT_SPACE,
      navBase: '../',
      title,
      description: short,
      header: buildGlossaryArtHtml(glossaryOsIllustration(entry.slug)) + buildPageHeaderHtml({ title, subtitle: short }),
      stickyBar: buildBar({
        crumbs: [{ label: 'Glossary', href: indexHref }, { label: title }],
        closeHref: indexHref,
        closeLabel: 'Glossary',
      }),
      content,
      toc: generateTableOfContents(content),
      frame: type.frame,
      article: type.article,
      access: level,
      sectionSlug: GLOSSARY_FOLDER,
      pageSection: GLOSSARY_FOLDER,
      // Alphabetical position, so a hop between entries slides the way
      // the index reads (the router, barba-docs.js, compares data-order).
      order: position + 1,
      level: type.level,
      chrome: type.chrome,
    });
    fs.writeFileSync(path.join(dir, `${entry.slug}.html`), html);
    // No section, like a Showcase post: the glossary is one page with its
    // entries under it, not a docs section a guest is granted.
    pageAccess.set(`/${GLOSSARY_FOLDER}/${entry.slug}.html`, {
      level: effectiveBuildLevel(`/${GLOSSARY_FOLDER}/${entry.slug}.html`, level),
      section: '',
      type: 'doc',
      title: entry.title,
    });
  });

  const feed = glossaryFeed(glossary, slug => `/${GLOSSARY_FOLDER}/${slug}.html`);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(feed, null, 2) + '\n');
  // Not on the page map: that file holds .html pages only, so the feed falls
  // to the gate's default and stays team-only whatever the glossary's level.
  // Opening it is a deliberate line in PUBLIC_EXACT (worker/gate.mjs), made
  // when the glossary goes public (handovers/HANDOVER-glossary.md).
  console.log(`📄 Generated: ${GLOSSARY_FOLDER}/ (${glossary.published.length} entry pages + index.json)`);
}

/**
 * A raw HTML body (a `page`, a `bare` page): {{glossary-*}} fills, then the
 * {{icon:name}} and {{logo:id}} shorthands and the {{brand:key}} tokens. Each
 * stays literal inside <code>, <pre> and HTML comments, the same guard the
 * markdown path keeps: an expansion inside a comment injects markup and
 * breaks the comment open at the first `-->`. Nothing else touches the body.
 */
function expandHtmlBody(content, file) {
  const source = `cms/${file.filename}`;
  return expandGlossaryPlaceholders(content, file).replace(
    /(<code[^>]*>[\s\S]*?<\/code>)|(<pre[^>]*>[\s\S]*?<\/pre>)|(<!--[\s\S]*?-->)|\{\{icon:([a-z0-9-]+)\}\}|\{\{logo:([a-z0-9-]+)\}\}/g,
    (match, code, pre, comment, icon, logo) => {
      if (code || pre || comment) return match;
      return icon ? getIcon(icon) : brandLogoSvg(logo, source);
    }
  ).replace(/(<code[^>]*>[\s\S]*?<\/code>)|(<pre[^>]*>[\s\S]*?<\/pre>)|(<!--[\s\S]*?-->)|(\\?)\{\{brand:[a-zA-Z]+\}\}/g,
    (match, code, pre, comment) => ((code || pre || comment) ? match : expandBrandTokens(match, source, escapeAttr)));
}

/**
 * {{logo:<id>}}: one of the brand's logos inline, from brand.json, as the
 * sign-in page shows it (phase D). `primary` is the brand's primary logo. The
 * engine treats a logo as one-colour artwork that takes the text colour, the
 * way the Logo Tool recolours it, so every paint but `none` becomes
 * currentColor: the mark follows light and dark like the type around it. It
 * is decoration (aria-hidden): the element around it names it, with
 * brandLogoName(). A site with no brand logos gets that name in text instead.
 *
 * The file is cleaned by brand.js inlineLogoSvg, through the svg-cleaner
 * core's sanitiser (the vendored copy every tool loads), never local
 * regexes: what goes, and why, is written there.
 */
function brandLogoSvg(id, source) {
  const logos = BRAND && BRAND.logos;
  if (!logos || !Array.isArray(logos.variants) || !logos.variants.length) {
    return `<span class="text-size-xlarge">${escapeAttr(brandLogoName())}</span>`;
  }
  const wanted = id === 'primary' ? logos.primary : id;
  const variant = logos.variants.find((v) => v.id === wanted) || (id === 'primary' ? logos.variants[0] : null);
  if (!variant) {
    console.error(`\n❌ ${source}: {{logo:${id}}} isn't one of the brand's logos (it has primary, ${logos.variants.map((v) => v.id).join(', ')}).\n`);
    process.exit(1);
  }
  const file = path.resolve(ROOT, variant.file);
  if (!fs.existsSync(file)) {
    console.error(`\n❌ ${source}: {{logo:${id}}} names ${variant.file}, which doesn't exist.\n`);
    process.exit(1);
  }
  try {
    return brandFile.inlineLogoSvg(brandFile.readSvg(file), svgSanitiser().sanitiseSVG);
  } catch (err) {
    if (!(err instanceof brandFile.InlineLogoError)) throw err;
    console.error(`\n❌ ${source}: {{logo:${id}}} names ${variant.file}, which can't be inlined: ${err.message}.\n`);
    process.exit(1);
  }
}

/**
 * The name the brand's logo carries, one source for the {{logo:}} text
 * fallback and the sign-in page's label ({{brand:name}}): the brand's name,
 * else the site's.
 */
function brandLogoName() {
  return siteTokens().name || SITE.name;
}

/** The svg-cleaner core, from the package's vendored copy (never edited here). */
let SVG_SANITISER = null;
function svgSanitiser() {
  if (!SVG_SANITISER) {
    const core = path.join(APP_REGISTRY.filesRoot, 'assets', 'js', 'vendor', 'svg-cleaner-core.js');
    if (!fs.existsSync(core)) {
      console.error(`\n❌ The svg-cleaner core isn't in the package (${core}), so the brand's logo can't be cleaned for the page. Reinstall the package.\n`);
      process.exit(1);
    }
    SVG_SANITISER = require(core);
  }
  return SVG_SANITISER;
}

/**
 * Sign out for a browser with no JavaScript (PD-3), where the account menu
 * never draws: a plain link to the gate's sign-out address, which signs out
 * a click on the site's own page (auth.js handleSignOutLink). Only where the
 * access gate is on; empty otherwise. In the docs template it is on every
 * page, and docs-site.css hides it on a public one (body[data-access]),
 * whose reader is likely signed out; a public bare page leaves it out.
 */
function noscriptSignOut() {
  if (!CONFIG.accessGate) return '';
  const href = siteHref(appsRegistry.ENGINE_PATHS.signOut);
  // A landmark of its own: with no JavaScript there is no header, and this
  // is the whole of it
  return `<noscript><nav class="noscript-account" aria-label="Account"><a class="button" data-variant="text" href="${escapeAttr(href)}">Sign out</a></nav></noscript>`;
}

/**
 * Where this site serves one of the UI scripts, for a page outside the docs
 * template: the path in the site's own uiScripts list, else the kit's copy,
 * which applyTemplateChrome has already put in assets/docs-kit/. Null when
 * neither has it.
 */
function uiScriptPath(fileName) {
  const name = (src) => String(src).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
  const own = CHROME.uiScripts.find((src) => name(src) === fileName.toLowerCase());
  if (own) return own;
  if (KIT_UI_SCRIPTS.includes(fileName)) {
    copyKitAsset(`js/${fileName}`, path.join(OUTPUT_DIR, 'assets', 'docs-kit', fileName));
    return `assets/docs-kit/${fileName}`;
  }
  return null;
}

/**
 * The scripts a bare page loads after nav.js: the locale's runtime, on a
 * site whose locale isn't en-GB (bd-locale.js), dropdown.js (the header's
 * menus), the brand's settings, then the page's own, by file name in its
 * `scripts:` frontmatter. A name is the site's UI script of that name, or
 * one of the access gate's own files (apps.js GATE_FILES); anything else
 * stops the build, because a door page with a missing script is a door that
 * doesn't open. Not deferred, at the end of body, as the pages always were.
 */
function bareScriptTags(file, navBase) {
  const source = `cms/${file.filename}`;
  const srcs = [];
  const take = (src) => { if (src && !srcs.includes(src)) srcs.push(src); };
  if (CONVERT_LOCALE) take(LOCALE_SCRIPT);
  take(uiScriptPath('dropdown.js'));
  if (BRAND) take(CONFIG.brandOutputs.themeConfig);
  const gateFiles = CONFIG.accessGate ? [...appsRegistry.GATE_FILES.everyPage, ...appsRegistry.GATE_FILES.pages] : [];
  for (const raw of parseList(file.frontmatter.scripts)) {
    const fileName = /\.js$/i.test(raw) ? raw : `${raw}.js`;
    if (!/^[a-z0-9-]+\.js$/i.test(fileName)) {
      console.error(`\n❌ ${source}: scripts names "${raw}". A bare page names a script by its file name, such as auth-login.js.\n`);
      process.exit(1);
    }
    const gate = gateFiles.find((rel) => rel.endsWith(`/${fileName}`));
    const src = gate || uiScriptPath(fileName);
    if (!src) {
      console.error(`\n❌ ${source}: scripts names ${fileName}, which is neither one of this site's UI scripts nor ${CONFIG.accessGate ? 'one of the access gate\'s files' : 'available without the access gate (accessGate: true)'}.\n`);
      process.exit(1);
    }
    take(src);
  }
  return srcs.map((src) => `<script src="${prefixHref(navBase, src)}"></script>`).join('\n    ');
}

/**
 * The tags that describe a bare page when its address is shared: canonical,
 * Open Graph and the X card. A bare page is often the one a reader is sent
 * (Ask for access, a walkthrough), so it says what it is: absolute URLs when
 * the config knows the site's origin (siteUrl), relative ones otherwise. A
 * page's own `ogImage` replaces the brand's.
 */
function shareMetaHtml({ title, description, htmlPath, ogImage, navBase }) {
  const fullTitle = `${title} - ${SITE.name}`;
  const image = ogImage || (ROOT_MANIFEST && ROOT_MANIFEST.ogImage) || '/assets/images/og/og-default.jpg';
  const absolute = (href) => (/^(https?:)?\/\//.test(href) ? href
    : CONFIG.siteUrl && href.startsWith('/') ? CONFIG.siteUrl + siteHref(href)
      : prefixHref(navBase, href.replace(/^\//, '')));
  const pageUrl = CONFIG.siteUrl ? `${CONFIG.siteUrl}${siteHref('/' + htmlPath)}` : null;
  const lines = [];
  if (pageUrl) lines.push(`<link rel="canonical" href="${escapeAttr(pageUrl)}">`);
  lines.push('<meta property="og:type" content="website">');
  if (pageUrl) lines.push(`<meta property="og:url" content="${escapeAttr(pageUrl)}">`);
  lines.push(`<meta property="og:title" content="${escapeAttr(fullTitle)}">`);
  lines.push(`<meta property="og:description" content="${escapeAttr(description)}">`);
  lines.push(`<meta property="og:image" content="${escapeAttr(absolute(image))}">`);
  lines.push(`<meta property="og:site_name" content="${escapeAttr(SITE.name)}">`);
  lines.push('<meta name="twitter:card" content="summary_large_image">');
  lines.push(`<meta name="twitter:title" content="${escapeAttr(fullTitle)}">`);
  lines.push(`<meta name="twitter:description" content="${escapeAttr(description)}">`);
  lines.push(`<meta name="twitter:image" content="${escapeAttr(absolute(image))}">`);
  return `<!-- Sharing -->\n    ${lines.join('\n    ')}`;
}

/**
 * A `bare` page (PD-1): the shared template outside the docs layout, with
 * the page's own body in main. The body is raw HTML, expanded as a `page`
 * body is, its links checked against their levels like every page's.
 */
function generateBarePage(file, bareTemplate) {
  const { frontmatter, content } = file;
  // Depth-relative, as every page's links are, unless the override asks
  // for site-absolute ones
  const navBase = file.base || (file.htmlFolder ? '../' : './');
  const access = deriveDataAccess(frontmatter);
  // A bare page has no sidebar and no account menu, so under 'locked'
  // nothing paints a lock from a link's level: the attribute would promise a
  // marking that never comes. Under 'hidden' the Worker reads it to cut the
  // link, so it stays. The links are checked either way.
  const body = stampBodyLinks(expandHtmlBody(content, file), '/' + file.htmlPath, access, { mark: CONFIG.accessNav === 'hidden' });
  // Searchable as any page is: a door that is public or team-level, unless it opts out
  const indexed = frontmatter.search !== 'false' && (access === 'public' || access === 'team');
  const chrome = brandChromeSlots(ROOT_SPACE.manifest, navBase);
  const title = frontmatter.title || 'Untitled';
  // The description names the site the way the body does ({{brand:key}})
  const description = expandBrandTokens(frontmatter.description || '', `cms/${file.filename}`);
  return bareTemplate
    // Text, never markup: a title or site name with "<" or "&" stays as written
    .replaceAll('{{PAGE_TITLE}}', () => escapeAttr(title))
    .replace('{{META_DESCRIPTION}}', () => escapeAttr(description))
    .replace('{{SHARE_META}}', () => shareMetaHtml({ title, description, htmlPath: file.htmlPath, ogImage: frontmatter.ogImage, navBase }))
    .replace('{{FAVICON_LINKS}}', () => chrome.faviconLinks)
    .replace('{{DESIGN_SYSTEM_PATH}}', () => prefixHref(navBase, PROJECT_CONFIG.designSystemPath))
    .replace('{{FONT_HEAD}}', () => fontHeadHtml(ROOT_SPACE.manifest, navBase))
    .replace('{{BRAND_CSS}}', () => brandCssLink(navBase))
    .replace('{{PAGE_ACCESS}}', () => access)
    // A public bare page is a door: its reader is signed out
    .replace('{{NOSCRIPT_SIGN_OUT}}', () => (access === 'public' ? '' : noscriptSignOut()))
    .replace('{{MAIN_ATTRS}}', () => (indexed ? ' data-pagefind-body' : ''))
    .replace('{{BARE_SCRIPTS}}', () => bareScriptTags(file, navBase))
    .replaceAll('{{NAV_BASE}}', () => navBase)
    .replace('{{PAGE_BODY}}', () => body);
}

function generatePage(file, template, pageOrder, sidebarOrderMap = {}, subsectionHeadings = {}) {
  const { frontmatter, content } = file;

  // The page type decides which chrome this page gets; the per-page flags in
  // frontmatter override the preset. Validated in generateDocs, so an unknown
  // type has already failed the build by the time we get here.
  const type = resolvePageType(frontmatter);

  // `html` bodies skip markdownToHtml entirely. Its post-passes rewrite markup
  // unconditionally — <table> becomes .table-scroll > table.table, <pre><code>
  // gains a copy button, inline <code> gets chipified — which is right for
  // prose and wrong for a hand-written page body. {{icon:name}} still expands:
  // the expansion normally lives inside markdownToHtml, so it is done here for
  // the bodies that skip it — the same parity the pair renderer keeps for
  // tools, and what building-a-page.md promises for every HTML body. The guard
  // matches the markdown path's: the shorthand stays literal inside <code>,
  // <pre>, and HTML comments — an expansion inside a comment injects the
  // fallback's own comment markers and breaks the comment open at the first
  // `-->`, spilling the remainder into the rendered page.
  // {{glossary-terms}} and {{glossary-count}} fill the Glossary page from
  // cms/glossary/. Done before the icon pass: the rows carry {{icon:}}
  // shorthand for their chevrons.
  let htmlContent = type.body === 'html'
    ? expandHtmlBody(content, file)
    : markdownToHtml(content + buildComponentUsage(file), `cms/${file.filename}`, file.headingIds);

  // Apply drop cap to first paragraph if enabled in frontmatter
  if (frontmatter.dropcap === 'true') {
    htmlContent = htmlContent.replace(/<p>/, '<p class="drop-cap">');
  }

  const access = deriveDataAccess(frontmatter);
  htmlContent = stampBodyLinks(htmlContent, '/' + file.htmlPath, access);
  const tableOfContents = type.toc ? generateTableOfContents(htmlContent) : '';

  // Generate full-width page header (lives outside the content grid)
  const actionUrl = frontmatter.actionUrl || frontmatter.toolUrl;
  const actionLabel = frontmatter.actionLabel || frontmatter.toolLabel || 'Open';
  const actionLinkHtml = actionUrl
    ? `<a href="${siteHref(actionUrl)}" class="button page-action-link" data-size="small">${actionLabel}</a>`
    : '';
  pageHeader = type.header ? buildPageHeaderHtml({
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    actions: actionLinkHtml,
    flipId: flipIdFromHref(file.htmlName),
    // The drawing named after the page, or what frontmatter declares.
    illustration: resolveOsIllustration(pageOsIllustration(frontmatter, file), `cms/${file.filename}`),
  }) : '';

  // Page depth drives every relative href; folderless pages sit at output
  // root. A filenameOverrides entry with `base: '/'` makes every href
  // site-absolute instead, for the one page the Worker serves at other
  // pages' URLs (cms/locked.md), where a depth-relative asset path would
  // resolve under the wrong folder.
  const navBase = file.base || (file.htmlFolder ? '../' : './');

  // Generate sticky sub-header bar (breadcrumb + markdown dropdown)
  //
  // Root pages close to home. They belong to no section by design — an
  // explicit filenameOverrides entry with folder '' keeps them at the output
  // root and out of every section index, and the nav reaches them through
  // rootLinks — so there is no section index to go back to. Before this they
  // got no bar at all, which left the Glossary as the one page on the
  // site with no way out and no pager: reachable, and then a dead end.
  //
  // The trail is section / subsection / page. A root page has no section, so
  // its trail would be the page alone and buildBreadcrumb omits it; the close
  // still takes it home. The subsection crumb lands on its heading on the
  // section index, or is plain text when that index gives it no heading.
  let pageSubbar = '';
  if (type.stickyBar && frontmatter.title) {
    const sectionHref = file.htmlFolder
      ? siteHref(`/${file.htmlFolder}/index.html`)
      : siteHref('/index.html');
    const sectionLabel = file.htmlFolder
      ? (file.section || file.htmlFolder.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '))
      : 'Home';
    const crumbs = [];
    if (file.htmlFolder) {
      crumbs.push({ label: sectionLabel, href: sectionHref });
      const sub = frontmatter.subsection;
      if (sub) {
        // Linked only when the heading exists and sits on the index this
        // page's folder closes to — a page filed into another section's
        // folder would otherwise link to an index without that heading.
        const headed = file.htmlFolder === SECTION_FOLDERS[file.section]
          && subsectionHeadings[file.section] && subsectionHeadings[file.section].has(sub);
        crumbs.push({
          label: subsectionLabel(sub),
          href: headed ? `${sectionHref}#${subsectionAnchorId(sub)}` : null,
        });
      }
    }
    crumbs.push({ label: frontmatter.title });
    pageSubbar = buildBar({
      crumbs,
      closeHref: sectionHref,
      closeLabel: sectionLabel,
      // Markdown-source items only when the .md files are reachable from the
      // served site (config: markdownSourceBase)
      // A guide the package ships has no source in the site's cms/, so no link to one
      mdHref: CONFIG.markdownSourceBase && !GUIDES.sources.has(file.markdownPath) ? `${navBase}${CONFIG.markdownSourceBase}/${file.markdownPath}` : null,
    });
  }

  // Build page scripts based on section and frontmatter
  const pageScripts = buildPageScripts(file.section, frontmatter, navBase);

  // The Glossary page is the index of its entry pages (generateGlossaryPages),
  // so it carries their section at level 1, the way the Showcase feed does:
  // the router then reads entry to index as "close", not a cross-book
  // "open".
  const isGlossaryIndex = GLOSSARY && file.htmlPath === 'glossary.html';

  return renderPage(template, {
    space: ROOT_SPACE,
    navBase,
    title: frontmatter.title || 'Untitled',
    description: frontmatter.description || '',
    header: pageHeader,
    stickyBar: pageSubbar,
    content: htmlContent,
    toc: type.toc ? tableOfContents : '',
    frame: type.frame,
    article: type.article,
    pageNav: type.pager ? generatePageNav(file, pageOrder) : '',
    access,
    scripts: pageScripts,
    sectionSlug: isGlossaryIndex ? GLOSSARY_FOLDER : slugifySection(file.section),
    pageSection: isGlossaryIndex ? GLOSSARY_FOLDER : slugifySection(file.section),
    // Per-section sidebar position (matches the data-order on the matching
    // sidebar sidebar-nav-link). Falls back to 999 for files not in any sidebar.
    order: sidebarOrderMap[file.htmlPath] || 999,
    level: isGlossaryIndex ? PAGE_TYPES.contents.level : type.level,
    chrome: type.chrome,
    searchable: frontmatter.search !== 'false',
    // The tool pair renderer has always passed this; a cms/*.md page could not,
    // so `sidebar: "collapsed"` in frontmatter was read by nothing and did
    // nothing — the quietest kind of wrong, since the page still built. Both
    // renderers now read the same field.
    sidebar: frontmatter.sidebar || null,
  });
}

/**
 * Generate nav.js — a synchronous script that injects the top nav + sidebar
 * into any page via a #site-nav mount point.
 *
 * Mount point attributes:
 *   data-base=""     → root pages (assets/...)
 *   data-base="../"  → subdirectory pages (../assets/...)
 *   data-sidebar="false" → top nav only, no sidebar
 *   data-search="false"  → no search trigger and no dialog. For a page that
 *                          loads nav.js without dialog.js and search.js —
 *                          every hand-authored bare page (login, account,
 *                          access-denied, support, examples/bare): a trigger
 *                          there would open nothing, and on the pages served
 *                          signed out the indexes sit behind the gate anyway.
 */
/**
 * The engine's addresses as the browser reads them (window.bdPaths, written
 * first in nav.js), rooted under basePath like every link nav.js writes.
 * `bare` lists every bare page this build writes: none has a container, so
 * the router (barba-docs.js) leaves each to the browser.
 */
function browserEnginePaths() {
  const P = appsRegistry.ENGINE_PATHS;
  return {
    login: siteHref(P.login),
    locked: siteHref(P.locked),
    support: siteHref(P.support),
    signOut: siteHref(P.signOut),
    bare: [...BARE_PAGE_PATHS].sort(),
  };
}

// The site paths of the bare pages this build writes (generateDocs fills it)
const BARE_PAGE_PATHS = new Set();

function generateNavJs(filesBySection) {
  // Build navigation HTML (no active page — active detection is done at runtime)
  // Under 'hidden' the list lives in each page (#site-nav-source), where the
  // Worker can cut it per reader; a list here would reach every reader.
  const navSectionsHtml = CONFIG.accessNav === 'hidden' ? '' : buildNavSectionsHtml(filesBySection);

  // Escape backticks and backslashes for embedding in a JS template literal
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/'/g, "\\'");

  // Site-header logo (config: logoHtml) — plain site name when not configured.
  // A bare <span> rather than a class, because the class would have no CSS
  // anywhere; the link it sits in already supplies colour and alignment.
  const logoHtml = CONFIG.logoHtml || `<span>${SITE_HTML.name}</span>`;

  // Contact link (config: contactHref / contactLabel) — omitted when unset.
  // Icon-only at every width, like every action in the end slot since the
  // 2026-09-30 header; the accessible name is the aria-label.
  // The People page (cms/apps/people.*, admin only), wherever the site's
  // config files it: the account menu links it for admins and owners, so
  // managing who can sign in is one click from every page on every site.
  // Omitted when the site has no People page.
  // Same folder rule as the app pages and linkLevels: the pair's section,
  // Tools by default. A draft pair has no page, so no link.
  const people = installedApp('people');
  let peopleHref = '';
  if (CONFIG.accessGate && people) {
    const peopleApp = people.frontmatter;
    if (peopleApp.status !== 'draft') {
      const peopleSection = peopleApp.section || 'Tools';
      const peopleFolder = SECTION_FOLDERS[peopleSection] || peopleSection.toLowerCase();
      peopleHref = siteHref('/' + peopleFolder + '/people.html');
    }
  }

  // A contact page outside the docs layout (a bare page, the engine's Ask
  // for access) needs nothing here: the router leaves every bare page in
  // window.bdPaths to the browser
  const contactNavJs = CONFIG.contactHref ? `
    + '<a href="${siteHref(CONFIG.contactHref)}" class="button header-action header-contact-link" data-icon-only aria-label="${CONFIG.contactLabel}" data-tooltip="${CONFIG.contactLabel}" data-tooltip-position="bottom">'
    + '<span class="svg-icn">' + ICON_MAIL + '</span>'
    + '</a>'` : '';

  const script = `/**
 * nav.js — Auto-generated by cms/generator/generate-docs.js
 * Injects top nav + sidebar into any page with a #site-nav mount point.
 * DO NOT EDIT MANUALLY — re-run: cd cms/generator && npm run docgen
 */

// The engine's fixed addresses (worker/engine-paths.mjs, PD-2): the sign-in,
// locked and Ask for access pages and the sign-out link. Every script on the
// page reads them here, so none names an address of its own. Set first, and
// whether or not the page has the header mount: nav.js loads before them all.
window.bdPaths = Object.freeze(${JSON.stringify(browserEnginePaths())});

(function initSiteNav() {
  'use strict';

  var mount = document.getElementById('site-nav');
  if (!mount) return;

  var hasSidebar = mount.getAttribute('data-sidebar') !== 'false';
  var hasSearch = mount.getAttribute('data-search') !== 'false';

  // ── Shared SVG icons (loaded from assets/images/svg-icons/) ──
  var ICON_HAMBURGER = '${esc(getRawIcon('menu'))}';
  var ICON_CLOSE = '${esc(getRawIcon('close'))}';
  var ICON_COLLAPSE = '${esc(getRawIcon('sidebar-left-close'))}';
  var ICON_EXPAND = '${esc(getRawIcon('sidebar-left-open'))}';
  var ICON_BACK = '${esc(getRawIcon('back-arrow'))}';
  var ICON_HOME = '${esc(getRawIcon('home'))}';
  var ICON_SUN = '${esc(getRawIcon('sun'))}';
  var ICON_MOON = '${esc(getRawIcon('moon'))}';
  var ICON_MAIL = '${esc(getRawIcon('mail'))}';
  var ICON_SEARCH = '${esc(getRawIcon('search'))}';
  var ICON_CLOCK = '${esc(getRawIcon('clock'))}';
  var ICON_RETURN = '${esc(getRawIcon('return-arrow'))}';
  var ICON_LOGOUT = '${esc(getRawIcon('logout'))}';
  var ICON_USERS = '${peopleHref ? esc(getRawIcon('users')) : ''}';
  var NAV_LOCK = '${esc(lockIcon('sidebar-nav-lock'))}';

  // ── Build site header HTML ──
  var headerStart = '<div class="site-header-start">';

  if (hasSidebar) {
    // Opens the nav drawer. dialog.js supplies Escape, the focus trap, focus
    // return and scroll lock from these attributes alone — there is no
    // hand-written open/close code behind this button.
    headerStart += '<button type="button" class="button header-action header-menu-btn" data-icon-only'
      + ' data-drawer-open="site-nav-drawer" aria-controls="site-nav-drawer"'
      + ' aria-expanded="false" aria-label="Open navigation">'
      + '<span class="svg-icn hamburger-icon-open">' + ICON_HAMBURGER + '</span>'
      + '<span class="svg-icn hamburger-icon-close">' + ICON_CLOSE + '</span>'
      + '</button>';
  }

  // The logo is an aria-hidden SVG, so the link names itself the way the
  // sidebar's home link does; without this it has no accessible name.
  headerStart += '<a href="${siteHref('/index.html')}" class="site-header-logo" aria-label="Home">'
    + '${esc(logoHtml)}'
    + '</a></div>';

  var ICON_CHEVRON_DOWN = '${esc(getRawIcon('chevron-down'))}';

  // ── Brand instances ship no search surface ──
  //
  // The indexes cover the engine's pages only: renderPage's \`searchable\`
  // defaults to \`space.key === null\`, so nothing an instance owns is indexed.
  // Left as it was, a client pressing Cmd+K on their own brand page got the
  // engine's system back — "By Default OS", "Brand Setup" — which crosses
  // the one line a prospect has to be able to see (PROJECT_OVERVIEW section 11).
  // Until per-instance indexing lands, no search at all is the correct failure.
  //
  // The gate is here at runtime, not at build: nav.js is one file for the whole
  // site (root and instance pages load the same URL), and the \`space\`
  // descriptor is a per-page render concept that never reaches this function.
  // data-space is written by the generator from that descriptor and by nothing
  // else, which is the whole point of it existing.
  //
  // It is NOT data-brand-theme, which was the obvious choice and is wrong: the
  // early-theme bootstrap in every page head sets that attribute from
  // localStorage before this deferred script runs. Any reader who had ever
  // previewed a brand would have lost search on every page of the site — no
  // trigger, no dialog, and no Cmd+K either — with no error and no way back
  // short of clearing site data.
  //
  // search.js needs no matching change: initSearch bails when #site-search is
  // absent, and it registers the Cmd+K / "/" listener after that bail, so the
  // shortcuts go unbound with the markup. The same bail covers a page that
  // opts out with data-search="false" on its mount (hasSearch above).
  var isBrandInstance = document.documentElement.hasAttribute('data-space');

  // An icon-only button, not an input: the field is in the dialog, and two
  // fields that both look like search is the confusion this avoids. The
  // shortcut travels as aria-keyshortcuts; the visible ⌘K badge went with the
  // field look, and the dialog's own footer lists the keys that work inside it.
  var searchTriggerJs = ${!CONFIG.search ? "''" : `(isBrandInstance || !hasSearch) ? '' : ('<button type="button" class="button header-action header-search-btn" data-icon-only'
    + ' data-dialog-open="site-search" aria-controls="site-search"'
    + ' aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K"'
    + ' aria-label="Search the system" data-tooltip="Search" data-tooltip-position="bottom">'
    + '<span class="svg-icn">' + ICON_SEARCH + '</span>'
    + '</button>')`};

  // The account menu: the Dropdown's avatar-item pattern (cms/dropdown.md),
  // anchored bottom-end because the trigger is the last thing on the right.
  // No aria-labelledby on the group: dropdown.js names the menu from its
  // trigger, so a reader hears "Account, Erlen Masson, menu" — what it is as
  // well as whose — rather than the bare name.
  // Emitted hidden and empty — header-account.js fills the avatars, the name
  // and the email from the session and reveals it; a page served signed out
  // (login, support, access denied) keeps it hidden. Brand instances get it
  // too: they sit behind the same gate.
  var accountMenuJs = '<div class="dropdown header-account" data-placement="bottom-end" hidden>'
    + '<button type="button" class="dropdown-trigger header-account-trigger" aria-haspopup="true" aria-expanded="false" aria-label="Account" data-tooltip="Account" data-tooltip-position="bottom">'
    + '<span class="avatar" aria-hidden="true"></span>'
    + '</button>'
    + '<div class="dropdown-menu">'
    + '<div class="dropdown-header">'
    + '<span class="avatar" aria-hidden="true"></span>'
    + '<div><div class="header-account-name"></div>'
    + '<div class="dropdown-desc header-account-email"></div></div>'
    + '</div>'
    + '<div class="dropdown-divider" role="separator"></div>'
    + '<div class="dropdown-group" role="menu">'${peopleHref ? `
    // Hidden until header-account.js reads an admin or owner session; the
    // Worker refuses the page to anyone else whatever this menu shows.
    + '<a class="dropdown-item" role="menuitem" href="${peopleHref}" data-account-people hidden>'
    + '<span class="svg-icn">' + ICON_USERS + '</span><span>People</span>'
    + '</a>'` : ''}
    // An ordinary item: signing out loses nothing, so it is not a danger
    + '<button type="button" class="dropdown-item" role="menuitem" data-account-sign-out>'
    + '<span class="svg-icn">' + ICON_LOGOUT + '</span><span>Sign out</span>'
    + '</button>'
    + '</div>'
    + '</div>'
    + '</div>';

  // Contact, search, theme, account — every one an icon-only square.
  var headerEnd = '<div class="site-header-end">'${contactNavJs} + searchTriggerJs
    + '<button type="button" class="button header-action dark-mode-toggle" data-icon-only aria-label="Dark mode" data-tooltip="Dark mode" data-tooltip-position="bottom">'
    + '<span class="svg-icn dark-mode-icon-light">' + ICON_SUN + '</span>'
    + '<span class="svg-icn dark-mode-icon-dark">' + ICON_MOON + '</span>'
    + '</button>'
    + accountMenuJs
    + '</div>';

  // The skip link is first in the DOM so it is the first thing Tab reaches.
  var headerHtml = '<header class="site-header">'
    + '<a class="skip-link" href="#main">Skip to content</a>'
    + '<div class="site-header-inner">' + headerStart + headerEnd + '</div>'
    + '</header>';

  // ── Build search dialog ──
  //
  // Emitted here rather than built in search.js so its icons come from the
  // registry like every other icon on the site, and so the markup ships even
  // if the module fails to load. It is a <dialog> for the same reason the
  // sidebar is: dialog.js gives Escape, the focus trap, focus return and the
  // scroll lock from the attributes alone.
  //
  // Injected as a sibling of the header, outside [data-barba="wrapper"], so a
  // page transition never tears it down and its fixed positioning is never
  // trapped inside a transformed ancestor.
  //
  // Gated with the trigger above: an instance, or a page that opted out on its
  // mount, ships neither — no dialog to open and nothing to open it with.
  var searchDialogHtml = ${!CONFIG.search ? "''" : `(isBrandInstance || !hasSearch) ? '' : ('<dialog id="site-search" class="dialog search-dialog" aria-label="Search the system"'
    + ' data-symbols="${siteHref('/search-index/symbols.json')}"'
    + ' data-pagefind="${siteHref('/pagefind/pagefind.js')}"'
    + ' data-search-page="${siteHref('/search.html')}">'
    // <search> carries an implicit role="search"; stating it again is noise.
    + '<search class="search-field">'
    + '<span class="svg-icn search-field-icon">' + ICON_SEARCH + '</span>'
    // type="text", not "search". role="combobox" already overrides the implicit
    // role, the base input rules name both types in one selector list so the
    // styling is identical, and the webkit clear affordance was being hidden in
    // CSS anyway — so the only live effect of type="search" was Chrome's native
    // clear swallowing the first Escape, which cost a second press to close the
    // dialog once anything was typed.
    + '<input type="text" class="search-input" id="site-search-input" role="combobox"'
    + ' aria-expanded="false" aria-controls="site-search-results" aria-autocomplete="list"'
    // enterkeyhint carries what the type used to: a soft keyboard renders a
    // Search action key for type="search" and a plain return for type="text",
    // and that is UA behaviour no computed-style check can see.
    + ' autocomplete="off" autocapitalize="none" spellcheck="false" autofocus'
    + ' enterkeyhint="search"'
    + ' placeholder="Search the system" aria-label="Search the system">'
    + '<button type="button" class="button close-btn search-close" data-icon-only data-size="small" data-dialog-close aria-label="Close search">'
    + '<span class="svg-icn">' + ICON_CLOSE + '</span>'
    + '</button>'
    + '</search>'
    // The Segmented control's flat form (cms/form.md). search.js fills it with
    // one aria-pressed button per result type the query found, plus All.
    + '<div class="search-filters segmented-control" role="group" aria-label="Filter results by type" hidden></div>'
    // In the DOM from first render and never display:none — a live region
    // revealed at announce time is not reliably announced (cms/login.md).
    + '<p class="search-status text-size-s text-faded" aria-live="polite"></p>'
    // role="listbox" may own only options and groups. The listbox therefore
    // takes result rows and nothing else; the panel beside it takes every other
    // state — the idle content, the callouts, the loading skeleton.
    // .search-results stays the scroll container and the styling hook.
    //
    // The id moves onto the listbox and keeps its value, so aria-controls is
    // unchanged and still correct: it must name the popup element itself, and
    // .search-results is a roleless wrapper.
    + '<div class="search-results">'
    + '<div class="search-listbox" id="site-search-results" role="listbox" aria-label="Search results"></div>'
    + '<div class="search-panel"></div>'
    + '</div>'
    + '<footer class="search-dialog-footer">'
    + '<span class="search-hint"><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>'
    // A key like the others, so the Enter glyph sits in a <kbd> too. The SVG
    // is aria-hidden, so the key's name travels as hidden text — not as an
    // aria-label, which a <kbd> (generic role) may not carry.
    + '<span class="search-hint"><kbd><span class="svg-icn">' + ICON_RETURN + '</span><span class="visually-hidden">Enter</span></kbd> open</span>'
    + '<span class="search-hint"><kbd>esc</kbd> close</span>'
    // "See all results", matching the row at the end of the list. "Open full
    // search" invented a name for the page — it is titled Search, and calling
    // it "full search" implies the dialog is a lesser version of it.
    + '<a class="search-all" href="${siteHref('/search.html')}">See all results</a>'
    + '</footer>'
    // Icons search.js draws into its own controls — the recent-search remove
    // button — taken from the registry here like every other icon. Inert until
    // cloned, and read by id so the results page's surface finds it too.
    + '<template id="site-search-icons"><span data-icon="close">' + ICON_CLOSE + '</span></template>'
    + '</dialog>')`};

  // ── Build sidebar HTML (if needed) ──
  var sidebarHtml = '';
  if (hasSidebar) {
    // A <dialog>, not an <aside>. Above the mobile breakpoint the CSS
    // overrides the UA's display:none and this behaves as an ordinary in-flow
    // sidebar; below it, dialog.js opens it with showModal(), which is what
    // actually removes its ~130 links from the accessibility tree rather than
    // just moving them off-screen.
    sidebarHtml = '<dialog id="site-nav-drawer" class="site-sidebar drawer" data-placement="start" aria-label="Site navigation">'
      + '<div class="site-sidebar-header">'
      + '<button class="site-sidebar-toggle" aria-label="Collapse sidebar" data-tooltip="Collapse sidebar" data-tooltip-position="right" type="button">'
      + '<span class="svg-icn sidebar-icon-open">' + ICON_COLLAPSE + '</span>'
      + '<span class="svg-icn sidebar-icon-close">' + ICON_EXPAND + '</span>'
      + '</button>'
      // Mobile only: closing by backdrop tap works but is not discoverable,
      // and there is no Escape key on a touch device. data-drawer-close is
      // dialog.js's own attribute, so this needs no extra wiring.
      + '<button type="button" class="button close-btn site-sidebar-close" data-icon-only data-size="small" data-drawer-close aria-label="Close navigation">'
      + '<span class="svg-icn">' + ICON_CLOSE + '</span>'
      + '</button>'
      + '</div>'
      + '<div class="site-sidebar-content"${MOTION.sidebarGroup}>'${CONFIG.accessNav === 'hidden' ? `
      // No lock note under accessNav 'hidden': the Worker cuts what a reader
      // can't open, so no lock is ever shown for a note to explain (phase D)` : `
      // Shown only while the sidebar is locked (body.is-signed-out), and only
      // where labels show — the expanded sidebar and the mobile drawer. Every
      // locked item points at it with aria-describedby, which reads hidden
      // text too, so the reason reaches a screen reader on the rail as well.
      + '<p class="sidebar-lock-note" id="sidebar-lock-note">Log in to access the rest of the system.</p>'`}
      + '<a href="${siteHref('/index.html')}" class="sidebar-nav-link sidebar-nav-home" data-access="team" aria-label="Home" data-tooltip="Home" data-tooltip-position="right"${MOTION.sidebarItem}>'
      + '<span class="svg-icn">' + ICON_HOME + '</span>'
      + '<span>Home</span>'
      + NAV_LOCK
      + '</a>'
      + \`${esc(navSectionsHtml)}\`
      + '</div>'
      + '</dialog>';
  }

  // ── Inject into page ──
  // The mount (#site-nav) already contains <main class="docs-main-area"> from
  // the template. Use insertAdjacentHTML to prepend the header + sidebar
  // BEFORE the existing <main>, preserving it in place as a grid sibling.
  mount.insertAdjacentHTML('afterbegin', headerHtml + sidebarHtml + searchDialogHtml);

${CONFIG.accessNav === 'hidden' ? `
  // ── Hidden navigation (accessNav: 'hidden', levels-groups-plan.md D19) ──
  // The sidebar list arrives in the page, already cut by the Worker to what
  // this reader may open (worker/hidden-nav.mjs). Its nodes move into the
  // sidebar here, and what the cut left empty goes: a list item with no
  // link, a subsection with none, a section with nothing but its Overview.
  // Emitted only under 'hidden': under 'locked' nothing is ever cut.
  var navSource = document.getElementById('site-nav-source');
  if (navSource) {
    var navContent = mount.querySelector('.site-sidebar-content');
    if (navContent) {
      while (navSource.firstChild) navContent.appendChild(navSource.firstChild);
      pruneHiddenNav(navContent);
    }
    // The role the Worker cut this sidebar for. The sidebar outlives every
    // Barba swap, so a session answer naming another role means it is stale:
    // a full load fetches one cut for the reader as they are now.
    var cutFor = navSource.getAttribute('data-cut-for') || '';
    navSource.remove();
    if (cutFor) document.addEventListener('bd:session', function reloadStaleNav() {
      var s = window.bdSession;
      var now = s && s.signedIn ? s.role || '' : 'out';
      if (!now || now === cutFor) return;
      // Once per page and role: should the session answer and the Worker
      // keep disagreeing, a second load must not become a loop.
      var key = 'bd-nav-cut:' + window.location.pathname + ':' + now;
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { return; }
      window.location.reload();
    });
  }
  pruneEmptyCardSections(document);

  function pruneHiddenNav(root) {
    var subsections = root.querySelectorAll('.sidebar-nav-subsection');
    for (var i = 0; i < subsections.length; i++) {
      if (!subsections[i].querySelector('.sidebar-nav-link')) {
        var item = subsections[i].closest('li');
        (item || subsections[i]).remove();
      }
    }
    var items = root.querySelectorAll('.sidebar-nav-section li');
    for (var j = 0; j < items.length; j++) {
      if (!items[j].querySelector('a[href], details')) items[j].remove();
    }
    var sections = root.querySelectorAll('.sidebar-nav-section');
    for (var k = 0; k < sections.length; k++) {
      if (!sections[k].querySelector('.sidebar-nav-link:not([data-order="0"])')) sections[k].remove();
    }
  }

  // An index heading whose cards the Worker removed is a heading over
  // nothing. The router (barba-docs.js) calls this on every arriving
  // container.
  function pruneEmptyCardSections(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var groups = scope.querySelectorAll('.docs-section');
    for (var i = 0; i < groups.length; i++) {
      var contents = groups[i].querySelector('.book-contents');
      if (contents && contents.children.length === 0) groups[i].remove();
    }
  }
  window.bdPruneEmptyCardSections = pruneEmptyCardSections;
` : `
  // Under 'locked' the Worker cuts nothing, so there is nothing to prune;
  // both routers call this on every swap whichever mode the site is in.
  window.bdPruneEmptyCardSections = function pruneEmptyCardSections() {};
`}
  // The sidebar's entrances are played by bd-animate's chrome pass, which
  // runs after this script on every page today (defer order). Should the
  // engine ever run first, its pass would miss a sidebar not yet in the
  // document and leave it held, so it is asked again here.
  if (document.documentElement.hasAttribute('data-bd-ready') && typeof window.bdAnimateChromeIn === 'function') {
    window.bdAnimateChromeIn(mount);
  }

  // A brand instance ships no search surface, so it must not ship a route to
  // one either. The sidebar is built once for the whole site, so the entries
  // that only exist on the engine's own site are marked and dropped here.
  if (isBrandInstance) {
    var engineOnly = mount.querySelectorAll('[data-engine-only]');
    for (var eo = 0; eo < engineOnly.length; eo++) engineOnly[eo].remove();
  }

  // Give the skip link something to land on. Done here rather than in the
  // page template because hand-written pages (the tool apps) use the same
  // mount without coming from that template — this covers both.
  var mainEl = mount.querySelector('.docs-main-area');
  if (mainEl && !mainEl.id) mainEl.id = 'main';

  // Sidebar nav links are emitted as absolute paths so they resolve correctly
  // regardless of the current page's depth — no runtime fixup needed.

  // ── Active link detection ──
  // Exposed as window.refreshNavActive so a client-side router can re-run it
  // after each page swap (the nav itself stays put outside the swapped DOM).
  if (hasSidebar) {
    // Normalize: treat /path/ and /path/index.html as equal
    function normPath(p) {
      return p.replace(/\\/index\\.html$/, '/').replace(/\\/$/, '');
    }

    function setActiveLink() {
      var navLinks = mount.querySelectorAll('.sidebar-nav-link');
      var currentNorm = normPath(window.location.pathname);

      // Clear previous active state (idempotent — safe to call repeatedly)
      for (var k = 0; k < navLinks.length; k++) {
        navLinks[k].classList.remove('sidebar-nav-link-active');
        navLinks[k].removeAttribute('aria-current');
      }

      for (var j = 0; j < navLinks.length; j++) {
        var link = navLinks[j];
        // Resolve the link href to an absolute path (handles ../ prefixes correctly)
        var resolvedPath = new URL(link.href, window.location.href).pathname;
        var resolvedNorm = normPath(resolvedPath);

        // A root link that stands for a folder (Showcase) is current on
        // every page in it, not only on its index. A root page whose
        // children sit in a folder of its own name (/glossary.html and
        // /glossary/<term>.html) is current on those children too.
        var isRoot = link.classList.contains('sidebar-nav-root-link');
        var rootFolder = resolvedNorm.replace(/\\.html$/, '');
        var isCurrent = currentNorm === resolvedNorm
          || (isRoot && currentNorm.indexOf(resolvedNorm + '/') === 0)
          || (isRoot && rootFolder !== resolvedNorm && currentNorm.indexOf(rootFolder + '/') === 0);
        if (isCurrent) {
          link.classList.add('sidebar-nav-link-active');
          link.setAttribute('aria-current', 'page');
          // A locked sidebar keeps every section shut; applySessionLock
          // re-runs this on unlock, which opens them then.
          if (document.body.classList.contains('is-signed-out')) continue;
          // Open parent details section and subsection dropdown
          var parentDetails = link.closest('.sidebar-nav-section');
          if (parentDetails) {
            parentDetails.setAttribute('open', '');
          }
          var parentSubsection = link.closest('.sidebar-nav-subsection');
          if (parentSubsection) {
            parentSubsection.setAttribute('open', '');
          }
        }
      }
    }

    setActiveLink();
    window.refreshNavActive = setActiveLink;
  }

  // ── Body class management ──
  if (!hasSidebar) {
    document.body.classList.add('no-sidebar');
  }

  // ── Sidebar collapse toggle (desktop) ──
  var SIDEBAR_KEY = 'docs-sidebar-collapsed';

  if (hasSidebar) {
    var sidebarToggle = mount.querySelector('.site-sidebar-toggle');

    function syncToggleLabel() {
      if (!sidebarToggle) return;
      var isCollapsed = document.body.classList.contains('sidebar-collapsed');
      var label = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      sidebarToggle.setAttribute('aria-label', label);
      sidebarToggle.setAttribute('data-tooltip', label);
    }

    // The reader's own state: their saved choice, else the page's default.
    // Also what an unlock returns to, since a locked sidebar starts
    // collapsed without that ever being saved.
    function restoreCollapsed() {
      var savedCollapsed = null;
      try { savedCollapsed = localStorage.getItem(SIDEBAR_KEY); } catch (e) { /* storage unavailable */ }
      var defaultCollapsed = mount.getAttribute('data-sidebar-default') === 'collapsed';
      var collapsed = savedCollapsed === 'true' || (savedCollapsed === null && defaultCollapsed);
      // Additive on first load: the pre-paint script may already have
      // collapsed a locked page, and that must stand.
      if (collapsed) document.body.classList.add('sidebar-collapsed');
      else if (!document.body.classList.contains('is-signed-out')) document.body.classList.remove('sidebar-collapsed');
      syncToggleLabel();
    }

    restoreCollapsed();

    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function() {
        document.body.classList.toggle('sidebar-collapsed');
        // A locked reader may expand and collapse, but that is not a
        // preference worth keeping: it would outlive the lock.
        if (!document.body.classList.contains('is-signed-out')) {
          try { localStorage.setItem(SIDEBAR_KEY, document.body.classList.contains('sidebar-collapsed')); } catch (e) { /* state still applies for this page */ }
        }
        syncToggleLabel();
      });
    }

    // Esc dismisses the sidebar's tooltips (WCAG 1.4.13): the collapsed
    // rail's, and the collapse toggle's in either state. Moving the pointer
    // to another row or shifting focus re-arms them.
    var sidebarEl = mount.querySelector('.site-sidebar');

    function dismissSidebarTooltips(e) {
      if (e.key === 'Escape' && (document.body.classList.contains('sidebar-collapsed') || (sidebarToggle && sidebarToggle.matches(':hover, :focus-visible')))) {
        document.body.classList.add('sidebar-tooltips-dismissed');
      }
    }

    function rearmSidebarTooltips() {
      document.body.classList.remove('sidebar-tooltips-dismissed');
    }

    document.addEventListener('keydown', dismissSidebarTooltips);
    if (sidebarEl) {
      sidebarEl.addEventListener('mouseover', rearmSidebarTooltips);
      sidebarEl.addEventListener('focusin', rearmSidebarTooltips);
    }

    // ── Access locks ──
    // What a reader cannot open is locked, never hidden, except admin pages,
    // which are hidden from everyone but admins (permissions-plan.md §3.2,
    // the CSS keyed on body[data-role]). Three readers get locks: signed out
    // on a public page (everything, the gate turns them away from the rest),
    // a guest (team pages their groups do not reach), and a team member
    // beside an admin page in the pager. Every locked element is aria-disabled
    // and described by the note, whose words say why for that reader; the
    // rail's tooltips keep the item's name and add the reason.
    //
    // Presentation only. The gate is the control, the links keep their
    // hrefs, and the rule here mirrors authorise() in worker/gate.mjs - it
    // paints the verdict the Worker will give, it never replaces it.
    // header-account.js owns the page's one session check and publishes it
    // as window.bdSession and the bd:session event; the template's pre-paint
    // script has already set body.is-signed-out and body[data-role] from the
    // last answer, so the rail is in place before this runs. Declared in
    // this block because it needs restoreCollapsed and syncToggleLabel,
    // which are block-scoped.
    var LOCK_NOTE_ID = 'sidebar-lock-note';
    var LOCKABLE = 'a[href], summary';
    var CARD = '.book-contents-item[data-access], .book-cover[data-access]';
    var PAGER = '.page-nav-link[data-access]';
    // The signed-out words are the owner's (2026-10-01: no sign-in link, the
    // site is invite-only). A guest's note carries a real link, because every
    // locked row refuses the click - the note is where asking happens.
    var LOCK_NOTES = {
      out: 'Log in to access the rest of the system.',
      guest: 'Locked pages are for the team. ',
      team: 'Locked pages are for admins.',
      admin: '',
      owner: ''
    };
    var LOCK_TOOLTIPS = { out: 'Log in to access', guest: 'For the team', team: 'For admins', admin: 'For the owner', owner: '' };
    // The engine's Ask for access page, the same on every site (window.bdPaths, above)
    var SUPPORT_PATH = window.bdPaths.support;
    var lockNote = sidebarEl ? sidebarEl.querySelector('#' + LOCK_NOTE_ID) : null;

    function askHref() {
      return SUPPORT_PATH + '?from=' + encodeURIComponent(window.location.pathname);
    }

    function writeLockNote(role) {
      if (!lockNote) return;
      lockNote.replaceChildren(document.createTextNode(LOCK_NOTES[role] || ''));
      if (role !== 'guest') return;
      var ask = document.createElement('a');
      ask.href = askHref();
      ask.textContent = 'Ask for access';
      lockNote.appendChild(ask);
    }

    // The reader, from the one session answer: 'out', 'guest', 'team' or
    // 'admin' with the scopes a guest's groups grant. null until it lands.
    function readerState() {
      var s = window.bdSession;
      if (!s) return null;
      if (!s.signedIn) return { role: 'out', scopes: [] };
      var role = s.role === 'owner' || s.role === 'admin' || s.role === 'team' || s.role === 'guest' ? s.role : 'guest';
      return { role: role, scopes: Array.isArray(s.scopes) ? s.scopes : [] };
    }

    function pathOf(el) {
      try { return new URL(el.href, window.location.href).pathname; } catch (e) { return ''; }
    }

    // The same rule as worker/gate.mjs isIndexPath: the home, or one
    // folder's index, never deeper.
    function isIndexPath(p) {
      return p === '/' || p === '/index.html' || /^\\/[a-z0-9-]+\\/index\\.html$/.test(p);
    }

    function folderOf(p) {
      var m = /^\\/([a-z0-9-]+)\\/[^/]+$/.exec(p);
      return m ? m[1] : '';
    }

    // The second question, as the Worker asks it (worker/gate.mjs authorise):
    // public opens for everyone; an admin opens everything; an admin page
    // opens for no one else; a team member opens the rest; a guest opens the
    // indexes and what their groups grant. Signed out opens nothing - the
    // sidebar locks even links to other public pages, by the 2026-10-01
    // decision, so a signed-out reader is told to log in once, not page by page.
    function canOpen(reader, level, p) {
      // Under 'hidden' the Worker leaves a signed-out reader the public
      // pages only, so those stay open; under 'locked' everything locks.
      if (reader.role === 'out') return ${CONFIG.accessNav === 'hidden' ? "level === 'public'" : 'false'};
      if (level === 'public') return true;
      if (reader.role === 'owner') return true;
      if (level === 'owner') return false;
      if (reader.role === 'admin') return true;
      if (level === 'admin') return false;
      if (reader.role === 'team') return true;
      if (isIndexPath(p)) return true;
      var folder = folderOf(p);
      for (var i = 0; i < reader.scopes.length; i++) {
        if (reader.scopes[i] === 'page:' + p) return true;
        if (folder && reader.scopes[i] === 'section:' + folder) return true;
      }
      return false;
    }

    // The reason, for assistive tech: the name stays exactly the visible
    // label, aria-disabled says unavailable, and this says why.
    // Under accessNav 'hidden' there is no note (the Worker cuts what a reader
    // can't open), so nothing points at one; the tooltip still says why.
    function describeLock(el, locked) {
      if (locked && lockNote) el.setAttribute('aria-describedby', LOCK_NOTE_ID);
      else if (el.getAttribute('aria-describedby') === LOCK_NOTE_ID) el.removeAttribute('aria-describedby');
    }

    function lockItem(item, locked, reason) {
      if (locked) item.setAttribute('aria-disabled', 'true');
      else item.removeAttribute('aria-disabled');
      // The section icon is a link inside its own section's <summary>: two
      // stops with one name, and locked neither does anything. The summary
      // stays the one stop.
      if (item.classList.contains('sidebar-nav-section-icon')) {
        if (locked) item.setAttribute('tabindex', '-1');
        else item.removeAttribute('tabindex');
      }
      // The originals are parked on the element so an unlock can restore
      // them exactly, and a second lock does not park the locked text.
      if (item.hasAttribute('data-tooltip')) {
        if (!item.hasAttribute('data-tooltip-default')) item.setAttribute('data-tooltip-default', item.getAttribute('data-tooltip'));
        var base = item.getAttribute('data-tooltip-default');
        item.setAttribute('data-tooltip', locked && reason ? base + ' · ' + reason : base);
      }
      describeLock(item, locked);
    }

    // The pager and the cards sit inside the Barba container, so they are
    // re-marked on every swap - from beforeEnter, before the new container
    // animates in (barba-docs.js), and again on bd:after-nav, as well as
    // here. data-access is the generator's record of the target's level;
    // .is-locked is each component's own state (design-system.css §38, the
    // Book). scope is the arriving container when there is one, so the
    // leaving container is never swept.
    function lockLinks(selector, reader, scope) {
      var links = (scope || document).querySelectorAll(selector);
      for (var i = 0; i < links.length; i++) {
        var locked = !!reader && !canOpen(reader, links[i].getAttribute('data-access') || 'team', pathOf(links[i]));
        links[i].classList.toggle('is-locked', locked);
        if (locked) links[i].setAttribute('aria-disabled', 'true');
        else links[i].removeAttribute('aria-disabled');
        describeLock(links[i], locked);
      }
    }

    function applyAccess(reader) {
      if (!reader) return; // nothing known yet: the paint stands
      var body = document.body;
      var wasOut = body.classList.contains('is-signed-out');
      var out = reader.role === 'out';
      var reason = LOCK_TOOLTIPS[reader.role] || '';
      body.classList.toggle('is-signed-out', out);
      body.classList.toggle('is-guest', reader.role === 'guest');
      if (out) body.removeAttribute('data-role');
      else body.setAttribute('data-role', reader.role);
      writeLockNote(reader.role);

      var links = sidebarEl.querySelectorAll('a[href]');
      for (var li = 0; li < links.length; li++) {
        // The note's own link is the way to ask; it is never a locked row.
        if (lockNote && lockNote.contains(links[li])) continue;
        lockItem(links[li], !canOpen(reader, links[li].getAttribute('data-access') || 'team', pathOf(links[li])), reason);
      }
      // A section or subsection is locked when nothing listed in it opens
      // for this reader; the Overview is listed, so a guest's sections stay
      // expandable and show what the system holds - the locked rail is a
      // sales surface. The links were just marked by canOpen, so their
      // aria-disabled is the whole test: an admin section's links are all
      // admin (its Overview too), and they open for an admin or an owner.
      var groups = sidebarEl.querySelectorAll('details');
      for (var gi = 0; gi < groups.length; gi++) {
        var inner = groups[gi].querySelectorAll('.sidebar-nav-list a[href], .sidebar-nav-sublist a[href]');
        var anyOpen = false;
        for (var ii = 0; ii < inner.length; ii++) {
          if (inner[ii].getAttribute('aria-disabled') !== 'true') anyOpen = true;
        }
        var locked = out || !anyOpen;
        var toggle = groups[gi].querySelector(':scope > summary');
        if (toggle) lockItem(toggle, locked, reason);
        if (locked && groups[gi].open) {
          // A late lock can shut the section holding focus; hand focus to
          // its toggle rather than let it fall to <body>.
          if (toggle && groups[gi].contains(document.activeElement)) toggle.focus();
          groups[gi].open = false;
        }
      }
      lockLinks(PAGER, reader);
      lockLinks(CARD, reader);

      if (out && !wasOut) {
        // A lock that lands after paint (the hint said signed in, the
        // session did not) starts collapsed like one that painted locked.
        body.classList.add('sidebar-collapsed');
        syncToggleLabel();
      } else if (!out && wasOut) {
        restoreCollapsed();
        if (window.refreshNavActive) window.refreshNavActive();
      }
    }

    // Stops the native follow and the <details> toggle. The router is
    // stopped by its own prevent rule (shouldPrevent in barba-docs.js), not
    // here: stopPropagation would also hide the click from document-level
    // listeners like dropdown.js's outside-click close. auxclick covers
    // middle-click; Enter on a link and Enter or Space on a summary arrive
    // as click.
    //
    // Only once a session answer has landed. A page painted locked from a
    // missing hint whose check then fails (rate limit, outage, offline)
    // keeps the look but not the block: a signed-in reader there still gets
    // through, and a signed-out one meets the gate, which is the control
    // anyway.
    function guardLockedClick(e) {
      if (!window.bdSession || !e.target.closest) return;
      var item = e.target.closest(LOCKABLE + ', ' + PAGER + ', ' + CARD);
      if (!item || item.getAttribute('aria-disabled') !== 'true') return;
      if (!sidebarEl.contains(item) && !item.matches(PAGER) && !item.matches(CARD)) return;
      e.preventDefault();
    }

    // Find-in-page and similar can open a <details> without a click.
    // toggle does not bubble, hence capture. Only <details>: the sidebar is
    // itself a <dialog>, which fires toggle as the mobile drawer opens.
    function keepLockedSectionsShut(e) {
      if (!window.bdSession) return; // confirmed only, for the reason guardLockedClick gives
      if (e.target.tagName !== 'DETAILS' || !e.target.open) return;
      var toggle = e.target.querySelector(':scope > summary');
      if (toggle && toggle.getAttribute('aria-disabled') === 'true') e.target.open = false;
    }

    function onSessionChange() {
      applyAccess(readerState());
    }

    // Before the answer lands, a page painted locked (signed out, from the
    // hint) is treated as signed out so a swapped-in container is marked
    // like the page it joins; with nothing known at all, the marks stand.
    function knownReader() {
      var reader = readerState();
      if (reader) return reader;
      return document.body.classList.contains('is-signed-out') ? { role: 'out', scopes: [] } : null;
    }

    function relockSwapped(container) {
      var reader = knownReader();
      if (!reader) return;
      var scope = container && container.querySelectorAll ? container : null;
      lockLinks(PAGER, reader, scope);
      lockLinks(CARD, reader, scope);
      // The guest's way to ask follows the page they are on.
      var ask = lockNote ? lockNote.querySelector('a') : null;
      if (ask) ask.href = askHref();
    }

    function onAfterNav(e) {
      relockSwapped(e && e.detail ? e.detail.container : null);
    }

    // For the router's beforeEnter hook (barba-docs.js): the arriving container, marked
    // before it animates in rather than after.
    window.bdRelockSwapped = relockSwapped;

    if (sidebarEl) {
      window.addEventListener('click', guardLockedClick, true);
      window.addEventListener('auxclick', guardLockedClick, true);
      sidebarEl.addEventListener('toggle', keepLockedSectionsShut, true);
      document.addEventListener('bd:session', onSessionChange);
      document.addEventListener('bd:after-nav', onAfterNav);
      // Before the answer lands: a page painted locked (signed out, from the
      // hint) is marked locked so the look and the semantics agree; any
      // other page waits for the answer.
      applyAccess(knownReader());
    }
  }

  // ── Section toggle clicks: delegated guard on the sidebar ──
  // Delegated (not per-summary) so it survives the nav being rebuilt.
  // stopPropagation would hide the click from
  // document-level router listeners; preventDefault stops the details
  // toggle / native follow while the event keeps bubbling so navigation
  // still happens.
  if (hasSidebar) {
    var sidebarClickRoot = mount.querySelector('.site-sidebar');

    function guardSummaryClick(e) {
      if (!e.target.closest || !e.target.closest('.sidebar-nav-section-toggle')) return;
      if (e.target.closest('.sidebar-nav-section-icon')) {
        e.preventDefault();
        return;
      }
      // Collapsed strip (desktop only — the class persists on mobile,
      // where the overlay still needs toggling): the list is hidden, so
      // toggling would only flip aria-expanded with nothing revealed.
      // Negated max-width matches the CSS breakpoint exactly, including
      // fractional viewport widths between 768 and 769px.
      if (document.body.classList.contains('sidebar-collapsed')
          && !window.matchMedia('(max-width: 768px)').matches) {
        e.preventDefault();
      }
    }

    // Closing a pinned (sticky) toggle would drop it back to its place in
    // the flow, above the visible area, with keyboard focus on it. Close it
    // here instead and scroll the list by the distance it was pinned, so the
    // toggle stays exactly where it was on screen. On click rather than
    // \`toggle\`: toggle does not bubble and fires a task later, after the
    // jump has painted. Enter and Space on a summary fire click too.
    function keepClosedSummaryInView(e) {
      if (e.defaultPrevented || !e.target.closest) return;
      var summary = e.target.closest('.sidebar-nav-section-toggle, .sidebar-nav-subsection-toggle');
      if (!summary) return;
      var details = summary.parentElement;
      var scroller = summary.closest('.site-sidebar-content');
      if (!details || !details.open || !scroller) return;
      var summaryTop = summary.getBoundingClientRect().top;
      var pinnedBy = summaryTop - details.getBoundingClientRect().top;
      if (pinnedBy < 1) return;
      // A header mid-release sits partly above the edge; land it at the edge.
      var overshoot = Math.min(0, summaryTop - scroller.getBoundingClientRect().top);
      // Read before closing: the list collapsing clamps scrollTop, and
      // subtracting from the clamped value would jump the wrong way.
      var target = scroller.scrollTop - pinnedBy + overshoot;
      e.preventDefault();
      details.open = false;
      scroller.scrollTop = target;
    }

    // Marks a toggle .is-pinned while sticky holds it away from its place in
    // the flow, which is what draws its bottom rule (docs-site.css §1D) — a
    // line only while links are passing under it. Measured rather than left
    // to CSS scroll-state queries, which Safari and Firefox do not support.
    // Capture listeners: neither scroll nor toggle bubbles. One frame per
    // burst of events, and only open toggles are measured.
    var pinnedFrame = 0;

    function markPinnedToggles() {
      pinnedFrame = 0;
      var marked = sidebarClickRoot.querySelectorAll('.is-pinned');
      for (var i = 0; i < marked.length; i++) {
        if (!marked[i].parentElement.open) marked[i].classList.remove('is-pinned');
      }
      var toggles = sidebarClickRoot.querySelectorAll(
        'details[open] > .sidebar-nav-section-toggle, details[open] > .sidebar-nav-subsection-toggle'
      );
      for (var j = 0; j < toggles.length; j++) {
        var pinnedBy = toggles[j].getBoundingClientRect().top
          - toggles[j].parentElement.getBoundingClientRect().top;
        toggles[j].classList.toggle('is-pinned', pinnedBy >= 1);
      }
    }

    function schedulePinnedCheck() {
      if (!pinnedFrame) pinnedFrame = requestAnimationFrame(markPinnedToggles);
    }

    if (sidebarClickRoot) {
      sidebarClickRoot.addEventListener('click', guardSummaryClick);
      sidebarClickRoot.addEventListener('click', keepClosedSummaryInView);
      sidebarClickRoot.addEventListener('scroll', schedulePinnedCheck, { capture: true, passive: true });
      sidebarClickRoot.addEventListener('toggle', schedulePinnedCheck, true);
      window.addEventListener('resize', schedulePinnedCheck, { passive: true });
    }
  }

  // ── Mobile nav drawer ──
  // Opening, closing, Escape, the focus trap, focus return and scroll lock
  // all come from dialog.js via the button's data-drawer-open attribute.
  // What is left here is the part dialog.js cannot know about: this element
  // is only a drawer below the breakpoint, so a viewport that grows while it
  // is open would strand an open modal styled as an in-flow sidebar.
  if (hasSidebar) {
    var navDrawer = document.getElementById('site-nav-drawer');
    var menuBtn = mount.querySelector('.header-menu-btn');
    var desktopQuery = window.matchMedia('(min-width: 769px)');

    function closeDrawerOnDesktop(e) {
      if (e.matches && navDrawer && navDrawer.open) {
        window.bdRequestClose(navDrawer, 'resize');
      }
    }

    desktopQuery.addEventListener('change', closeDrawerOnDesktop);

    // aria-expanded is the button's own state and dialog.js does not own it.
    // Driven off the dialog's real open/close events so the two cannot drift.
    if (menuBtn && navDrawer) {
      function syncMenuBtn() {
        var isOpen = navDrawer.open;
        menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        menuBtn.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
      }

      menuBtn.addEventListener('click', function() {
        // The dialog opens on the same click; read state on the next frame.
        window.requestAnimationFrame(syncMenuBtn);
      });
      navDrawer.addEventListener('close', syncMenuBtn);
    }
  }

  // ── Dark mode toggle ──
  // Three states on <html>: no data-theme = follow the OS (the
  // prefers-color-scheme fallback), "light"/"dark" = explicit choice.
  // Never remove the attribute — absence re-arms the fallback, so an
  // OS-dark visitor could never reach light mode.
  var DARK_KEY = 'dark-mode';
  var darkToggle = mount.querySelector('.dark-mode-toggle');

  function isDarkNow() {
    var choice = document.documentElement.getAttribute('data-theme');
    if (choice) return choice === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Apply saved preference; without one the attribute stays unset and the
  // OS preference drives the theme
  var savedDark = null;
  try { savedDark = localStorage.getItem(DARK_KEY); } catch (e) { /* storage unavailable */ }
  if (savedDark !== null) {
    document.documentElement.setAttribute('data-theme', savedDark === 'true' ? 'dark' : 'light');
  }

  if (darkToggle) {
    darkToggle.setAttribute('aria-pressed', String(isDarkNow()));
    darkToggle.addEventListener('click', function toggleDarkMode() {
      var next = isDarkNow() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      darkToggle.setAttribute('aria-pressed', String(next === 'dark'));
      try { localStorage.setItem(DARK_KEY, next === 'dark'); } catch (e) { /* theme still applies for this page */ }
    });
    // A held Enter re-fires click on native buttons — suppress the repeats
    // so the page can't strobe between themes (WCAG 2.3.1)
    darkToggle.addEventListener('keydown', function suppressHeldEnter(event) {
      if (event.repeat) event.preventDefault();
    });
    // With no explicit choice the OS drives the theme — keep the reported
    // state in sync when it changes mid-session
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function syncTogglePressed() {
      if (!document.documentElement.hasAttribute('data-theme')) {
        darkToggle.setAttribute('aria-pressed', String(isDarkNow()));
      }
    });
  }

  // Header dropdown toggles handled by dropdown.js

  // Signal that nav is ready
  document.body.classList.add('nav-ready');
})();
`;

  return script;
}

/**
 * The level a tool app declares in its own frontmatter (cms/apps/<slug>.md),
 * for the sidebar entry that opens it. Falls back to the guide's level when
 * the pair has no .md - a guide with no app lists itself.
 */
/**
 * Under accessNav 'hidden', a wrapper that holds links (a sidebar section or
 * subsection, an index group) carries every link it holds as level:path, so
 * the Worker can drop the wrapper, label and all, when the reader may open
 * none of them (worker/hidden-nav.mjs). Empty under 'locked'.
 */
function accessAnyAttr(entries) {
  if (CONFIG.accessNav !== 'hidden' || entries.length === 0) return '';
  return ` data-access-any="${escapeAttr(entries.map((e) => `${e.level}:${e.path}`).join(' '))}"`;
}

function appAccess(slug, fallback) {
  const app = installedApp(slug);
  return app ? deriveDataAccess(app.frontmatter) : fallback;
}

/**
 * Where a guide's sidebar entry and index card point, in any section: a guide
 * whose frontmatter names its tool (actionUrl, or the older toolUrl) opens the
 * tool, one click from the nav, carrying the tool's own level. Otherwise the
 * guide itself. Section-wide since 2026-11-10, when People moved to Settings:
 * the rule was Tools-only, so Settings' entry opened the guide.
 * Returns a site-absolute path (not yet siteHref'd) and the level.
 */
function guideTarget(file, section) {
  const ownHref = '/' + file.htmlPath;
  const ownAccess = deriveDataAccess(file.frontmatter);
  const actionUrl = file.frontmatter.actionUrl || file.frontmatter.toolUrl;
  if (!actionUrl) return { href: ownHref, access: ownAccess };
  let href;
  if (actionUrl.startsWith('/')) {
    href = actionUrl;
  } else {
    // Relative to the guide's folder: ./foo.html, ../foo.html or foo.html.
    const sectionFolder = SECTION_FOLDERS[section] || section.toLowerCase();
    href = '/' + sectionFolder + '/' + actionUrl.replace(/^(\.\.?\/)+/, '');
  }
  const access = file.frontmatter.actionAccess || file.frontmatter.toolAccess || appAccess(path.basename(href, '.html'), ownAccess);
  return { href, access };
}

/**
 * Build nav sections HTML string for embedding in nav.js
 *
 * Takes no order map: nav links number themselves as they are emitted, which is
 * what keeps them in step with buildSidebarOrderMap. The map was only ever read
 * by the removed Tools `Guides` block.
 */
function buildNavSectionsHtml(filesBySection) {
  let html = '';

  // Shown only while the sidebar is locked (body.is-signed-out, see
  // applySessionLock in generateNavJs): before the chevron on a section, at
  // the trailing edge of a root link. Hidden from the accessibility tree —
  // aria-disabled carries the state and the lock note (aria-describedby)
  // the reason.
  // Under 'hidden' nothing in the list is ever locked: the Worker removes it
  // instead. The icon would be 300-odd unused SVGs in every page.
  const navLock = CONFIG.accessNav === 'hidden' ? '' : lockIcon('sidebar-nav-lock');

  // Shared chevron for section and subsection toggles
  const navChevron = `<span class="sidebar-nav-toggle-icon">
          <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
            <path d="M3.58943 3L1.28943 0.7L1.98943 0L4.98943 3L1.98943 6L1.28943 5.3L3.58943 3Z" fill="currentColor"/>
          </svg>
        </span>`;

  // Section icons (config: sectionIcons — section label → icon key)
  const sectionIconMap = {};
  for (const [sectionName, iconKey] of Object.entries(CONFIG.sectionIcons)) {
    sectionIconMap[sectionName] = { icon: getRawIcon(iconKey) };
  }

  // Root-level links above the section list (config: rootLinks — array of
  // { title, href, icon, access?, requires? }). Each renders as a single nav
  // link in the same shape as the Home link, never as a one-item collapsible
  // section. For root pages that belong to no section (e.g. the Glossary).
  //
  // `requires: 'search'` ties a link to the search feature, which can be off
  // for a build and is always off inside a brand instance. Without it the
  // sidebar kept a Search entry pointing at a page the instance does not
  // have — the off switch produced a broken route rather than no route.
  // A link with `after: '<Section>'` renders straight after that section
  // instead of above the list (the Glossary after Tools, 2026-11-10); a site
  // without that section shows it at the top as before.
  const linksAfter = {};
  const presentSections = new Set(Object.keys(filesBySection));
  for (const link of CONFIG.rootLinks || []) {
    // Fail loudly on a bad entry — a silent skip here would ship a nav with a
    // missing or dead root link and nothing in the build output to say why.
    if (!link.title || !link.href) {
      console.error(`❌ rootLinks entry needs both title and href: ${JSON.stringify(link)}`);
      process.exit(1);
    }
    if (link.icon && !ICON_MAP[link.icon]) {
      console.error(`❌ rootLinks icon not in the registry: "${link.icon}" (${link.title})`);
      process.exit(1);
    }
    if (link.requires === 'search' && !CONFIG.search) continue;
    // One nav.js serves the whole site, so the instance half of the gate has
    // to be a runtime one — the same reason the search trigger and dialog are
    // gated in the emitted script rather than here.
    const engineOnly = link.requires === 'search' ? ' data-engine-only' : '';
    const rootIconHtml = link.icon ? `<span class="svg-icn">${getRawIcon(link.icon)}</span>` : '';
    const linkHtml = `<a href="${siteHref(link.href)}" class="sidebar-nav-link sidebar-nav-root-link" data-access="${escapeAttr(link.access || 'team')}"${engineOnly}${MOTION.sidebarItem} aria-label="${escapeAttr(link.title)}" data-tooltip="${escapeAttr(link.title)}" data-tooltip-position="right">${rootIconHtml}<span>${escapeAttr(link.title)}</span>${navLock}</a>`;
    if (link.after && presentSections.has(link.after)) (linksAfter[link.after] = linksAfter[link.after] || []).push(linkHtml);
    else html += linkHtml;
  }

  // Read ordering from _defaults.md (configurable per directory)
  const defaults = loadDefaults(DOCS_DIR);
  const sectionOrder = parseList(defaults['section-order'], DEFAULT_SECTION_ORDER);
  const sortedSections = Object.keys(filesBySection)
    .sort((a, b) => {
      const indexA = sectionOrder.indexOf(a);
      const indexB = sectionOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });

  for (const section of sortedSections) {
    const files = [...filesBySection[section]];
    const subsectionOrder = getSubsectionOrder(defaults, section);

    files.sort((a, b) => {
      const orderA = a.frontmatter.order || 999;
      const orderB = b.frontmatter.order || 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.title.localeCompare(b.title);
    });

    const sectionLabel = section.charAt(0).toUpperCase() + section.slice(1);

    const sectionIcon = sectionIconMap[section];
    const sectionFolder = SECTION_FOLDERS[section];
    // Absolute URLs (leading `/`) so links resolve from any page depth and survive
    // Barba transitions that don't update the surrounding chrome's data-base.
    const sectionIndexHref = sectionFolder ? siteHref('/' + sectionFolder + '/index.html') : '';
    // Slug used by Phase 3 directional transitions to detect same/different section
    const sectionSlug = slugifySection(section);
    const iconHtml = sectionIcon
      ? `<a href="${sectionIndexHref}" class="sidebar-nav-section-icon" data-section="${sectionSlug}" data-access="${indexLevel(sectionFolder)}" aria-label="${escapeAttr(sectionLabel)}"><span class="svg-icn">${sectionIcon.icon}</span></a>`
      : '';

    const sectionStart = html.length;
    const sectionEntries = [];
    html += `<details class="sidebar-nav-section"__ACCESS_ANY__${MOTION.sidebarItem}>
      <summary class="sidebar-nav-section-toggle" aria-label="${escapeAttr(sectionLabel)}" data-tooltip="${escapeAttr(sectionLabel)}" data-tooltip-position="right">
        ${iconHtml}<span>${sectionLabel}</span>
        ${navLock}${navChevron}
      </summary>
      <ul class="sidebar-nav-list">`;

    // Overview link (first item in every section, only when the section has a
    // folder and therefore an index page). data-order="0" so direction
    // detection always treats it as the lowest-order page in the section.
    if (sectionIndexHref) {
      html += `<li><a href="${sectionIndexHref}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="0" data-access="${indexLevel(sectionFolder)}"><span>Overview</span>${navLock}</a></li>`;
    }

    // Sequential counter mirrors buildSidebarOrderMap — same walk order, so the
    // data-order on each sidebar-nav-link matches the data-order on its destination
    // page's container. Resets per section, starts at 1 (0 is Overview).
    let navPos = 1;

    // Group files by subsection
    const ungrouped = files.filter(f => !f.frontmatter.subsection);
    const grouped = {};
    for (const file of files) {
      const sub = file.frontmatter.subsection;
      if (sub) {
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(file);
      }
    }

    // Render ungrouped files first
    for (const file of ungrouped) {
      // A guide that names its tool links the tool, in any section
      // (guideTarget). All hrefs are emitted as absolute paths.
      const target = guideTarget(file, section);
      const linkHref = siteHref(target.href);
      const linkAccess = target.access;
      sectionEntries.push({ level: linkAccess, path: linkHref });
      html += `<li><a href="${linkHref}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span>${navLock}</a></li>`;
      navPos++;
    }

    // A Tools entry above points at the tool app, not at the tool's guide page.
    // The guides used to be listed here too, under a `Guides` disclosure — but
    // every entry in it repeated a label from the list directly above, so the
    // sidebar showed each tool's name twice with nothing to say which was
    // which, and the guides went unread behind a collapsed group.
    //
    // They are still generated, and each one still links out to its tool. But
    // nothing links *in*: no tool app references its guide, and the section
    // index points only at the apps, so the guides are now reachable by URL or
    // by pager-walking the chain from the LLM Reference. That is the accepted
    // cost of removing the duplicate rows, and it is temporary — the intended
    // home for this content is a dialog opened from inside the tool, which is
    // the edge that has always been missing. See ROADMAP.
    //
    // A Tools page with no `actionUrl` is a guide with no app (the LLM
    // Reference), so it falls through the branch above and lists normally.

    // Render subsections in order
    const subsections = Object.keys(grouped).sort((a, b) => {
      const idxA = subsectionOrder.indexOf(a);
      const idxB = subsectionOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    // Each subsection is its own collapsed dropdown so long sections (Design
    // System, Brand Book) stay scannable. setActiveLink opens the active one.
    for (const sub of subsections) {
      const subEntries = grouped[sub].map((file) => { const t = guideTarget(file, section); return { level: t.access, path: siteHref(t.href) }; });
      sectionEntries.push(...subEntries);
      html += `<li${accessAnyAttr(subEntries)}><details class="sidebar-nav-subsection">
        <summary class="sidebar-nav-subsection-toggle"><span>${sub}</span>${navChevron}</summary>
        <ul class="sidebar-nav-sublist">`;
      for (const file of grouped[sub]) {
        const target = guideTarget(file, section);
        const linkAccess = target.access;
        html += `<li><a href="${siteHref(target.href)}" class="sidebar-nav-link" data-section="${sectionSlug}" data-order="${navPos}" data-access="${linkAccess}"><span>${file.title}</span>${navLock}</a></li>`;
        navPos++;
      }
      html += `</ul></details></li>`;
    }

    html += `</ul></details>`;
    html = html.slice(0, sectionStart) + html.slice(sectionStart).replace('__ACCESS_ANY__', accessAnyAttr(sectionEntries));
    if (linksAfter[section]) html += linksAfter[section].join('');
  }

  return html;
}

/**
 * Recursively copy a directory and all its contents.
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy brand assets from cms/brands/{brandKey}/assets/ to {OUTPUT_DIR}/{brandKey}/assets/.
 * Recursively copies all subdirectories (logos/, fonts/, etc.).
 * Runs before page generation so CSS, logos, and fonts are available.
 */
//------- Brand manifests (cms/brands/<brand>/brand.json) -------//
//
// The manifest is the single seam between brand settings and the build: a
// future CMS swaps this file read for an API read and nothing downstream
// changes. Presence of brand.json is the brand allowlist — a folder without
// one is skipped. The generator emits assets/js/theme-config.js wholesale
// from these manifests plus the pages it generates; nothing regex-rewrites
// the live JS file anymore.

/**
 * Resolve the favicon/OG chrome slots for a page. Brand manifests provide
 * absolute site paths; pages without a brand (or manifests without the keys)
 * fall back to the site defaults, resolved against the page's nav base.
 * Fallback favicon links are emitted only when the files actually exist in
 * the output — a project without favicons gets no dead links.
 */
function brandChromeSlots(manifest, base) {
  const m = manifest || {};
  const svg = siteHref(m.faviconSvg)
    || (fs.existsSync(path.join(OUTPUT_DIR, 'assets', 'icons', 'favicon.svg')) ? `${base}assets/icons/favicon.svg` : null);
  const ico = siteHref(m.faviconIco)
    || (fs.existsSync(path.join(OUTPUT_DIR, 'assets', 'icons', 'favicon.ico')) ? `${base}assets/icons/favicon.ico` : null);
  const links = [];
  if (svg) links.push(`<link rel="icon" type="image/svg+xml" href="${svg}">`);
  if (ico) links.push(`<link rel="icon" type="image/x-icon" href="${ico}">`);
  return {
    faviconLinks: links.length
      ? `<!-- Favicon (per-brand via brand.json, site default otherwise) -->\n    ${links.join('\n    ')}`
      : '',
    ogImage: siteHref(m.ogImage) || `${base}assets/images/og/og-default.jpg`,
  };
}

/**
 * window.THEME_CONFIG (brandOutputs.themeConfig), from brand.json, in one
 * write. JSON.stringify handles all quoting.
 */
function writeThemeConfig() {
  if (!BRAND) return;
  // The brand's keys (brand.js themeConfigPayload): name, wording, the
  // access route, hues, the named colours, the pair lists and the email
  // signature. Validated when the file was read, so nothing malformed
  // reaches a tool.
  writeBrandRuntimeFile(CONFIG.brandOutputs.themeConfig,
    brandFile.themeConfigJs(brandFile.themeConfigPayload(BRAND), ENGINE_VERSION));
}

/**
 * assets/js/bd-locale.js: the engine's words in this site's locale, for the
 * tool scripts' L() helpers (locale.js runtimeSource). Written on every run
 * for a site whose locale isn't en-GB, since every page loads it; on an
 * en-GB site a copy an earlier build left is removed, so nothing stale ships.
 */
function writeLocaleScript() {
  const out = path.join(OUTPUT_DIR, LOCALE_SCRIPT);
  if (CONVERT_LOCALE) {
    writeBrandRuntimeFile(LOCALE_SCRIPT, locale.runtimeSource(LOCALE, ENGINE_VERSION));
  } else if (fs.existsSync(out) && fs.readFileSync(out, 'utf8').startsWith(locale.RUNTIME_BANNER)) {
    fs.unlinkSync(out);
    console.log(`🗑️  Removed: ${LOCALE_SCRIPT} (the site is en-GB)`);
  }
}

/**
 * Fail a client site's build when a page it just wrote shows By Default's
 * name or addresses (failure scenario 11). The engine's own test keeps them
 * out of the package (scripts/verify-engine-wording.js); this catches a
 * client's content that carries them, such as a Brand Book page started from
 * By Default's. Skipped on the engine's own site. Pages this build wrote are
 * the ones modified since it started; hand-authored pages are not scanned.
 */
function checkClientWording(since) {
  if (!BRAND || BRAND.slug === brandFile.ENGINE_HOME_SLUG) return;
  const allowed = (file, match) => CONFIG.allowWording.some((a) =>
    a && a.file === file && a.text === match && typeof a.reason === 'string' && a.reason.trim());
  const skip = new Set(['node_modules', '_site', 'dist', '.git', 'experiments']);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.html') || fs.statSync(abs).mtimeMs < since) continue;
      const rel = path.relative(OUTPUT_DIR, abs).split(path.sep).join('/');
      for (const hit of brandFile.findEngineWording(fs.readFileSync(abs, 'utf8'))) {
        if (!allowed(rel, hit.match)) found.push(`  ${rel}:${hit.line}: "${hit.match}" in ${JSON.stringify(hit.text.slice(0, 120))}`);
      }
    }
  };
  walk(OUTPUT_DIR);
  if (found.length) {
    console.error(`\n❌ ${found.length} ${brandFile.ENGINE_NAME} mention(s) on this site's pages. A client site shows its own brand:\n${found.join('\n')}\n` +
      'Edit the page source, or, for a mention kept on purpose, add it to allowWording in docs.config.js with { file, text, reason }.\n');
    process.exit(1);
  }
}

/**
 * A file the engine loads for an installed app must not also be in the
 * site's own lists: most scripts bind document listeners with no guard, so
 * a second copy acts twice. Compared by file name, like the UI scripts.
 */
function assertNotListedTwice(engineFiles, siteFiles, listName) {
  const name = (src) => String(src).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
  const engine = new Map(engineFiles.map((f) => [name(f), f]));
  const twice = siteFiles.filter((f) => engine.has(name(f)));
  if (twice.length) {
    console.error(`\n❌ These are loaded by the engine for the installed apps, so remove them from ${listName} in docs.config.js:\n${twice.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
}

/**
 * A standalone page an app ships as a file (World Clock's embed), in the
 * site's locale: its words converted, its lang set, and the locale's
 * runtime loaded before its first script, so the scripts it runs read it.
 */
function localisedAppPage(rel, html) {
  const depth = rel.split('/').length - 1;
  const src = `${'../'.repeat(depth)}${LOCALE_SCRIPT}`;
  let out = locale.html(html).replace(/<html lang="en"/, `<html lang="${HTML_LANG}"`);
  const first = out.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length)).search(/<script\b/);
  if (first !== -1) out = `${out.slice(0, first)}<script src="${src}"></script>\n  ${out.slice(first)}`;
  return out;
}

/**
 * On a site built from the package, copy the installed apps' files to the
 * same paths they have in the engine. A file the site already has there,
 * with different bytes, is its own old copy: the build stops and says to
 * delete it, rather than overwrite a file the site committed. A page among
 * them is written in the site's locale (localisedAppPage).
 */
function copyAppFiles() {
  if (INSTALL.legacy) return;
  const fromPackage = path.resolve(APP_REGISTRY.filesRoot) !== path.resolve(ROOT);
  if (!fromPackage) return;
  // The record of what the engine wrote last time, at the output's root, out
  // of /assets/ so it isn't published with it
  const stamp = path.join(OUTPUT_DIR, '.engine-apps.json');
  const ours = new Set(fs.existsSync(stamp) ? JSON.parse(fs.readFileSync(stamp, 'utf8')) : []);
  const wanted = new Set([...INSTALL.scripts, ...INSTALL.styles, ...INSTALL.files]);
  // An app switched off since: its files go, so they are never served
  for (const rel of ours) {
    if (!wanted.has(rel)) fs.rmSync(path.join(OUTPUT_DIR, rel), { force: true });
  }
  const clashes = [];
  const written = [];
  for (const rel of [...INSTALL.scripts, ...INSTALL.styles, ...INSTALL.files]) {
    const src = path.join(APP_REGISTRY.filesRoot, rel);
    const dest = path.join(OUTPUT_DIR, rel);
    if (fs.existsSync(dest) && !ours.has(rel) && !fs.readFileSync(dest).equals(fs.readFileSync(src))) {
      clashes.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (CONVERT_LOCALE && rel.endsWith('.html')) fs.writeFileSync(dest, localisedAppPage(rel, fs.readFileSync(src, 'utf8')));
    else fs.copyFileSync(src, dest);
    written.push(rel);
  }
  if (clashes.length) {
    console.error(`\n❌ This site has its own copies where the engine's app files go. Delete them (the engine ships these now), and gitignore them:\n${clashes.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify(written.sort(), null, 2) + '\n');
  console.log(`📄 Copied ${written.length} app file${written.length === 1 ? '' : 's'} from the package`);
}

/**
 * /os.json: what this site runs, for the fleet dashboard (D6, phase F): the
 * engine's version, brand.json's version, and each installed app with its
 * version, status and package (os-json.js). Written on every full build: a
 * site not on `install` yet writes `apps` and `packages` as null, which the
 * dashboard shows. Checked against the shape before it is written, so a site
 * never sends the fleet service a report it would refuse. No build time:
 * two builds of the same tree are byte-identical.
 */
function writeOsJson() {
  const manifests = new Map([...APP_REGISTRY.apps].map(([slug, app]) => [slug, app.manifest]));
  const payload = osJson.payload({
    engine: ENGINE_VERSION,
    brand: BRAND,
    brandVersion: BRAND_FILE_VERSION,
    brandSiteName: BRAND ? brandFile.siteName(BRAND) : null,
    siteName: SITE.name,
    install: INSTALL,
    manifests,
  });
  const problems = osJson.validate(payload);
  if (problems.length) {
    console.error(`\n❌ os.json would not pass its own check:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'os.json'), JSON.stringify(payload, null, 2) + '\n');
  console.log(`📄 Generated: os.json (${payload.apps ? `${payload.apps.length} apps` : 'not on install yet'})`);
}

/**
 * The Logo Tool's manifest (window.LogoManifest), built from brand.json's
 * logos with each SVG's markup inlined. Every mark carries its own clear
 * space: the brand file fails the build before this runs if one doesn't.
 */
function writeLogoManifest() {
  if (!BRAND) return;
  writeBrandRuntimeFile(CONFIG.brandOutputs.logoManifest,
    brandFile.logoManifestJs(brandFile.logoManifestPayload(BRAND, ROOT), ENGINE_VERSION));
}

function writeBrandRuntimeFile(rel, js) {
  const out = path.join(OUTPUT_DIR, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, js);
  console.log(`📄 Generated: ${rel}`);
}

/**
 * worker/page-access.mjs - the pages half of the access gate (access-plan.md
 * §5, §12.4; permissions-plan.md §4.1): every generated page's level, section
 * and type by output URL, plus the section folders a group can be granted.
 * Serialised once, sorted, so two builds of the same tree are byte-identical.
 * The Worker imports it (worker/gate.mjs) at build time, never runtime: the
 * middleware serves static assets and must not parse frontmatter.
 * Infrastructure routes - /assets/, /image/, the login - stay in gate.mjs's
 * own static lists; this file holds pages and nothing else. A project with no
 * worker/ directory has no gate to feed, so nothing is written there. Brand
 * pages (cms/brands/**) never reach the map, whatever their frontmatter says:
 * the gate judges pages of this deployment's own site, and a brand page is a
 * decision for §11, not a flag.
 */
function writePageAccess() {
  const workerDir = path.join(ROOT, 'worker');
  if (!fs.existsSync(workerDir)) return;
  const entries = [...pageAccess.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const counts = Object.fromEntries(ACCESS_LEVELS.map((level) => [level, 0]));
  for (const [, entry] of entries) counts[entry.level]++;
  const sections = Object.fromEntries(
    Object.entries(SECTION_FOLDERS).map(([label, folder]) => [folder, label]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );
  const banner = `/**
 * page-access.mjs - GENERATED by cms/generator/generate-docs.js, do not edit.
 *
 * Every generated page by output URL, with the level its OWN frontmatter
 * declares, public, team, admin or owner (access-plan.md §12.4;
 * permissions-plan.md §3.1; levels-groups-plan.md D23). _defaults.md cannot
 * set a level; a missing field takes its section's default (sectionAccess in
 * docs.config.js), else team. The home shelf and the section indexes carry the index types,
 * which the gate opens to every signed-in reader; a section index takes its
 * section's default level too, so an admin or owner section's index is closed
 * like its pages. The site's worker passes it
 * to createGate() (worker/site-config.mjs here) as the pages half of the gate;
 * the infrastructure half is the engine's and the site's own public lists. To change a page's level, set the field and re-run a FULL docgen:
 * cd cms/generator && npm run docgen. A single-file run leaves this file alone.
 *
 * SECTIONS maps each output folder to its section label, the sections a
 * group can be granted (worker/people.js).
 *
 * SOURCE_PAGES maps each published markdown source to its page, so the gate
 * judges the source at the page's level (gate.mjs accessTarget()).
 *
 * ACCESS_NAV is docs.config.js accessNav: 'hidden' turns on the Worker's
 * per-reader cut of every page's links (worker/hidden-nav.mjs).
 *
 * APPS is the installed apps and the brand's primary logo: createGate mounts
 * the Image Placeholder's and the Asset Library's routes from it.
 *
 * NOT_INSTALLED maps the address of each app this site doesn't install, and
 * its guide's, to the app's name: the Worker answers them with the
 * not-installed page and a 404 (createGate notInstalled).
 *
 * APPLIED_LEVELS is the Settings level rows this build read and baked in (D27):
 * { pages: {path: level}, sections: {folder: level} }. The Levels API compares
 * the applied D1 rows against it to tell which changes still wait for a build.
 * Empty when the build read no settings source. A page a row moved carries its
 * code level as "code", so the API can work out what the next build bakes.
 * LEVELS_READ_AT is when this build read the rows from D1 (unix seconds), 0
 * when it read none: a change applied after it waits for the next build.
 */
`;
  // `code` only where a Settings row moved the page off its code level, so a
  // site with no settings writes this file byte-for-byte as before.
  const codeField = (p, e) => (CODE_LEVELS.has(p) && CODE_LEVELS.get(p) !== e.level ? `, code: ${JSON.stringify(CODE_LEVELS.get(p))}` : '');
  const lines = entries.map(([p, e]) => `  [${JSON.stringify(p)}, { level: ${JSON.stringify(e.level)}${codeField(p, e)}, section: ${JSON.stringify(e.section)}, type: ${JSON.stringify(e.type)}, title: ${JSON.stringify(e.title)} }],`);
  const sources = [...sourcePages.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const body = `export const ACCESS_NAV = ${JSON.stringify(CONFIG.accessNav)};\n\n`
    + `export const SECTIONS = Object.freeze(${JSON.stringify(sections)});\n\n`
    + `export const PAGE_ACCESS = new Map([\n${lines.join('\n')}\n]);\n\n`
    + `export const SOURCE_PAGES = new Map([\n${sources.map(([s, p]) => `  [${JSON.stringify(s)}, ${JSON.stringify(p)}],`).join('\n')}\n]);\n\n`
    + `export const APPS = Object.freeze(${JSON.stringify(installedAppsForWorker())});\n\n`
    + `export const NOT_INSTALLED = new Map([${[...notInstalledAddresses()].map(([a, n]) => `\n  [${JSON.stringify(a)}, ${JSON.stringify(n)}],`).join('')}\n]);\n\n`
    + `export const APPLIED_LEVELS = Object.freeze(${JSON.stringify(appliedLevelsForWorker(sections))});\n\n`
    + `export const LEVELS_READ_AT = ${LEVELS_READ_AT};\n`;
  fs.writeFileSync(path.join(workerDir, 'page-access.mjs'), banner + body);
  console.log(`📄 Generated: worker/page-access.mjs (${entries.length} pages: ${ACCESS_LEVELS.map((level) => `${counts[level]} ${level}`).join(', ')})`);
  if (levelsFromSection.length) {
    console.log(`🔐 ${levelsFromSection.length} page level(s) from sectionAccess:\n${levelsFromSection.map((line) => `   ${line}`).join('\n')}`);
  }
  const applied = LEVEL_SETTINGS.pages.size + LEVEL_SETTINGS.sections.size;
  console.log(`🔧 Level settings: ${applied ? `${applied} row(s) applied from ${LEVEL_SETTINGS.origin}` : `none (source: ${LEVEL_SETTINGS.origin})`}`);
}

// The Settings rows this build applied, for APPLIED_LEVELS. Plain objects so
// the generated file stays data; worker/site.mjs reads them back into Maps. A
// row whose page or section the build never wrote is warned and dropped here -
// the page map is complete by now, which it was not when LEVEL_SETTINGS loaded,
// so this is where an unknown target is finally caught (never a crash).
function appliedLevelsForWorker(sectionFolderMap) {
  const pages = {};
  const sections = {};
  for (const [k, v] of [...LEVEL_SETTINGS.pages.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!pageAccess.has(k)) { console.warn(`⚠️  Level setting skipped (unknown page): ${k}`); continue; }
    pages[k] = v;
  }
  for (const [k, v] of [...LEVEL_SETTINGS.sections.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!Object.prototype.hasOwnProperty.call(sectionFolderMap, k)) { console.warn(`⚠️  Level setting skipped (unknown section): ${k}`); continue; }
    sections[k] = v;
  }
  return { pages, sections };
}

/**
 * The gate's own modules, for checking against it at build time: beside the
 * docs kit in the package (dist/worker/), two folders up in the engine's repo.
 */
function engineWorkerDir() {
  const candidates = [path.join(__dirname, '..', 'worker'), path.join(__dirname, '..', '..', 'worker')];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'gate.mjs'))) || null;
}

/**
 * The gate's isPublicPath, judged with this site's own public lists, as the
 * deployed Worker judges them. A site's worker/site-config.mjs exports the
 * options it passes createGate() (SITE_OPTIONS) or configures itself
 * (configureThisSite), the way bd-search reads it; with neither, only the
 * engine's lists and the page map are known, so a file the site opens some
 * other way is reported, with how to declare it.
 */
async function sitePublicJudge() {
  const workerDir = engineWorkerDir();
  if (!workerDir) {
    console.error('\n❌ The access gate is on, but the gate\'s own files are missing from the package, so the sign-in pages can\'t be checked. Reinstall the package.\n');
    process.exit(1);
  }
  const { pathToFileURL } = require('url');
  const gate = await import(pathToFileURL(path.join(workerDir, 'gate.mjs')).href);
  const site = await import(pathToFileURL(path.join(workerDir, 'site.mjs')).href);
  const siteConfig = path.join(ROOT, 'worker', 'site-config.mjs');
  let source = 'the engine\'s public lists and the page map (no worker/site-config.mjs here)';
  if (fs.existsSync(siteConfig)) {
    try {
      const config = await import(pathToFileURL(siteConfig).href);
      if (config.SITE_OPTIONS) site.configureSite(config.SITE_OPTIONS);
      else if (typeof config.configureThisSite === 'function') config.configureThisSite();
      else throw new Error('it exports neither SITE_OPTIONS nor configureThisSite');
      source = 'worker/site-config.mjs';
    } catch (err) {
      console.warn(`⚠️  worker/site-config.mjs didn't load (${err.message}), so the sign-in pages are checked against the engine's public lists only.`);
    }
  }
  if (source !== 'worker/site-config.mjs') {
    // Configure the gate with what the build knows: every page by its level
    site.configureSite({ pages: new Map([...pageAccess].map(([p, e]) => [p, { ...e }])), sections: {}, hosts: ['example.com'] });
  }
  return { isPublicPath: gate.isPublicPath, source };
}

/** The character references an attribute value can carry, decoded. */
function decodeHtmlAttr(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|quot|apos|lt|gt));?/gi, (match, hex, dec, name) => {
    if (hex || dec) {
      const code = parseInt(hex || dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[name.toLowerCase()];
  });
}

/**
 * Every start tag in some HTML, with its attributes read the way a browser
 * reads them: a tag scanned character by character, values double-quoted,
 * single-quoted or bare (a bare one may hold an apostrophe), names
 * lowercased, references decoded. Nothing that loads nothing is read as
 * markup: comments, what is inside a <template> (the tag itself kept), and
 * the text of the raw-text elements (<script>, <textarea>, <title>), where
 * "<img src=…>" in a string is text. A <style> element's text comes back as
 * the tag's `css`.
 */
function htmlTags(html) {
  const styles = [];
  const text = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<template(?=[\s/>])[^>]*>)[\s\S]*?<\/template\s*>/gi, '$1')
    .replace(/(<(script|textarea|title|style)(?=[\s/>])[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (match, open, name, body, close) => {
      if (name.toLowerCase() !== 'style') return open + close;
      styles.push(body);
      return `${open.slice(0, -1)} data-bd-style-text="${styles.length - 1}">${close}`;
    });
  const n = text.length;
  const space = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  const tags = [];
  let i = 0;
  while ((i = text.indexOf('<', i)) !== -1) {
    const start = /^<([a-z][a-z0-9-]*)/i.exec(text.slice(i, i + 80));
    if (!start) { i++; continue; }
    let j = i + start[0].length;
    const attrs = new Map();
    while (j < n) {
      while (j < n && (space(text[j]) || text[j] === '/')) j++;
      if (j >= n) break;
      if (text[j] === '>') { j++; break; }
      let k = j + 1; // a name may start with "=", as HTML allows
      while (k < n && !space(text[k]) && text[k] !== '/' && text[k] !== '>' && text[k] !== '=') k++;
      const name = text.slice(j, k).toLowerCase();
      j = k;
      while (j < n && space(text[j])) j++;
      let value = '';
      if (text[j] === '=') {
        j++;
        while (j < n && space(text[j])) j++;
        const quote = text[j];
        if (quote === '"' || quote === "'") {
          const close = text.indexOf(quote, j + 1);
          const stop = close === -1 ? n : close;
          value = text.slice(j + 1, stop);
          j = stop + 1;
        } else {
          let k2 = j;
          while (k2 < n && !space(text[k2]) && text[k2] !== '>') k2++;
          value = text.slice(j, k2);
          j = k2;
        }
      }
      if (!attrs.has(name)) attrs.set(name, decodeHtmlAttr(value));
    }
    const tag = { name: start[1].toLowerCase(), attrs };
    if (tag.name === 'style' && attrs.has('data-bd-style-text')) {
      tag.css = styles[Number(attrs.get('data-bd-style-text'))] || '';
      attrs.delete('data-bd-style-text');
    }
    tags.push(tag);
    i = j;
  }
  return tags;
}

/**
 * A reference as the site path the Worker is asked for: resolved against
 * the page, still percent-encoded, as the request arrives. Null for another
 * origin (not the gate's to judge), a fragment, a data: or other scheme, or
 * anything a browser wouldn't fetch either.
 */
function sitePathOf(ref, baseUrl) {
  const value = String(ref || '').trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.origin === new URL(baseUrl).origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * The files a page loads by its markup, as site paths (sitePathOf): every
 * link but a navigation hint, scripts, images and their srcset, media and
 * frames, SVG <use> and <image>, and the url() and @import inside <style>
 * blocks and style="" attributes. A plain <a href> is a navigation, not a
 * load, so it is not one of them.
 */
function referencedFiles(html, pageUrl) {
  const refs = [];
  const add = (ref) => {
    const sitePath = sitePathOf(ref, pageUrl);
    if (sitePath) refs.push(sitePath);
  };
  const SRC = new Set(['script', 'img', 'source', 'video', 'audio', 'track', 'iframe', 'embed', 'input']);
  const SVG_HREF = new Set(['use', 'image', 'feimage']);
  for (const tag of htmlTags(html)) {
    const at = (name) => tag.attrs.get(name);
    if (tag.name === 'link') {
      const rel = (at('rel') || '').toLowerCase().split(/\s+/);
      if (!rel.some((r) => ['canonical', 'alternate', 'preconnect', 'dns-prefetch', 'next', 'prev', 'author', 'help', 'license', 'search'].includes(r))) {
        add(at('href'));
        for (const candidate of (at('imagesrcset') || '').split(',')) add(candidate.trim().split(/\s+/)[0]);
      }
    }
    if (SRC.has(tag.name) && (tag.name !== 'input' || (at('type') || '').toLowerCase() === 'image')) add(at('src'));
    if (tag.name === 'img' || tag.name === 'source') {
      for (const candidate of (at('srcset') || '').split(',')) add(candidate.trim().split(/\s+/)[0]);
    }
    if (tag.name === 'video') add(at('poster'));
    if (tag.name === 'object') add(at('data'));
    if (SVG_HREF.has(tag.name)) add(at('href') || at('xlink:href'));
    if (tag.css) refs.push(...cssReferences(tag.css, pageUrl));
    if (at('style')) refs.push(...cssReferences(at('style'), pageUrl));
  }
  return refs;
}

/** What a stylesheet loads in its turn: url() and @import, as site paths. */
function cssReferences(css, cssUrl) {
  const refs = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    const sitePath = sitePathOf(m[1] || m[2] || m[3] || m[4] || m[5], cssUrl);
    if (sitePath) refs.push(sitePath);
  }
  return refs;
}

/**
 * Phase D's checks on the pages a reader meets at the door, after the page
 * map is written. A broken sign-in page locks everyone out, the owner too,
 * and it breaks silently in a signed-out browser, so each fails the build:
 *
 *   1. The sign-in and Ask for access pages exist, and are public.
 *   2. Every file a public bare page loads, from its template or its own
 *      markup, and every file those stylesheets load in turn, is public at
 *      the gate (PD-1: the check covers the template as a whole), judged by
 *      the encoded path the Worker is asked for, and is in the output: a
 *      file a later build step adds is named in doorFilesAddedLater.
 *   3. The sign-in page carries every id auth-login.js reads, and keeps what
 *      makes it usable without sight: the email field's label, the error
 *      lines as alerts described by their fields, and the confirmation line
 *      as a status.
 */
async function checkDoorPages(allFiles) {
  const ENGINE = appsRegistry.ENGINE_PATHS;
  const problems = [];
  const levelAt = (address) => (pageAccess.get(address) || {}).level;
  for (const [address, page] of [[ENGINE.login, 'auth-login.md'], [ENGINE.support, 'support.md']]) {
    if (!pageAccess.has(address)) {
      problems.push(`  ${address} wasn't built, so a signed-out reader has no way in. The engine's ${page} ships with the package; if this site has its own cms/${page}, it must build (not a draft, not switched off).`);
    } else if (levelAt(address) !== 'public') {
      problems.push(`  ${address} is a ${levelAt(address)} page. It is the way in for a signed-out reader, so its source says access: "public".`);
    }
  }

  // Encoded as the paths they are compared with are
  const later = new Set(CONFIG.doorFilesAddedLater.map((p) => {
    try { return new URL(siteHref(String(p)), 'https://site.invalid').pathname; } catch { return String(p); }
  }));
  const bare = allFiles.filter((f) => resolvePageType(f.frontmatter).name === 'bare' && levelAt('/' + f.htmlPath) === 'public');
  if (bare.length) {
    const judge = await sitePublicJudge();
    const missing = [];
    for (const file of bare) {
      const address = '/' + file.htmlPath;
      const pageUrl = `https://site.invalid${siteHref(address)}`;
      const html = fs.readFileSync(path.join(OUTPUT_DIR, file.htmlPath), 'utf8');
      const gated = [];
      const seen = new Set();
      const visit = (sitePath, from) => {
        if (seen.has(sitePath)) return;
        seen.add(sitePath);
        if (!judge.isPublicPath(sitePath)) gated.push(from ? `${sitePath} (from ${from})` : sitePath);
        // The file on disk is the decoded name; the Worker was judged on the encoded one
        let onDisk = sitePath;
        try { onDisk = decodeURIComponent(sitePath); } catch { /* a malformed escape: look for it as written */ }
        // accessGate refuses a basePath, so a site path is the output path
        const local = path.join(OUTPUT_DIR, onDisk.replace(/^\//, ''));
        if (!fs.existsSync(local)) {
          if (!later.has(sitePath)) missing.push(`${sitePath} (on ${address}${from ? `, from ${from}` : ''})`);
          return;
        }
        if (/\.css$/i.test(sitePath)) {
          for (const ref of cssReferences(fs.readFileSync(local, 'utf8'), `https://site.invalid${sitePath}`)) visit(ref, sitePath);
        }
      };
      for (const ref of referencedFiles(html, pageUrl)) visit(ref, null);
      if (gated.length) {
        problems.push(`  ${address} loads ${gated.length === 1 ? 'a file' : 'files'} the gate keeps behind the sign-in, so a signed-out browser can't fetch ${gated.length === 1 ? 'it' : 'them'}:\n${gated.map((g) => `      ${g}`).join('\n')}`);
      }
    }
    if (problems.some((p) => p.includes('keeps behind the sign-in'))) {
      problems.push(`  Judged with ${judge.source}. Move each file under /assets/, or open it in the options your worker passes createGate() (publicPaths, publicPrefixes), exported as SITE_OPTIONS from worker/site-config.mjs so the build sees them.`);
    }
    if (missing.length) {
      problems.push(`  The door pages load ${missing.length === 1 ? 'a file' : 'files'} that ${missing.length === 1 ? "isn't" : "aren't"} in the output, so a signed-out reader gets a broken page:\n${missing.map((m) => `      ${m}`).join('\n')}\n  If a later build step copies ${missing.length === 1 ? 'it' : 'them'} in, name ${missing.length === 1 ? 'it' : 'each'} in docs.config.js doorFilesAddedLater.`);
    }
  }

  // The sign-in page's form, against the script that drives it
  const login = allFiles.find((f) => '/' + f.htmlPath === ENGINE.login);
  if (login) {
    const script = path.join(APP_REGISTRY.filesRoot, 'assets', 'js', 'auth-login.js');
    const html = fs.readFileSync(path.join(OUTPUT_DIR, login.htmlPath), 'utf8');
    const ids = fs.existsSync(script)
      ? [...new Set([...fs.readFileSync(script, 'utf8').matchAll(/getElementById\(\s*['"]([a-z0-9-]+)['"]\s*\)/g)].map((m) => m[1]))]
      : [];
    if (!ids.length) problems.push(`  auth-login.js wasn't found in the package (${script}), so the sign-in page can't be checked. Reinstall the package.`);
    const tags = htmlTags(html);
    const present = new Set(tags.map((t) => t.attrs.get('id')).filter(Boolean));
    const absent = ids.filter((id) => !present.has(id));
    if (absent.length) {
      problems.push(`  ${ENGINE.login} is missing ${absent.map((id) => `#${id}`).join(', ')}, which auth-login.js reads. Without ${absent.length === 1 ? 'it' : 'them'} the page can't sign anyone in. Start a replacement cms/auth-login.md from the engine's.`);
    }
    // What a screen reader needs from it, which no id check sees
    const lost = [];
    if (!tags.some((t) => t.name === 'label' && t.attrs.get('for') === 'login-email')) lost.push('<label for="login-email">, the email field\'s name');
    const errorLines = tags.filter((t) => (t.attrs.get('class') || '').split(/\s+/).includes('form-error'));
    if (!errorLines.length) lost.push('the .form-error lines that say what went wrong');
    const silent = errorLines.filter((t) => t.attrs.get('role') !== 'alert');
    if (silent.length) lost.push(`role="alert" on ${silent.map((t) => (t.attrs.get('id') ? `#${t.attrs.get('id')}` : 'a .form-error line')).join(', ')}, so an error is announced`);
    // The error text reaches each field through its description
    for (const [field, line] of [['login-email', 'login-email-error'], ['login-code', 'login-code-error']]) {
      const input = tags.find((t) => t.attrs.get('id') === field);
      if (input && !(input.attrs.get('aria-describedby') || '').split(/\s+/).includes(line)) lost.push(`aria-describedby="${line}" on #${field}, so its error is read with the field`);
    }
    const success = tags.find((t) => t.attrs.get('id') === 'login-success');
    if (success && success.attrs.get('role') !== 'status') lost.push('role="status" on #login-success, so "Code sent" is announced');
    if (lost.length) {
      problems.push(`  ${ENGINE.login} has lost ${lost.length === 1 ? 'something' : 'things'} a reader using a screen reader needs:\n${lost.map((l) => `      ${l}`).join('\n')}`);
    }
  }

  if (problems.length) {
    console.error(`\n❌ The sign-in pages can't ship as they are:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  console.log(`🚪 Door pages checked: ${allFiles.filter((f) => resolvePageType(f.frontmatter).name === 'bare').length} bare page(s), each file they load is public at the gate`);
}

/**
 * What createGate() needs to mount the installed apps' routes (B4): the
 * installed slugs, and the brand's primary logo for the Image Placeholder,
 * as a site path the asset layer serves.
 */
function installedAppsForWorker() {
  let imageLogo = null;
  const logos = BRAND && BRAND.logos;
  if (logos && Array.isArray(logos.variants)) {
    const primary = logos.variants.find((v) => v.id === logos.primary) || logos.variants[0];
    if (primary && primary.file) imageLogo = '/' + String(primary.file).replace(/^\.?\//, '');
  }
  const embeds = INSTALL.installed.map((slug) => APP_REGISTRY.apps.get(slug).manifest.embed).filter(Boolean).sort();
  // An embed is public and frameable, so it can never be a page the build
  // gave a level: that would open it to everyone
  const gated = embeds.filter((address) => pageAccess.has(address) && pageAccess.get(address).level !== 'public');
  if (gated.length) {
    console.error(`\n❌ An app's embed would open a page that has a level: ${gated.join(', ')}. An embed is its own standalone page, never an app or a doc page.\n`);
    process.exit(1);
  }
  return { installed: [...INSTALL.installed].sort(), imageLogo, embeds };
}

/**
 * The pages an earlier build wrote for an app this site no longer installs,
 * and for its guide: deleted, so a switched-off app leaves nothing behind
 * (the Worker answers those addresses with the not-installed page).
 */
function removeUninstalledOutputs() {
  for (const address of notInstalledAddresses().keys()) {
    const out = path.join(OUTPUT_DIR, address.replace(/^\//, ''));
    if (fs.existsSync(out)) {
      fs.rmSync(out);
      console.log(`🧹 Removed: ${address.slice(1)} (its app isn't installed)`);
    }
  }
}

/**
 * A guide the package ships can link to a page this site doesn't have: one
 * of the engine's own docs pages, an app in a package the site doesn't
 * install, an app switched off. On this site that link is plain text, so
 * the guide never ships a dead link. A page the site writes itself fails
 * the build instead when it links to an app or section the site switched
 * off (failure scenario 6); its other links stay its own business. Reads
 * what stampBodyLinks stamped (data-access), so only body links count.
 */
function unlinkMissingPages(allFiles) {
  const missing = notInstalledAddresses();
  const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')`;
  const anchor = new RegExp(`<a\\b(${ATTRS}*?)\\shref="([^"]+)"(${ATTRS}*?) data-access="[a-z]+">([\\s\\S]*?)<\\/a>`, 'g');
  const unlinked = [];
  const broken = [];
  for (const file of allFiles) {
    const fromPackage = GUIDES.sources.has(file.markdownPath);
    // A site's own page is checked only against what it switched off: its
    // other links are its own business, as before
    if (!fromPackage && !missing.size) continue;
    const out = path.join(OUTPUT_DIR, file.htmlPath);
    if (!fs.existsSync(out)) continue;
    const pagePath = '/' + file.htmlPath;
    const html = fs.readFileSync(out, 'utf8');
    const next = html.replace(anchor, (match, before, href, after, text) => {
      let target;
      try {
        target = new URL(href, `https://x${CONFIG.basePath}${pagePath}`).pathname;
      } catch {
        return match;
      }
      if (CONFIG.basePath && target.startsWith(`${CONFIG.basePath}/`)) target = target.slice(CONFIG.basePath.length);
      if (target.endsWith('/')) target += 'index.html';
      try { target = decodeURI(target); } catch { /* a malformed escape stays as written */ }
      if (!fromPackage) {
        if (missing.has(target)) broken.push(`  ${pagePath.slice(1)} links to ${target} (${missing.get(target)}, not installed)`);
        return match;
      }
      const exists = pageAccess.has(target) || fs.existsSync(path.join(OUTPUT_DIR, target.slice(1)));
      if (exists && !missing.has(target)) return match;
      unlinked.push({ pagePath, target });
      return text;
    });
    if (next !== html) fs.writeFileSync(out, next);
  }
  if (broken.length) {
    console.error(`\n❌ ${broken.length} link(s) point at an app or section this site doesn't install (docs.config.js install). Remove the link, or install it:\n${broken.join('\n')}\n`);
    process.exit(1);
  }
  if (!unlinked.length) return;
  // A link that is gone points nowhere, so it can't point above its page
  for (let i = bodyLinkViolations.length - 1; i >= 0; i--) {
    if (unlinked.some((u) => bodyLinkViolations[i].startsWith(`  ${u.pagePath} (`) && bodyLinkViolations[i].includes(` links to ${u.target} (`))) bodyLinkViolations.splice(i, 1);
  }
  console.log(`🔗 ${unlinked.length} link(s) in the package's guides point at a page this site doesn't have, and read as text:\n${unlinked.map((u) => `   ${u.pagePath.slice(1)} → ${u.target}`).join('\n')}`);
}

/**
 * The address of every app this site doesn't install, and of its guide, with
 * the app's name (PB-4), sorted. Nothing for a legacy site, for a draft, for
 * an engine-home app, or for an address the build wrote a page to.
 */
function notInstalledAddresses() {
  const out = new Map();
  if (INSTALL.legacy) return out;
  for (const [address, section] of OFF_SECTION_PAGES) out.set(address, section);
  for (const [slug, app] of APP_REGISTRY.apps) {
    const m = app.manifest;
    if (INSTALL.installed.includes(slug) || m.status === 'draft' || m.package === 'internal') continue;
    // An app the site doesn't install can't stop its build: a bad token keeps the slug
    const title = parseFrontmatter(readPageSource(app.md)).frontmatter.title || slug;
    const tokens = siteTokens();
    const name = title.replace(/\{\{brand:([a-zA-Z]+)\}\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : slug));
    const section = app.frontmatter.section || 'Tools';
    out.set(`/${SECTION_FOLDERS[section] || section.toLowerCase()}/${slug}.html`, name);
    if (m.embed) out.set(m.embed, name);
    if (m.guide) {
      const source = [path.join(DOCS_DIR, m.guide), path.join(APP_REGISTRY.guidesDir, m.guide)].find((f) => fs.existsSync(f));
      if (source) {
        const guide = deriveOutputPath(m.guide, parseFrontmatter(readPageSource(source)).frontmatter.section);
        out.set(`/${guide.folder ? `${guide.folder}/` : ''}${guide.htmlName}`, name);
      }
    }
  }
  return new Map([...out].filter(([address]) => !pageAccess.has(address)).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/**
 * experiments/site-map-data.js — every page as data for the site-map
 * experiment (cms/generator/site-map.js has the walk and the contract).
 * Written under experiments/, never /assets/: the file lists every gated URL.
 */
function writeSiteMapData(allFiles, cmsDefaults) {
  const { js, nodes } = siteMap.renderSiteMapData({
    root: ROOT,
    docsDir: DOCS_DIR,
    allFiles,
    sectionOrder: parseList(cmsDefaults['section-order'], DEFAULT_SECTION_ORDER),
    subsectionOrder: (section) => getSubsectionOrder(cmsDefaults, section),
    sectionFolders: SECTION_FOLDERS,
    pageTypes: Object.keys(PAGE_TYPES),
    parseFrontmatter,
  });
  const out = path.join(ROOT, siteMap.DATA_FILE);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, js);
  const planned = nodes.filter(n => n.status === 'planned').length;
  console.log(`📄 Generated: ${siteMap.DATA_FILE} (${nodes.length} pages, ${planned} planned)`);
}

/**
 * worker/library-index.mjs — the Asset Library's download map, "<asset id>/
 * <filename>" → [R2 key, mime, size], imported by worker/library.js. Same
 * contract as page-access.mjs above: generated, sorted, byte-identical for
 * the same tree, and the Worker's only knowledge of what the catalog offers —
 * a path not in it is a 404 whatever the bucket holds. Written even when
 * there is no catalog, as an empty Map, so the import never dangles.
 */
function writeLibraryIndex() {
  const workerDir = path.join(ROOT, 'worker');
  if (!fs.existsSync(workerDir)) return;
  const { catalog, lock } = loadValidatedLibrary();
  const entries = assetLibrary.buildIndex(catalog, lock);
  // The level the library's downloads need, as the tool page's container
  // says it (downloadAccess, else the page's access): the Worker checks it on
  // every original, so the lock in download-lock.js is never only a button.
  const libraryApp = installedApp('asset-library');
  const app = libraryApp ? libraryApp.frontmatter : {};
  const level = app.downloadAccess ? normaliseLevel(app.downloadAccess) : deriveDataAccess(app);
  fs.writeFileSync(path.join(workerDir, 'library-index.mjs'), assetLibrary.renderLibraryIndex(entries, level));
  console.log(`📄 Generated: worker/library-index.mjs (${entries.length} downloadable file${entries.length === 1 ? '' : 's'})`);
}

/**
 * Generate the tool app pages from cms/apps/.
 *
 * Each tool is a pair: `<slug>.md` carrying only frontmatter, and `<slug>.html`
 * carrying the body that goes between <main> and </main>. Two files rather than
 * one because the body cannot go through markdownToHtml — its post-passes
 * rewrite <table> into .table-scroll > table.table, inject copy buttons into
 * <pre><code> and chipify inline <code>, all of which are right for prose and
 * wrong for an application's markup. cpm-calculator has a <table> that would be
 * silently rewritten.
 *
 * These pages deliberately do NOT join filesBySection. The sidebar and the
 * Tools index already link to them through their doc page's `actionUrl`; adding
 * them again would list every tool twice.
 *
 * Output paths are unchanged from when these were hand-written (tools/<slug>.html)
 * because those URLs are public and the doc pages point at them.
 */
/**
 * Fill in the destination for a close link that does not name one.
 *
 * `<a data-page-close>` with no href gets the section index — the same place a
 * doc page's close goes, so the default is "up one level" without every tool
 * having to repeat the path. An author-supplied href is left alone, which is
 * how a tool that should close somewhere else says so.
 */
function fillPageClose(body, sectionHref) {
  return body.replace(/<a\s([^>]*\bdata-page-close(?![-\w])[^>]*)>/g, (match, attrs) => {
    // `(?![-\w])` so data-page-close-target and friends are not mistaken for
    // the attribute itself — \b alone treats the hyphen as a boundary and
    // would silently rewrite an unrelated anchor's href.
    //
    // `\bhref` alone also matches data-href and xlink:href, which would read
    // as author-supplied and leave the link inert. Require a real href.
    if (/(^|\s)href\s*=/.test(attrs)) return match;
    return `<a href="${sectionHref}" ${attrs}>`;
  });
}

/**
 * Strip HTML comments before scanning a body for the close.
 *
 * Without this a commented-out close satisfies the gate, and fillPageClose
 * cheerfully injects an href inside the comment — the page ships with no way
 * out, which is the one thing the gate exists to prevent.
 */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

// The page sources in a standalone source directory: each .md but a README
// or an _-prefixed partial. One rule for the writer below and the bare-page
// list nav.js hands the router (generateDocs), so the two can't drift.
function sourceDirPageFiles(srcDir) {
  return fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.md') && !f.startsWith('README') && !f.startsWith('_'))
    .sort();
}

/**
 * Generate pages from a standalone source directory under cms/.
 *
 * Two directories use this: `cms/apps/` (the tools) and `cms/examples/` (one
 * live specimen per page type). Both hold pages that join no section — the
 * sidebar and the section indexes never list them, because both are reached
 * from somewhere specific: a tool from its doc page's action button, an
 * example from the page-layouts reference.
 *
 * A page is a `<slug>.md` carrying frontmatter. Types whose body is HTML
 * (`tool`, `page`) take theirs from a sibling `<slug>.html`, verbatim; types
 * whose body is markdown take it from the .md itself. That split is what stops
 * an application's markup going through markdownToHtml, whose post-passes
 * rewrite tables, code blocks and inline code.
 *
 * @param {object}  opts.dirName       directory under cms/
 * @param {string}  opts.outputFolder  fixed output folder, or null to derive
 *                                     it from the page's section
 * @param {string}  opts.defaultSection section when frontmatter omits one
 * @param {boolean} opts.toolHook      emit data-tool="<slug>" on the container
 * @param {string}  opts.closeHref     where a close goes, and the breadcrumb's
 *                                     first crumb. Defaults to the output
 *                                     folder's index, which is right for a tool
 *                                     but wrong for a directory that has none
 * @param {string}  opts.closeLabel    the crumb's text
 * @param {string}  opts.bareTemplate  template-bare.html, for a `bare` page
 */
function generateSourceDirPages(template, {
  dirName,
  outputFolder = null,
  defaultSection = 'Tools',
  toolHook = false,
  closeHref = null,
  closeLabel = null,
  bareTemplate = null,
}) {
  const srcDir = path.join(DOCS_DIR, dirName);
  // The apps come from the registry (apps.js): the installed ones, each from
  // the package or the site's own override. Any other source folder is read
  // as it stands.
  const fromRegistry = dirName === 'apps';
  if (!fromRegistry && !fs.existsSync(srcDir)) return [];

  const mdFiles = fromRegistry
    ? INSTALL.installed.map((slug) => `${slug}.md`)
    : sourceDirPageFiles(srcDir);
  const mdPathOf = (filename) => (fromRegistry ? APP_REGISTRY.apps.get(filename.replace(/\.md$/, '')).md : path.join(srcDir, filename));
  // A site with no install list reads only its own files, as before phase B
  const bodyPathOf = (slug) => {
    const app = fromRegistry && !INSTALL.legacy ? APP_REGISTRY.apps.get(slug) : null;
    return app && app.html ? app.html : path.join(srcDir, `${slug}.html`);
  };

  const closeErrors = [];
  const generated = [];

  for (const filename of mdFiles) {
    const slug = filename.replace(/\.md$/, '');
    const bodyPath = bodyPathOf(slug);

    const parsed = parseFrontmatter(readPageSource(mdPathOf(filename)));
    const frontmatter = parsed.frontmatter;
    // An app's title and description can name the brand too ({{brand:key}}),
    // so an engine app's meta tags read as the site's own
    for (const key of ['title', 'description']) {
      if (typeof frontmatter[key] === 'string' && frontmatter[key].includes('{{brand:')) {
        frontmatter[key] = frontmatter[key].replace(/\{\{brand:([a-zA-Z]+)\}\}/g, (match, token) => {
          const tokens = siteTokens();
          if (!tokens || !Object.prototype.hasOwnProperty.call(tokens, token)) {
            closeErrors.push(`  ${dirName}/${slug}.md — ${match} in its ${key} ${tokens ? "isn't a brand token" : 'needs a brand.json (brandManifest)'}`);
            return match;
          }
          // Escaped: the title and description go into the page as markup.
          return escapeAttr(tokens[token]);
        });
      }
    }

    if (frontmatter.status === 'draft') {
      console.log(`⏭️  Skipped (draft): ${dirName}/${filename}`);
      continue;
    }

    const type = resolvePageType(frontmatter);
    if (!type) {
      closeErrors.push(`  ${dirName}/${slug}.md — invalid type "${frontmatter.type}" (valid: ${Object.keys(PAGE_TYPES).join(', ')})`);
      continue;
    }
    if (!isValidAccess(frontmatter.access)) {
      closeErrors.push(`  ${dirName}/${slug}.md - invalid access "${frontmatter.access}" (must be one of: ${ACCESS_LEVELS.join(', ')}, or absent, which is the section default or team)`);
      continue;
    }
    // The level a tool's downloads need, when the page opens wider than its
    // files (a public Icon Library whose SVGs are the team's). Defaults to
    // the page's own level, so a tool that says nothing changes nothing.
    // download-lock.js reads it off the container as data-download-access.
    if (!isValidAccess(frontmatter.downloadAccess)) {
      closeErrors.push(`  ${dirName}/${slug}.md - invalid downloadAccess "${frontmatter.downloadAccess}" (must be one of: ${ACCESS_LEVELS.join(', ')}, or absent, which is the page's access)`);
      continue;
    }


    // An HTML-bodied type needs its sibling; a markdown-bodied one must not
    // have one, or the .md's own content would be silently ignored.
    let body;
    if (type.body === 'html') {
      if (!fs.existsSync(bodyPath)) {
        throw new Error(`cms/${dirName}/${filename} declares type "${type.name}", which needs a ${slug}.html body`);
      }
      body = readPageSource(bodyPath).trimEnd();
    } else {
      if (fs.existsSync(bodyPath)) {
        throw new Error(`cms/${dirName}/${slug}.html is ignored — type "${type.name}" takes its body from the markdown`);
      }
      body = markdownToHtml(parsed.content, undefined, pageHeadingIds(mdPathOf(filename)));
    }

    const section = frontmatter.section || defaultSection;
    const folder = outputFolder || SECTION_FOLDERS[section] || section.toLowerCase();
    // The section default, as for a cms page (D18): written onto the
    // frontmatter so the map, the cards and the body all read one level.
    const sectionAccess = ownOrSectionAccess(frontmatter.access, folder, `${folder}/${slug}.html`);
    if (sectionAccess !== undefined) frontmatter.access = sectionAccess;
    const downloadAccess = frontmatter.downloadAccess ? normaliseLevel(frontmatter.downloadAccess) : deriveDataAccess(frontmatter);
    const navBase = '../';
    const upHref = siteHref(closeHref || `/${folder}/index.html`);
    const upLabel = closeLabel || section;

    // The close contract, enforced only where the type makes it: a `tool` owns
    // its whole layout, so the generator cannot place a close for it — but it
    // can refuse to ship one the reader cannot leave.
    //
    // Scanned with comments stripped: a commented-out close would otherwise
    // satisfy the gate and ship a page with no way out.
    const needsClose = type.name === 'tool' && !type.stickyBar;
    if (needsClose) {
      const scannable = stripHtmlComments(body);
      if ((scannable.match(/\sdata-page-close(?![-\w])/g) || []).length === 0) {
        closeErrors.push(`  ${dirName}/${slug}.html — no element carries data-page-close`);
        continue;
      }
    }

    // {{icon:name}} works in an HTML body the same way it works in markdown.
    // That body skips markdownToHtml, which is where the expansion normally
    // happens, so it is done here — otherwise every tool would have to paste
    // raw SVG, which is how these files accumulated it in the first place.
    let content = fillPageClose(body, upHref);
    if (type.body === 'html') {
      content = expandCloseIcon(content.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name)));
      // {{brand:key}}: the brand's own name and addresses (brand.js
      // brandTokens), so an app page never carries one brand's copy. An
      // unknown key or a site with no brand.json fails here, by name.
      content = content.replace(/\{\{brand:([a-zA-Z]+)\}\}/g, (match, key) => {
        const tokens = siteTokens();
        if (!tokens || !Object.prototype.hasOwnProperty.call(tokens, key)) {
          closeErrors.push(`  ${dirName}/${slug}.html — ${match} ${tokens ? `isn't a brand token (known: ${Object.keys(tokens).join(', ')})` : 'needs a brand.json (brandManifest)'}`);
          return match;
        }
        return escapeAttr(tokens[key]);
      });
      // {{icon-manifest}} resolves only in an HTML body like this one; in
      // markdown it warns instead (markdownToHtml). Line-anchored like
      // {{icon-registry}}, so an inline mention survives as text, and not
      // global: one page holds one manifest, and a second copy would
      // duplicate its id.
      content = content.replace(/^[^\S\n]*\{\{icon-manifest\}\}[^\S\n]*$/m, renderIconManifest);
      content = content.replace(/^[^\S\n]*\{\{asset-manifest\}\}[^\S\n]*$/m, renderAssetManifest);
      content = content.replace(/^[^\S\n]*\{\{format-manifest\}\}[^\S\n]*$/m, renderFormatManifest);
      content = content.replace(/^[^\S\n]*\{\{showcase-manifest\}\}[^\S\n]*$/m, renderShowcaseManifest);
    }
    // A tool's chrome animates in without its author writing a word of it;
    // a page body's frames, figures and tables reveal as a doc's do. The
    // same narrow pass markdown bodies get, not the markdown pipeline.
    if (type.name === 'tool') {
      content = stampToolMotion(content);
      assertStamped(content, new RegExp('<div\\b' + ATTRS + '\\sclass="tool-canvas"' + ATTRS + '>', 'g'), 'tool canvases', `${dirName}/${slug}.html`);
    }
    if (type.name === 'page') content = stampBodyMotion(content);

    // A bare page has its own template, as a cms page of the type does: the
    // header and nothing else, outside the page transitions. The bare example
    // is the one source page here that takes it.
    if (type.name === 'bare') {
      if (!bareTemplate) throw new Error(`cms/${dirName}/${filename}: a bare page here needs the bare template passed in`);
      const html = generateBarePage({
        frontmatter,
        content,
        filename: `${dirName}/${filename}`,
        htmlPath: `${folder}/${slug}.html`,
        htmlFolder: folder,
      }, bareTemplate);
      const dir = path.join(OUTPUT_DIR, folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slug}.html`), html);
      console.log(`📄 Generated: ${folder}/${slug}.html`);
      generated.push(`${folder}/${slug}.html`);
      continue;
    }

    // Assert the close came out navigable. The check above proves the attribute
    // is there; this proves fillPageClose actually resolved it. Nothing in the
    // JS reads data-page-close — it is a build-time marker, not a behaviour —
    // so the close has to be a real <a> with a real href. A <button> carrying
    // the attribute is inert, and would otherwise pass a gate whose whole job
    // is to prevent exactly that.
    if (needsClose) {
      const resolved = (stripHtmlComments(content).match(/<a\s[^>]*\bdata-page-close(?![-\w])[^>]*>/g) || [])
        .filter(tag => /(^|\s)href\s*=\s*["'][^"']+["']/.test(tag)).length;
      if (resolved === 0) {
        closeErrors.push(`  ${dirName}/${slug}.html — data-page-close is not on a link with a destination (an <a>; a <button> does nothing)`);
        continue;
      }
    }

    const html = renderPage(template, {
      space: ROOT_SPACE,
      navBase,
      title: frontmatter.title || slug,
      description: frontmatter.description || '',
      header: type.header
        ? buildPageHeaderHtml({ title: frontmatter.title, subtitle: frontmatter.subtitle })
        : '',
      content: stampBodyLinks(content, `/${folder}/${slug}.html`, deriveDataAccess(frontmatter)),
      toc: type.toc ? generateTableOfContents(content) : '',
      frame: type.frame,
      article: type.article,
      stickyBar: type.stickyBar
        ? buildBar({
            crumbs: [{ label: upLabel, href: upHref }, { label: frontmatter.title || slug }],
            closeHref: upHref,
            closeLabel: upLabel,
            // A framed tool's bar lines up with the tool column; a full-bleed
            // one (bar-width: "full") spans, matching the canvas below it.
            width: frontmatter['bar-width'] === 'full' ? null : 'tool',
          })
        : '',
      access: deriveDataAccess(frontmatter),
      // Out of search: the page-type skeletons are specimens, and a tool page
      // is an application — its text is button labels, so indexing it puts
      // "Save Copy URL Reset" into the prose index and matches a search for
      // "copy" on four tools. Each tool's -docs page carries its prose and
      // links to it, which is the route the site already offers.
      searchable: dirName !== 'examples' && type.name !== 'tool' && frontmatter.search !== 'false',
      sectionSlug: slug,
      pageSection: slugifySection(section),
      order: parseInt(frontmatter.order, 10) || 999,
      level: type.level,
      chrome: type.chrome,
      sidebar: frontmatter.sidebar || null,
      // A stable root hook for the tool's own module, named after the page.
      // email-signature.js already scopes every one of its queries to
      // [data-tool="email-signature"] and returns early without it, so the
      // tool goes silently dead if this is missing.
      containerExtra: toolHook ? ` data-tool="${escapeAttr(slug)}" data-download-access="${downloadAccess}"` : '',
    });

    const dir = path.join(OUTPUT_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.html`), html);
    console.log(`📄 Generated: ${folder}/${slug}.html`);
    generated.push(`${folder}/${slug}.html`);
    // The examples are specimens of the page types, not pages anyone reads,
    // so they stay off the map and gated to the team whatever their
    // frontmatter says.
    if (dirName !== 'examples') {
      pageAccess.set(`/${folder}/${slug}.html`, {
        level: normaliseLevel(frontmatter.access),
        section: folder,
        type: type.name,
        title: frontmatter.title || slug,
      });
    }
  }

  if (closeErrors.length > 0) {
    console.error(`\n❌ cms/${dirName} — a \`tool\` page must give the reader a way out:`);
    console.error(closeErrors.join('\n'));
    console.error('\nPut data-page-close on an <a> anywhere the layout suits — the');
    console.error('bar\'s trailing cluster, a corner of the canvas. Leave the href');
    console.error('off and the section index is filled in. It must be a link, not a');
    console.error('button: nothing reads the attribute at runtime. See cms/building-a-page.md.\n');
    process.exit(1);
  }

  return generated;
}

//------- Showcase -------//
//
// Components on social frames, as posts (handovers/HANDOVER-showcase.md).
// The sources are cms/showcase/<slug>.json + <slug>.html, loaded and checked
// by ./showcase.js. Three outputs:
//
//   /showcase/index.html     the feed, PUBLIC: every published post, newest first
//   /showcase/<slug>.html    one post, PUBLIC, for a story's link sticker
//   {{showcase-manifest}}    every asset, drafts included, inlined into the
//                            edit view — a gated tool page, so drafts never
//                            reach a public URL
//
// The public pages are `page`-type pages in the docs chrome (site header,
// sidebar, footer), rendered through renderPage the way a section index is.
// They are public: a visitor from Instagram gets the post under the locked
// sidebar (nav.js canOpen, the 2026-10-01 decision), not a login wall. Each
// post is one social card (showcaseCard): author, the live stage, an action
// row, a caption. The card leaves mount points for the controls showcase.js
// adds (play, layers).
//
// No public JSON file carries the assets: each public page inlines only what
// it shows, which is how a draft stays off the open web.

let SHOWCASE = null;

function loadShowcaseOnce() {
  if (SHOWCASE) return SHOWCASE;
  const loaded = showcase.loadShowcase(
    path.join(DOCS_DIR, 'showcase'),
    path.resolve(ROOT, PROJECT_CONFIG.designSystemPath),
    ROOT,
  );
  if (loaded.errors.length > 0) {
    console.error('\n❌ cms/showcase — fix these before the build can ship a post:');
    console.error(loaded.errors.join('\n'));
    console.error('\nThe contract is assets/data/showcase-asset.schema.json; cms/showcase-docs.md walks through it.\n');
    process.exit(1);
  }
  // {{icon:name}} expands in an asset's markup as it does in a tool body:
  // brand icons only (CLAUDE.md §3), and no raw SVG pasted into the sources.
  SHOWCASE = loaded.assets.map((asset) => ({
    ...asset,
    html: asset.html.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name)),
  }));
  return SHOWCASE;
}

/** The frames and grounds as the runtime reads them (showcase-stage.js). */
function showcaseConfigBlock() {
  const json = JSON.stringify({ frames: showcase.FRAMES, backgrounds: showcase.BACKGROUNDS })
    .replace(/</g, '\\u003c');
  return `<script type="application/json" id="showcase-config">${json}</script>`;
}

// The drawn cursor's shapes, from the site's two-colour cursor set
// (assets/images/svg-cursors/, cms/iconography.md "Cursor Sprite"): fixed
// black-and-white artwork with its own white edge, as a real pointer has, so
// it reads on any ground. Not brand icons, so not .svg-icn; the runtime
// clones them by data-cursor. The set's files carry xmlns and a fixed size
// for the sprite; inline they take the wrapper's size instead.
const SHOWCASE_CURSORS = { arrow: 'cursor-arrow', pointer: 'cursor-hand-pointing-dark' };

/** The brand icons and cursor drawings the runtime clones. */
function showcaseIconsBlock() {
  const names = ['play-outline', 'pause', 'stack'];
  const cursors = Object.entries(SHOWCASE_CURSORS).map(([shape, name]) => {
    const file = path.join(ROOT, 'assets/images/svg-cursors', `${name}.svg`);
    if (!fs.existsSync(file)) {
      console.error(`❌ Showcase: the cursor drawing assets/images/svg-cursors/${name}.svg is missing`);
      process.exit(1);
    }
    const svg = fs.readFileSync(file, 'utf8').trim()
      .replace(/\s(?:xmlns|width|height)="[^"]*"/g, '')
      .replace(/^<svg\b/, '<svg width="100%" height="100%"');
    return `<div class="showcase-cursor-art" data-cursor="${shape}">${svg}</div>`;
  });
  return `<template id="showcase-icons">${names.map((name) => getIcon(name)).join('')}${cursors.join('')}</template>`;
}

/**
 * {{showcase-manifest}} in the edit view's body: every asset, drafts
 * included, plus the config and icons. The edit view is a team page.
 */
function renderShowcaseManifest() {
  const assets = loadShowcaseOnce();
  const json = `[${assets.map(showcase.serialiseAsset).join(',')}]`;
  return [
    showcaseConfigBlock(),
    showcaseIconsBlock(),
    `<script type="application/json" id="showcase-manifest">${json}</script>`,
  ].join('\n');
}

function showcaseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** One post's live stage, with its asset inlined for showcase.js. */
function showcaseHost(asset) {
  return `<div class="showcase-host" data-showcase-slug="${escapeAttr(asset.slug)}">
                    <script type="application/json" class="showcase-asset">${showcase.serialiseAsset(asset)}</script>
                    <noscript><p class="showcase-noscript">This post is a live component. Turn on JavaScript to see it.</p></noscript>
                  </div>`;
}

/**
 * One post as a social card. `kind` is where it sits: on the feed the head
 * carries the one way into the post's page (the full-screen button; the
 * title is a heading, not a second link to the same place); on the post
 * page the title is the h1. The action row leaves mount points for the controls
 * showcase.js adds (play when the asset has steps, layers when it has any a
 * reader may switch); the heart is a picture until likes ship (ROADMAP,
 * Showcase). The author comes from cms/showcase/authors.json; the brand's own
 * entry may leave its name to the deployment.
 */
function showcaseCard(asset, { kind, navBase }) {
  const { slug, data, author } = asset;
  const titleId = `post-${escapeAttr(slug)}`;
  const title = escapeAttr(data.title);
  const name = escapeAttr((author && author.name) || SITE.name);
  const initials = escapeAttr(author ? author.initials : '');
  const avatar = author && author.avatar ? `<img src="${navBase}${escapeAttr(author.avatar)}" alt="">` : '';
  const heading = kind === 'feed'
    ? `<h2 class="text-size-l showcase-post-title" id="${titleId}">${title}</h2>`
    : `<h1 class="text-size-l showcase-post-title" id="${titleId}">${title}</h1>`;
  const open = kind === 'feed'
    ? `
                    <a class="button showcase-post-open" data-variant="text" data-icon-only href="${escapeAttr(slug)}.html" aria-label="Open ${title}">${getIcon('full-screen')}</a>`
    : '';
  return `<article class="showcase-post" aria-labelledby="${titleId}">
                  <header class="showcase-post-head">
                    <div class="showcase-post-author">
                      <span class="avatar" aria-hidden="true">${initials}${avatar}</span>
                      <span class="showcase-post-author-name">${name}</span>
                    </div>${open}
                  </header>
                  ${showcaseHost(asset)}
                  <div class="showcase-post-actions">
                    <div class="showcase-post-primary">
                      <span class="showcase-post-heart" aria-hidden="true">${getIcon('heart')}</span>
                      <span class="showcase-post-play" data-showcase-play></span>
                    </div>
                    <span class="showcase-post-layers" data-showcase-layers></span>
                  </div>
                  <div class="showcase-post-caption">
                    ${heading}
                    <p class="text-secondary">${escapeAttr(data.description)}</p>
                    <time class="text-size-xs text-faded" datetime="${data.date}">${showcaseDate(data.date)}</time>
                  </div>
                </article>`;
}

/**
 * worker/showcase-assets.mjs: what the overrides API may accept, per asset.
 * Written on every full build, like page-access.mjs, so the Worker checks a
 * save against the assets that exist rather than a list that could go stale.
 */
function writeShowcaseCatalogue(assets) {
  const workerDir = path.join(ROOT, 'worker');
  if (!fs.existsSync(workerDir)) return;
  const catalogue = {
    backgrounds: showcase.BACKGROUNDS,
    fixedGrounds: showcase.FIXED_GROUNDS,
    themes: showcase.THEMES,
    assets: Object.fromEntries(assets.map((asset) => {
      const layers = [...new Set((asset.html.match(/\sdata-layer\s*=\s*["']([^"']*)["']/g) || [])
        .map((m) => m.replace(/^.*=\s*["']/, '').replace(/["']$/, '')))];
      if (asset.data.annotations.length > 0) layers.push(showcase.ANNOTATIONS_LAYER);
      for (const spec of Object.values(asset.specData || {})) {
        for (const toggle of showcase.specToggles(spec)) if (!layers.includes(toggle.id)) layers.push(toggle.id);
      }
      return [asset.slug, {
        background: asset.data.background,
        theme: asset.data.theme,
        props: Object.keys(asset.data.props),
        choices: asset.data.choices || {},
        layers,
      }];
    })),
  };
  const banner = `/**
 * showcase-assets.mjs - GENERATED by cms/generator/generate-docs.js, do not edit.
 *
 * What the Showcase overrides API (worker/showcase.js) accepts for each asset
 * in cms/showcase/: its props, their choices, its layers, and the allowed
 * grounds and themes. Rewritten on every full docgen.
 */
`;
  fs.writeFileSync(path.join(workerDir, 'showcase-assets.mjs'), `${banner}export const SHOWCASE_CATALOGUE = Object.freeze(${JSON.stringify(catalogue, null, 2)});\n`);
  console.log(`📄 Generated: worker/showcase-assets.mjs (${assets.length} assets)`);
}

/**
 * A public Showcase page through the docs template: the chrome every docs
 * page has, public access, one section slug for Barba. No <article> frame
 * around the content: the card is the article.
 */
function renderShowcasePage(template, { title, description, header, stickyBar, content, level, order }) {
  return renderPage(template, {
    space: ROOT_SPACE,
    navBase: '../',
    title: escapeAttr(title),
    description: escapeAttr(description),
    header,
    stickyBar,
    content,
    access: 'public',
    sectionSlug: 'showcase',
    pageSection: 'showcase',
    order,
    level,
    frame: PAGE_TYPES.page.frame,
    article: false,
    chrome: PAGE_TYPES.page.chrome,
  });
}

function generateShowcasePages(template) {
  const assets = loadShowcaseOnce();
  const published = assets.filter((asset) => asset.data.published);
  const dir = path.join(OUTPUT_DIR, 'showcase');
  fs.mkdirSync(dir, { recursive: true });

  // A post that was published and is now a draft must not linger at its old
  // URL, so every generated post page not in this build is removed.
  const keep = new Set(['index.html', ...published.map((asset) => `${asset.slug}.html`)]);
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.html') && !keep.has(file)) {
      fs.unlinkSync(path.join(dir, file));
      console.log(`🗑️  Removed: showcase/${file} (no longer published)`);
    }
  }

  writeShowcaseCatalogue(assets);

  const navBase = '../';
  // The config and icons sit inside the container, so a Barba swap brings
  // them with the page (showcase-stage.js reads them by id).
  const blocks = `${showcaseConfigBlock()}
            ${showcaseIconsBlock()}`;
  const intro = `Live components from the ${escapeAttr(SITE.name)} design system. Each post works: open it, tap it, try it.`;

  const feedItems = published.map((asset) => `
                <li>${showcaseCard(asset, { kind: 'feed', navBase })}</li>`).join('');
  const feedContent = `<div data-showcase-page="feed">
            <div class="container-xs">
              ${published.length > 0
                ? `<ol class="showcase-feed" role="list">${feedItems}
              </ol>`
                : '<p class="text-secondary">The first posts are on their way.</p>'}
            </div>
            ${blocks}
          </div>`;

  fs.writeFileSync(path.join(dir, 'index.html'), renderShowcasePage(template, {
    title: 'Showcase',
    description: 'Live components from the design system, every state on a social frame. Each post is the real component: open it, tap it, try it.',
    header: buildPageHeaderHtml({ eyebrow: escapeAttr(SITE.name), title: 'Components you can tap, not screenshots', subtitle: intro }),
    // The feed belongs to no section, so it closes to home.
    stickyBar: buildBar({ crumbs: [], closeHref: siteHref('/index.html'), closeLabel: 'Home' }),
    content: feedContent,
    level: 1,
    order: 0,
  }));
  console.log(`📄 Generated: showcase/index.html (${published.length} of ${assets.length} posts published)`);
  pageAccess.set('/showcase/index.html', { level: effectiveBuildLevel('/showcase/index.html', 'public'), section: '', type: 'page', title: 'Showcase' });

  for (const asset of published) {
    const { slug, data } = asset;
    const frameSwitch = data.frames.length > 1
      ? `
                <div class="segmented-control showcase-frame-switch" data-variant="faded" role="radiogroup" aria-label="Frame">
                  ${data.frames.map((frame, i) => `<label class="segmented-control-option"><input type="radio" name="showcase-frame" value="${frame}"${i === 0 ? ' checked' : ''}><span>${showcase.FRAMES[frame].label}</span></label>`).join('\n                  ')}
                </div>`
      : '';
    const content = `<div data-showcase-page="post">
            <div class="container-xs">
              <div class="block gap-l">
                <a class="button showcase-back" data-variant="text" href="index.html">${getIcon('arrow-left')}<span>All posts</span></a>${frameSwitch}
                ${showcaseCard(asset, { kind: 'post', navBase })}
              </div>
            </div>
            ${blocks}
          </div>`;
    fs.writeFileSync(path.join(dir, `${slug}.html`), renderShowcasePage(template, {
      title: data.title,
      description: data.description,
      // The card carries the h1; a page header would say the title twice.
      header: '',
      stickyBar: buildBar({
        crumbs: [{ label: 'Showcase', href: 'index.html' }, { label: escapeAttr(data.title) }],
        closeHref: 'index.html',
        closeLabel: 'Showcase',
      }),
      content,
      level: 2,
      order: 1,
    }));
    console.log(`📄 Generated: showcase/${slug}.html`);
    pageAccess.set(`/showcase/${slug}.html`, { level: effectiveBuildLevel(`/showcase/${slug}.html`, 'public'), section: '', type: 'page', title: data.title });
  }
}

/**
 * Copy a bundled docs-kit asset into the output. Bundled assets exist only in
 * the shipped package; running from source with the defaults unset warns and
 * skips rather than failing the whole build.
 */
function copyKitAsset(rel, dest) {
  const src = path.join(KIT_ASSETS, rel);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Bundled asset missing: ${src} — set docsCss/uiScripts in docs.config.js or reinstall the docs-kit package`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Apply project chrome to the raw template: docs CSS, extra stylesheets and
 * scripts, head/body extensions, and wrapper/container attributes — the whole
 * extension surface. Injected strings may themselves carry template
 * placeholders ({{NAV_BASE}}, {{PAGE_ACCESS}}, {{SECTION_SLUG}}, ...):
 * injection happens before the per-page pass, so they resolve exactly like
 * native template text. Function replacers keep `$` sequences in injected
 * HTML literal.
 */
function applyTemplateChrome(rawTemplate) {
  // Zero-config framework CSS: ship the packaged design-system.css into the output
  if (USE_PACKAGED_DS) {
    const dest = path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'design-system.css');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(PACKAGED_DS_CSS, dest);
  }

  // Brand CSS: copy the configured stylesheet into the output at the same
  // relative path the pages link, so a standalone-served site keeps its
  // brand. Pages reference it after the framework CSS, preserving the
  // cascade. Skipped silently when unset; external URLs and site-absolute
  // hrefs have no project-root source file to copy. Projects that generate
  // in place (outputDir '.') already serve the source file — the guard
  // stops the copy landing on itself.
  if (CONFIG.brandCssPath && !/^(https?:)?\/\//.test(CONFIG.brandCssPath) && !CONFIG.brandCssPath.startsWith('/')) {
    const src = path.resolve(ROOT, CONFIG.brandCssPath);
    const dest = path.join(OUTPUT_DIR, CONFIG.brandCssPath);
    if (!fs.existsSync(src)) {
      console.warn(`⚠️  brandCssPath not found: ${src} — pages will link it, but the file is missing from the output`);
    } else if (src !== dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Docs chrome CSS: project-provided path, or the kit-bundled stylesheet
  // copied into the output
  let docsCssHref;
  if (CONFIG.docsCss) {
    docsCssHref = prefixHref('{{NAV_BASE}}', CONFIG.docsCss);
  } else {
    docsCssHref = '{{NAV_BASE}}assets/docs-kit/docs.css';
    copyKitAsset('docs.css', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'docs.css'));
  }

  CHROME.docsCssHref = docsCssHref;

  // Docs UI scripts: project-provided list, or the kit-bundled set copied
  // into the output. The kit set is the docs chrome plus every core
  // component the generated pages can draw (D1, engine-parity-plan.md: a
  // zero-config site behaves like By Default's), so the mobile menu and
  // search dialog work without a hand-built list. A script whose file name
  // the site already lists in extraScripts is left out: most components
  // bind document-level listeners with no double-load guard, so loading
  // dialog.js twice would open and close a dialog on the same click. A copy
  // under another file name (dialog.min.js) is the site's to drop.
  let uiScripts = CONFIG.uiScripts;
  if (uiScripts === null) {
    // Every script the site names itself: extraScripts, plus raw <script src>
    // tags in the head and body-end HTML. Compared by lower-case file name,
    // either slash, query and fragment dropped.
    const scriptName = (src) => String(src).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
    const rawHtml = `${CONFIG.extraHeadHtml || ''}\n${CONFIG.extraBodyEndHtml || ''}`;
    const rawSrcs = [...rawHtml.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map(m => m[1]);
    const siteScripts = new Set([...CONFIG.extraScripts, ...rawSrcs].map(scriptName));
    uiScripts = [];
    for (const f of KIT_UI_SCRIPTS) {
      if (siteScripts.has(f)) continue;
      if (f === 'search.js' && !CONFIG.search) continue;
      uiScripts.push(`assets/docs-kit/${f}`);
      copyKitAsset(`js/${f}`, path.join(OUTPUT_DIR, 'assets', 'docs-kit', f));
    }
  }
  // The bare template loads a few of these by name (uiScriptPath)
  CHROME.uiScripts = uiScripts.slice();

  // All configured paths are site-root-relative; the {{NAV_BASE}} prefix
  // resolves them per page depth. Absolute URLs pass through untouched.
  const nav = (p) => prefixHref('{{NAV_BASE}}', p);
  // The installed apps' files (apps.js), on every page so a page transition
  // into an app finds it styled and started (PB-1): after the UI scripts,
  // before the site's own. The brand's two generated files lead, since the
  // libraries read them as they load.
  const engineScripts = INSTALL.legacy ? [] : [
    ...(BRAND ? [CONFIG.brandOutputs.themeConfig, CONFIG.brandOutputs.logoManifest] : []),
    ...INSTALL.scripts,
  ];
  const engineStyles = INSTALL.legacy ? [] : INSTALL.styles;
  assertNotListedTwice(engineScripts, [...(CONFIG.uiScripts || []), ...CONFIG.extraScripts], 'extraScripts or uiScripts');
  assertNotListedTwice(engineStyles, CONFIG.extraStylesheets, 'extraStylesheets');
  let styleLinks = [...engineStyles, ...CONFIG.extraStylesheets].map(href => `<link rel="stylesheet" href="${nav(href)}">`).join('\n    ');
  // The locale's runtime first, so every script that shows the engine's
  // words finds window.bdLocale as it loads
  const localeScripts = CONVERT_LOCALE ? [LOCALE_SCRIPT] : [];
  const uiScriptTags = [...localeScripts, ...uiScripts, ...engineScripts].map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  let extraScriptTags = CONFIG.extraScripts.map(src => `<script src="${nav(src)}" defer></script>`).join('\n    ');
  const highlightTag = `<script src="${nav(CONFIG.highlightJs)}"></script>`;

  // Page transitions, on every site (engine parity C3, D5): ship the kit's
  // router, its stylesheet and the vendored @barba/core, and stamp the
  // markup the resolver reads. A site's own wrapperAttrs/containerAttrs come
  // first; they may not carry data-barba (checked at load).
  let wrapperAttrs = CONFIG.wrapperAttrs;
  let containerAttrs = CONFIG.containerAttrs;
  {
    // Pages linking scripts that 404 fail silently in the browser, so a
    // missing bundled asset fails the build.
    const barbaAssets = ['barba-transitions.css', 'js/barba-docs.js', 'js/vendor/barba.min.js', 'js/vendor/barba-LICENSE.txt'];
    for (const rel of barbaAssets) {
      if (!fs.existsSync(path.join(KIT_ASSETS, rel))) {
        console.error(`❌ A page-transition asset is missing: ${path.join(KIT_ASSETS, rel)} — reinstall the docs-kit package.`);
        process.exit(1);
      }
    }
    copyKitAsset('barba-transitions.css', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'barba-transitions.css'));
    copyKitAsset('js/vendor/barba.min.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'vendor', 'barba.min.js'));
    copyKitAsset('js/vendor/barba-LICENSE.txt', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'vendor', 'barba-LICENSE.txt'));
    copyKitAsset('js/barba-docs.js', path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'barba-docs.js'));

    // Before extraStylesheets so a site stylesheet can override; after
    // extraScripts so modules that set window.bdBarbaOptions or listen for
    // bd:after-nav are in document order before the router boots.
    const barbaStyleLink = `<link rel="stylesheet" href="${nav('assets/docs-kit/barba-transitions.css')}">`;
    styleLinks = styleLinks ? `${barbaStyleLink}\n    ${styleLinks}` : barbaStyleLink;
    const barbaScriptTags =
      `<script src="${nav('assets/docs-kit/vendor/barba.min.js')}" defer></script>\n    ` +
      `<script src="${nav('assets/docs-kit/barba-docs.js')}" defer></script>`;
    extraScriptTags = extraScriptTags ? `${extraScriptTags}\n    ${barbaScriptTags}` : barbaScriptTags;

    wrapperAttrs += ' data-barba="wrapper"';
    // The site's transition choices, read by the router at init. Only the
    // scenarios it changes, validated against the library above.
    if (CONFIG.transitions && Object.keys(CONFIG.transitions).length) {
      wrapperAttrs += ` data-bd-transitions="${escapeAttr(JSON.stringify(CONFIG.transitions))}"`;
    }
    containerAttrs += ' data-barba="container" data-barba-namespace="{{SECTION_SLUG}}" data-section="{{PAGE_SECTION}}" data-order="{{PAGE_ORDER}}" data-level="{{PAGE_LEVEL}}"';
  }

  // Feedback form (opt-in): the script, and the dialog at the end of <body>,
  // outside the page container so a swap never strands it open. The footer
  // block is per page (buildPageChrome); the bar items are feedbackMenuItems.
  let extraBodyEndHtml = CONFIG.extraBodyEndHtml.trimEnd();
  if (CONFIG.feedback) {
    let feedbackSrc = CONFIG.feedbackScript;
    if (!feedbackSrc) {
      feedbackSrc = 'assets/docs-kit/feedback.js';
      const kitJs = fs.existsSync(path.join(KIT_ASSETS, 'js', 'feedback.js'))
        ? path.join(KIT_ASSETS, 'js', 'feedback.js')
        : path.join(__dirname, '..', '..', 'assets', 'js', 'feedback.js');
      if (!fs.existsSync(kitJs)) {
        console.error(`❌ feedback is on but feedback.js is missing: ${kitJs} — reinstall the docs-kit package.`);
        process.exit(1);
      }
      const dest = path.join(OUTPUT_DIR, 'assets', 'docs-kit', 'feedback.js');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(kitJs, dest);
      // The Ask for access form's script is the access gate's now (phase
      // D): the engine's support page loads it from assets/js/, like the
      // gate's other files (apps.js GATE_FILES)
    }
    const feedbackTag = `<script src="${nav(feedbackSrc)}" defer></script>`;
    extraScriptTags = extraScriptTags ? `${extraScriptTags}\n    ${feedbackTag}` : feedbackTag;
    const dialog = feedbackDialogHtml(readFeedbackPartial('dialog.html', 'feedback-dialog.html')).trimEnd();
    extraBodyEndHtml = extraBodyEndHtml ? `${extraBodyEndHtml}\n${dialog}` : dialog;
  }

  // Glossary reading drawer: whenever the site has a cms/glossary/ (the same
  // test loadGlossary makes), ship glossary.js and the kit's starter, and
  // load them after every other script so dialog.js, scroller.js and
  // az-index.js, when a site loads them, are defined first. Each is optional
  // to glossary.js, which falls back to a plain modal. A missing file fails
  // the build: cards that never open the drawer fail silently in the browser.
  if (CONFIG.glossaryDrawer && fs.existsSync(path.join(DOCS_DIR, 'glossary'))) {
    const glossaryFiles = [
      ['glossary.js', path.join(__dirname, '..', '..', 'assets', 'js', 'glossary.js')],
      ['glossary-init.js', null],
    ];
    const glossaryTags = [];
    for (const [name, sourceFallback] of glossaryFiles) {
      const kitJs = path.join(KIT_ASSETS, 'js', name);
      const src = fs.existsSync(kitJs) ? kitJs : sourceFallback;
      if (!src || !fs.existsSync(src)) {
        console.error(`❌ cms/glossary/ exists but ${name} is missing: ${[kitJs, sourceFallback].filter(Boolean).join(' or ')} — reinstall the docs-kit package, or set glossaryDrawer: false if the site loads glossary.js itself.`);
        process.exit(1);
      }
      const dest = path.join(OUTPUT_DIR, 'assets', 'docs-kit', name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      glossaryTags.push(`<script src="${nav(`assets/docs-kit/${name}`)}" defer></script>`);
    }
    extraScriptTags = [extraScriptTags, ...glossaryTags].filter(Boolean).join('\n    ');
  }

  return rawTemplate
    .replaceAll('{{CONFIG_PATH}}', `${path.basename(DOCS_DIR)}/docs.config.js`)
    .replace('{{DOCS_CSS}}', () => `<link rel="stylesheet" href="${docsCssHref}">`)
    .replace('{{EXTRA_STYLESHEETS}}', () => styleLinks)
    .replace('{{EXTRA_HEAD}}', () => CONFIG.extraHeadHtml.trimEnd())
    .replace('{{BODY_ATTRS}}', () => CONFIG.bodyAttrs)
    .replace('{{EXTRA_BODY_START}}', () => CONFIG.extraBodyStartHtml.trimEnd())
    .replace('{{WRAPPER_ATTRS}}', () => wrapperAttrs)
    // {{CONTAINER_EXTRA}} rides along after the configured container attrs so
    // a page can add its own without every consumer config having to declare
    // the slot. renderPage fills it; it is empty on all but tool pages.
    .replace('{{CONTAINER_ATTRS}}', () => containerAttrs + '{{CONTAINER_EXTRA}}')
    // {{EXTRA_CONTENT}} is not filled here — it is part of {{PAGE_CHROME}},
    // which renderPage fills per page so a page type can omit it.
    .replace('{{HIGHLIGHT_JS}}', () => highlightTag)
    .replace('{{UI_SCRIPTS}}', () => uiScriptTags)
    .replace('{{EXTRA_SCRIPTS}}', () => extraScriptTags)
    .replace('{{EXTRA_BODY_END}}', () => extraBodyEndHtml);
}

/**
 * Parse CLI arguments for single-file generation.
 * Accepts filenames with or without .md extension, e.g.:
 *   node generate-docs.js color
 *   node generate-docs.js color.md typography spacing
 *
 * Returns null for full build, or a Set of normalised .md filenames.
 */
function parseCliFilter() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;

  const filter = new Set();
  for (const arg of args) {
    const name = arg.endsWith('.md') ? arg : arg + '.md';
    // Verify file exists
    const filePath = docSource(name);
    if (GUIDES.skip.has(name)) {
      console.error(`❌ ${name} is the guide of an app this site doesn't install (docs.config.js install), so it has no page.`);
      process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${path.basename(DOCS_DIR)}/${name}`);
      process.exit(1);
    }
    filter.add(name);
  }
  return filter;
}

/**
 * Main generation function
 */
async function generateDocs() {
  // Pages modified from here on are this build's (checkClientWording). Two
  // seconds early, for filesystems that keep mtimes to the second.
  const buildStartedAt = Date.now() - 2000;
  validateSectionAccess();
  const filter = parseCliFilter();
  const isSingleFile = filter !== null;

  if (isSingleFile) {
    console.log(`🎯 Generating: ${[...filter].join(', ')}`);
  } else {
    console.log('🚀 Starting full documentation generation...');
  }

  // Build icon map from SVG files
  buildIconMap();
  warnBrandRegistryGaps();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load template, apply project chrome (the config extension surface), then
  // resolve the site name — every page (root and brand) carries the suffix
  let template = applyTemplateChrome(fs.readFileSync(TEMPLATE_FILE, 'utf8'))
    .replaceAll('{{SITE_NAME}}', () => SITE_HTML.name)
    .replace('{{NOSCRIPT_SIGN_OUT}}', () => noscriptSignOut())
    .replace('{{HTML_LANG}}', () => HTML_LANG);

  // Pre-process template icon placeholders, the feedback dialog's close among
  // them ({{close-icon}})
  template = expandCloseIcon(template.replace(/\{\{icon:([a-z0-9-]+)\}\}/g, (match, name) => getIcon(name)));

  // The bare template, after the docs one: it shares the docs CSS link and
  // the UI scripts' paths that applyTemplateChrome resolved
  const bareTemplate = fs.readFileSync(BARE_TEMPLATE_FILE, 'utf8')
    .replace('{{DOCS_CSS}}', () => `<link rel="stylesheet" href="${CHROME.docsCssHref}">`)
    .replaceAll('{{SITE_NAME}}', () => SITE_HTML.name)
    .replace('{{HTML_LANG}}', () => HTML_LANG);

  console.log('✅ Template loaded');

  // Loaded on every run, single-file included: glossary.md's body is built
  // from it. A broken entry fails the build here, before anything is written.
  GLOSSARY = loadGlossary(DOCS_DIR, parseFrontmatter);
  if (GLOSSARY) console.log(`✅ Glossary loaded: ${GLOSSARY.published.length} of ${GLOSSARY.entries.length} entries published`);

  // Find all markdown files (exclude generator folder and README files)
  // We always parse ALL files to build navigation, even for single-file mode
  const markdownFiles = docFilenames()
    .filter(file => {
      // Skip README and _defaults files
      if (file.startsWith('README') || file.startsWith('_')) {
        return false;
      }
      return true;
    });

  console.log(`📁 Found ${markdownFiles.length} markdown files`);

  // Parse files and organize by section
  const filesBySection = {};
  const allFiles = [];

  // Load folder defaults for the cms/ directory
  const cmsDefaults = loadDefaults(DOCS_DIR);

  // Layer validation (config: validateLayers — see CLAUDE.md §17, Layer
  // Discipline). When enabled, every published *.md file must declare which
  // layer it belongs to. Drives docs-site index filtering and llms.txt scope.
  const VALID_LAYERS = new Set(['foundation', 'core', 'docs-site', 'app']);
  // 'expanded' is the default and a no-op; it is accepted so a page can say so
  // out loud rather than relying on the absence of a field.
  const VALID_SIDEBAR = new Set(['collapsed', 'expanded']);
  const layerErrors = [];
  const typeErrors = [];
  // Every portable Foundations or Components page owes the styleguide an entry (see the gate below).
  const styleguideExpected = [];
  const brandLeaks = [];
  // Every page the build actually produces, by output slug. The gate's stale
  // check reads this rather than the required set, so that showing something
  // extra stays legal and only a slug matching no page at all is an error.
  const styleguideKnown = new Set();

  for (const filename of markdownFiles) {
    const filePath = docSource(filename);
    const content = readPageSource(filePath);
    const parsed = parseFrontmatter(content);
    // Merge folder defaults — page frontmatter wins
    const frontmatter = { ...cmsDefaults, ...parsed.frontmatter };
    // A guide's title, subtitle and description can name the site too
    for (const key of ['title', 'subtitle', 'description']) {
      if (typeof frontmatter[key] === 'string' && frontmatter.status !== 'draft') frontmatter[key] = expandBrandTokens(frontmatter[key], `cms/${filename} (${key})`);
    }
    const markdownContent = parsed.content;

    // A draft of the site's own door page would replace the engine's with
    // nothing: the build has no sign-in page, and nobody can get in
    if (frontmatter.status === 'draft' && CONFIG.accessGate && ENGINE_PAGE_FILES.has(filename) && appsRegistry.ENGINE_PAGES[filename].gate) {
      console.error(`\n❌ cms/${filename} is a draft. It replaces the engine's ${filename}, so the site would ship with no page at ${'/' + [appsRegistry.ENGINE_PAGES[filename].folder, appsRegistry.ENGINE_PAGES[filename].name].filter(Boolean).join('/')}. Publish it (status: "published"), or delete it to use the engine's.\n`);
      process.exit(1);
    }

    // Skip draft pages
    if (frontmatter.status === 'draft') {
      console.log(`⏭️  Skipped (draft): ${filename}`);
      continue;
    }

    // A section whose package this site doesn't install (D14): its pages and
    // index answer with the not-installed page instead
    const sectionFolder = SECTION_FOLDERS[frontmatter.section];
    if (sectionFolder && appsRegistry.sectionOff(INSTALL, sectionFolder)) {
      const off = deriveOutputPath(filename, frontmatter.section);
      OFF_SECTION_PAGES.set(`/${off.folder}/${off.htmlName}`, frontmatter.section);
      OFF_SECTION_PAGES.set(`/${off.folder}/index.html`, frontmatter.section);
      continue;
    }

    // Validate layer (config: validateLayers)
    if (CONFIG.validateLayers) {
      if (!frontmatter.layer) {
        layerErrors.push(`  ${filename} — missing 'layer:' field`);
      } else if (!VALID_LAYERS.has(frontmatter.layer)) {
        layerErrors.push(`  ${filename} — invalid layer "${frontmatter.layer}" (must be one of: foundation, core, docs-site, app)`);
      }
    }

    // A section the site has renamed (config: retiredSections). Without this,
    // a page from a branch cut before the rename lands wherever an unmapped
    // section goes, silently.
    if (Object.prototype.hasOwnProperty.call(CONFIG.retiredSections, frontmatter.section)) {
      typeErrors.push(`  ${filename} - section "${frontmatter.section}" is now "${CONFIG.retiredSections[frontmatter.section]}" (retiredSections in docs.config.js): rename it in the frontmatter, with the new section's subsection`);
    }

    // Validate the level. Absent is team; present and unknown fails the
    // build, the way a bad layer does - the gate reads this field.
    if (!isValidAccess(parsed.frontmatter.access)) {
      typeErrors.push(`  ${filename} - invalid access "${parsed.frontmatter.access}" (must be one of: ${ACCESS_LEVELS.join(', ')}, or absent, which is the section default or team)`);
    }

    // Validate page type. Unlike layer, `type:` is optional — an absent type
    // means `doc`, which is what nearly every page is. Only a value that is
    // present and unrecognised fails, because that is a typo silently getting
    // doc chrome rather than the chrome the author asked for.
    // The styleguide shows the system in one scroll, so every portable
    // Foundations or Components page has to appear on it. Collected here, checked after the
    // loop — `styleguide-exempt` opts out a page with nothing to specimen.
    // Keyed on the output folder, not the section label: renaming the section
    // in config would silently empty this set and disable the gate forever,
    // which is the exact failure §17 Rule 5 records for the index filter.
    const out = deriveOutputPath(filename, frontmatter.section);
    const outPath = out.folder ? `${out.folder}/${out.htmlName}` : out.htmlName;
    styleguideKnown.add(styleguideSlug(outPath));

    // Foundations and Components (Web until 2026-11-12) hold the engine's pages since the 2026-10-08
    // restructure; brand pages that moved into Foundations are this brand's
    // content, not a specimen, so they stay out.
    if (STYLEGUIDE_FOLDERS.has(out.folder)
        && !isBrandContent(filename)
        && (frontmatter.layer === 'foundation' || frontmatter.layer === 'core')
        && String(frontmatter['styleguide-exempt']) !== 'true') {
      styleguideExpected.push({
        filename,
        title: frontmatter.title || filename,
        htmlPath: outPath,
      });
    }

    // Brand content is kept out of llms-full.txt, the "Use in another product"
    // appendix and the styleguide by its filename alone (portable.js). Since
    // the 2026-10-08 restructure brand pages sit inside Foundations › Identity,
    // so a rename there would leak this brand's content into what ships with
    // the package without a word. Fail the build instead.
    const brandHome = BRAND_CONTENT_FOLDERS.has(out.folder)
      || (out.folder === 'foundations' && frontmatter.subsection === 'Identity');
    if (brandHome && frontmatter.layer === 'core' && !isBrandContent(filename)) {
      brandLeaks.push(`  ${filename} (${out.folder}/${out.htmlName})`);
    }

    if (frontmatter.type && !Object.prototype.hasOwnProperty.call(PAGE_TYPES, frontmatter.type)) {
      typeErrors.push(`  ${filename} — invalid type "${frontmatter.type}"`);
    }

    // nav.js matches the literal 'collapsed' and nothing else, so any other
    // value emits an attribute that does nothing. Validated because that is
    // precisely the failure this field already had once: `sidebar:` was read
    // by no renderer at all on this path, and the page still built.
    if (frontmatter.sidebar && !VALID_SIDEBAR.has(frontmatter.sidebar)) {
      typeErrors.push(`  ${filename} — invalid sidebar "${frontmatter.sidebar}" (must be one of: collapsed, expanded)`);
    }

    // `tool` is not producible from a cms/*.md file: a tool is a source pair
    // in cms/apps/ (its body is raw HTML that must skip the markdown
    // pipeline, and it has a close to enforce), and would otherwise render
    // as a half-formed doc with no error. A `bare` page is, since phase D
    // (PD-1): its own template (template-bare.html) emits the page outside
    // the docs layout, with no sidebar and no page transitions.
    if (frontmatter.type === 'tool') {
      typeErrors.push(`  ${filename} — type "tool" belongs in cms/apps/ as a <slug>.md + <slug>.html pair`);
    }

    const title = frontmatter.title || filename.replace('.md', '');
    const section = frontmatter.section || 'uncategorized';

    // Derive output folder and filename
    const { folder, htmlName } = deriveOutputPath(filename, section);
    const htmlPath = folder ? folder + '/' + htmlName : htmlName;
    const markdownPath = filename;
    // The section default fills a page that declares no level (D18), and is
    // written onto the frontmatter so every emitter (map, sidebar, cards,
    // pager, body) reads the same level the gate will.
    const ownAccess = ownOrSectionAccess(parsed.frontmatter.access, folder, htmlPath);
    if (ownAccess !== undefined) frontmatter.access = ownAccess;

    const file = {
      filename,
      title,
      section,
      htmlPath,
      htmlFolder: folder,
      htmlName,
      markdownPath,
      frontmatter,
      // The page's own access value, before _defaults.md is merged in. Only a
      // page's own field may open it (access-plan.md §12.4): a default of
      // "public" would otherwise open every page that says nothing.
      ownAccess,
      // Site-absolute hrefs, for a root page served at other URLs - see
      // generatePage's navBase. Only a filenameOverrides entry can ask.
      base: FILENAME_OVERRIDES[filename] && FILENAME_OVERRIDES[filename].base ? FILENAME_OVERRIDES[filename].base : null,
      content: markdownContent,
      // The ids an engine page's converted headings keep (readPageSource)
      headingIds: pageHeadingIds(filePath)
    };

    // Root pages (an explicit filenameOverrides entry with folder: '') are
    // standalone: the page is generated, but it joins no section — no nav
    // group, no section index card, no prev/next chain. Nav presence comes
    // from rootLinks, which renders a single link instead of a one-item
    // collapsible section. Keyed on the override, not the derived folder: a
    // missing sectionFolders entry also yields folder '', and those pages
    // must stay visible in the nav so the misconfiguration gets noticed.
    // An engine page is standalone wherever it sits (the sign-in page is
    // under auth/), and so is any bare page: a door joins no section.
    const isRootPage = FILENAME_OVERRIDES[filename]
      && (FILENAME_OVERRIDES[filename].folder === '' || FILENAME_OVERRIDES[filename].standalone === true);
    file.standalone = !!isRootPage;
    if (!isRootPage && frontmatter.type === 'bare') {
      typeErrors.push(`  ${filename} — a bare page joins no section: give it a filenameOverrides entry with folder '' (or its own folder and standalone: true)`);
    }
    if (!isRootPage) {
      if (!filesBySection[section]) {
        filesBySection[section] = [];
      }
      filesBySection[section].push(file);
    }
    allFiles.push(file);
    if (resolvePageType(frontmatter) && resolvePageType(frontmatter).name === 'bare') BARE_PAGE_PATHS.add(siteHref('/' + htmlPath));
  }
  // The bare example under cms/examples/ too, read here rather than where
  // generateSourceDirPages writes it: a single-file run skips that, and
  // nav.js (which hands the list to the router) is written on every run
  const examplesDir = path.join(DOCS_DIR, 'examples');
  if (fs.existsSync(examplesDir)) {
    for (const f of sourceDirPageFiles(examplesDir)) {
      const fm = parseFrontmatter(fs.readFileSync(path.join(examplesDir, f), 'utf8')).frontmatter;
      if (fm.status !== 'draft' && fm.type === 'bare') BARE_PAGE_PATHS.add(siteHref(`/examples/${f.replace(/\.md$/, '')}.html`));
    }
  }

  // Every page's level by URL, before anything is rendered, for the links and
  // covers stampBodyLinks() and the index builders mark (levelOf). The cms
  // pages from the list just read; the indexes, at their section's level (indexLevel), which the gate opens to every
  // signed-in reader; the tool pairs under cms/apps/, which are written after
  // the pages that link to them, read the way generateSourceDirPages reads
  // them, own level else the section default.
  for (const file of allFiles) linkLevels.set('/' + file.htmlPath, normaliseLevel(file.ownAccess));
  linkLevels.set('/index.html', 'team');
  for (const section of Object.keys(filesBySection)) {
    if (SECTION_FOLDERS[section]) linkLevels.set(`/${SECTION_FOLDERS[section]}/index.html`, indexLevel(SECTION_FOLDERS[section]));
  }
  // Only apps that get a page: installed, and not drafts
  for (const slug of INSTALL.installed) {
    const app = APP_REGISTRY.apps.get(slug).frontmatter;
    if (app.status === 'draft') continue;
    const appSection = app.section || 'Tools';
    const appFolder = SECTION_FOLDERS[appSection] || appSection.toLowerCase();
    const own = app.access !== undefined && app.access !== null && app.access !== '' ? app.access : sectionLevel(appFolder);
    linkLevels.set(`/${appFolder}/${slug}.html`, effectiveBuildLevel(`/${appFolder}/${slug}.html`, own));
  }

  console.log(`📂 Found sections: ${Object.keys(filesBySection).join(', ')}`);
  // Under accessNav 'hidden' every page carries the sidebar list itself, for
  // the Worker to cut per reader; nav.js then holds none of it.
  if (CONFIG.accessNav === 'hidden') navSourceHtml = buildNavSectionsHtml(filesBySection);

  // Fail the build if any file is missing a valid layer (see CLAUDE.md §17)
  if (layerErrors.length > 0) {
    console.error('\n❌ Layer Discipline violation — every cms/*.md file must declare a valid layer:');
    console.error(layerErrors.join('\n'));
    console.error('\nValid layers: foundation, core, docs-site, app');
    console.error('See CLAUDE.md §17 (Layer Discipline) for details.\n');
    process.exit(1);
  }

  // Fail the build on an unrecognised page type (see cms/building-a-page.md)
  if (typeErrors.length > 0) {
    console.error('\n❌ Unknown page type:');
    console.error(typeErrors.join('\n'));
    console.error(`\nValid types: ${Object.keys(PAGE_TYPES).join(', ')}`);
    console.error('Omit `type:` entirely for an ordinary documentation page.\n');
    process.exit(1);
  }

  // Fail the build when the styleguide has fallen behind the system it shows.
  //
  // A hand-authored digest drifts the first time a component is added, and a
  // styleguide missing a component is worse than none — it reads as complete.
  // Keyed on the `data-component` each section carries, which is also its CSS
  // and JS hook, so there is no separate convention to keep in step. Skipped
  // entirely where the page does not exist, which is every consumer of the
  // docs kit.
  if (fs.existsSync(path.join(DOCS_DIR, STYLEGUIDE_SOURCE)) && styleguideExpected.length === 0) {
    console.error('\n❌ The styleguide gate matched no pages at all.');
    console.error('   Nothing maps to the "foundations" or "components" output folder, so the gate is inert.');
    console.error('   Check sectionFolders in docs.config.js.\n');
    process.exit(1);
  }

  // The gate keys on output basenames, so two expected pages sharing one would
  // let a single section satisfy both. Nothing in deriveOutputPath prevents it
  // (see styleguideSlug), so it is asserted rather than trusted.
  const slugOwners = new Map();
  for (const page of styleguideExpected) {
    const slug = styleguideSlug(page.htmlPath);
    if (slugOwners.has(slug)) {
      console.error(`\n❌ Two styleguide pages share the slug "${slug}":`);
      console.error(`  cms/${slugOwners.get(slug)} and cms/${page.filename}`);
      console.error('\nThe coverage gate cannot tell them apart. Rename one, or give it a');
      console.error('distinct filenameOverrides entry in cms/docs.config.js.\n');
      process.exit(1);
    }
    slugOwners.set(slug, page.filename);
  }

  if (brandLeaks.length > 0) {
    console.error(`\n❌ ${brandLeaks.length} core page(s) in a brand section lost the brand- / formats- filename prefix:`);
    console.error(brandLeaks.join('\n'));
    console.error('\ncms/generator/portable.js keys on that prefix to keep brand content out of llms-full.txt,');
    console.error('the "Use in another product" appendix and the styleguide. Restore the prefix, or');
    console.error('separate the engine half from the brand half before renaming (decision 40).\n');
    process.exit(1);
  }

  const { missing, stale, empty } = validateStyleguideCoverage(styleguideExpected, styleguideKnown);
  if (empty) {
    console.error(`\n❌ cms/${STYLEGUIDE_SOURCE} declares no components at all.`);
    console.error('   Every section needs data-component="<slug>". With none, the gate');
    console.error('   has nothing to reconcile and would pass an empty page.\n');
    process.exit(1);
  }
  if (missing.length > 0 || stale.length > 0) {
    if (missing.length > 0) {
      console.error(`\n❌ The styleguide is missing ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'}:`);
      console.error(missing.join('\n'));
      console.error(`\nAdd a section to cms/${STYLEGUIDE_SOURCE} carrying data-component="<slug>",`);
      console.error('or set `styleguide-exempt: "true"` in its frontmatter when it is prose');
      console.error('with nothing to specimen.');
    }
    if (stale.length > 0) {
      console.error(`\n❌ The styleguide declares ${stale.length} component(s) that no longer exist:`);
      console.error(stale.join('\n'));
      console.error(`\nRemove the section from cms/${STYLEGUIDE_SOURCE}.`);
    }
    console.error('');
    process.exit(1);
  }

  // Build ordered page list for prev/next navigation
  const pageOrder = buildPageOrder(filesBySection);

  // Build sidebar position map: htmlPath → integer position within its section.
  // Used by Phase 3 directional transitions to compare clicked link order
  // against current page order. Position 0 = section overview ("Overview" link).
  // Re-uses the exact rendering order produced by buildNavSectionsHtml.
  const sidebarOrderMap = buildSidebarOrderMap(filesBySection);

  // Which subsections get a heading on their section index — what a doc
  // page's subsection crumb can link to.
  const subsectionHeadings = buildSubsectionHeadings(filesBySection);

  // Determine which files to write
  const filesToWrite = isSingleFile
    ? allFiles.filter(f => filter.has(f.filename))
    : allFiles;

  // Generate index and section pages only during full build
  if (!isSingleFile) {
    const indexContent = generateIndexPage(template, filesBySection);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexContent);
    console.log('📄 Generated: index.html');
  }

  // Generate HTML for target files
  for (const file of filesToWrite) {
    // A bare page has its own template: the page outside the docs layout (PD-1)
    const pageContent = resolvePageType(file.frontmatter).name === 'bare'
      ? generateBarePage(file, bareTemplate)
      : generatePage(file, template, pageOrder, sidebarOrderMap, subsectionHeadings);

    // Ensure output directory exists
    if (file.htmlFolder) {
      const dir = path.join(OUTPUT_DIR, file.htmlFolder);
      fs.mkdirSync(dir, { recursive: true });
    }

    const outputPath = path.join(OUTPUT_DIR, file.htmlPath);
    fs.writeFileSync(outputPath, pageContent);
    console.log(`📄 Generated: ${file.htmlPath}`);
    if (CONFIG.markdownSourceBase && !GUIDES.sources.has(file.markdownPath)) sourcePages.set(`/${CONFIG.markdownSourceBase}/${file.markdownPath}`, '/' + file.htmlPath);
    pageAccess.set('/' + file.htmlPath, {
      level: normaliseLevel(file.ownAccess),
      // A standalone page (an engine page under its own folder, auth/) is in
      // no section a group could be granted
      section: file.standalone ? '' : file.htmlFolder,
      type: resolvePageType(file.frontmatter).name,
      title: file.title,
    });
  }

  // Section index pages — only during full build
  if (!isSingleFile) {
    for (const section of Object.keys(filesBySection)) {
      const sectionFolder = SECTION_FOLDERS[section];
      if (!sectionFolder) continue;
      const sectionIndexHtml = generateSectionIndexPage(section, template, filesBySection[section], filesBySection);
      if (sectionIndexHtml) {
        // Every subsection heading is a breadcrumb landing, so its id has to
        // be the only one on the page — a second element with it would take
        // the crumb somewhere else without an error. The emitted HTML covers
        // the generator's own ids; RUNTIME_IDS covers the ones scripts add
        // after load (nav.js, search.js).
        for (const sub of subsectionHeadings[section] || []) {
          const id = subsectionAnchorId(sub);
          const count = (sectionIndexHtml.match(new RegExp(`\\sid="${id}"`, 'g')) || []).length;
          const runtime = RUNTIME_IDS.has(id);
          if (count !== 1 || runtime) {
            console.error(`\n❌ ${sectionFolder}/index.html — subsection "${sub}" anchors at #${id}, which ${runtime ? 'a script also assigns at runtime' : `appears ${count} times`}. Rename the subsection.\n`);
            process.exit(1);
          }
        }
        const dir = path.join(OUTPUT_DIR, sectionFolder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), sectionIndexHtml);
        console.log(`📄 Generated: ${sectionFolder}/index.html`);
      }
    }
  }

  // Standalone source directories — only during full build. Both join no
  // section, so nothing above depends on them and nothing below reads them.
  if (!isSingleFile) {
    // Showcase first: the edit view (cms/apps/showcase.html) inlines every
    // asset through {{showcase-manifest}}, so they must be loaded and checked
    // before the tools are written.
    if (CONFIG.showcase) generateShowcasePages(template);
    generateSourceDirPages(template, { dirName: 'apps', toolHook: true });
    // The examples have no index of their own — the page-layouts reference is
    // their contents page, so that is where they close to.
    generateSourceDirPages(template, {
      dirName: 'examples',
      outputFolder: 'examples',
      defaultSection: 'Docs',
      closeHref: '/docs/page-layouts.html',
      closeLabel: 'Page Layouts',
      bareTemplate,
    });
  }

  // Glossary entry pages and the feed. Full builds only, like the source
  // directories above: they join no section and nothing else reads them.
  // Entry pages take the Glossary page's own level, so opening the glossary
  // is one field in cms/glossary.md rather than one per entry.
  if (!isSingleFile && GLOSSARY) {
    const index = allFiles.find(f => f.htmlPath === 'glossary.html');
    generateGlossaryPages(template, GLOSSARY, normaliseLevel(index ? index.ownAccess : undefined));
  }

  // The site-map data behind experiments/site-map.html — every page with its
  // template, place, level and status, from the objects built above. Full
  // builds only, like the section indexes: a single-file run has not walked
  // cms/apps/ and would write a map with no tools on it.
  if (!isSingleFile && CONFIG.siteMap) writeSiteMapData(allFiles, cmsDefaults);

  // Always regenerate nav.js (sidebar needs to stay current)
  const navJs = generateNavJs(filesBySection);
  const navJsPath = path.join(OUTPUT_DIR, 'assets', 'js', 'nav.js');
  fs.mkdirSync(path.dirname(navJsPath), { recursive: true });
  fs.writeFileSync(navJsPath, navJs);
  console.log('📄 Generated: assets/js/nav.js');

  // The locale's runtime, which every page loads first when it isn't en-GB
  writeLocaleScript();

  // The brand's two runtime files, from brand.json: full builds only
  if (!isSingleFile) {
    writeThemeConfig();
    writeLogoManifest();
    copyAppFiles();
    writeOsJson();
  }

  // A package guide's links to pages this site doesn't have, and the pages of
  // apps it doesn't install (B3)
  if (!isSingleFile) {
    const offSections = [...new Set(OFF_SECTION_PAGES.values())];
    for (const section of offSections) {
      const count = [...OFF_SECTION_PAGES].filter(([address, s]) => s === section && !address.endsWith('/index.html')).length;
      console.log(`⏭️  ${section} is off (its package isn't in install.packages): ${count} page(s) not built`);
    }
    removeUninstalledOutputs();
    unlinkMissingPages(allFiles);
  }

  // No By Default wording on a client site (failure scenario 11)
  if (!isSingleFile) checkClientWording(buildStartedAt);

  // After every emitter has run. Never on a single-file build: a partial map
  // written here would gate every page the filter left out as a team page
  // that does not exist.
  // Body links that point above their page's level (stampBodyLinks). Under
  // 'hidden' the build fails: the Worker would cut the link, but a page that
  // names a higher page in its prose is a page written for the wrong reader.
  // Under 'locked' every reader sees every title already, so it is a note.
  if (!isSingleFile && bodyLinkViolations.length) {
    if (CONFIG.accessNav === 'hidden') {
      console.error(`\n❌ ${bodyLinkViolations.length} body link(s) point at a page above the linking page's level. Under accessNav 'hidden' the reader would see a sentence about a page they cannot open. Reword or move the link:\n${bodyLinkViolations.join('\n')}\n`);
      process.exit(1);
    }
    console.log(`🔗 ${bodyLinkViolations.length} body link(s) point above their page's level (stamped; a note under accessNav 'locked', a build error under 'hidden')`);
  }

  if (!isSingleFile && CONFIG.accessGate) writePageAccess();
  if (!isSingleFile && CONFIG.assetLibrary) writeLibraryIndex();
  if (!isSingleFile) writeFormatsEmbed();

  // The door pages (phase D), once the page map they are judged by is written
  if (!isSingleFile && CONFIG.accessGate) await checkDoorPages(allFiles);

  if (isSingleFile) {
    console.log(`✅ Done — regenerated ${filesToWrite.length} page(s) + nav.js`);
  } else {
    console.log('✅ Documentation generation complete!');
    console.log(`📊 Generated ${allFiles.length + 1} HTML pages + nav.js`);
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
  }
}

// Run the generator — fail the build on error so a broken run can't deploy stale HTML
if (require.main === module) {
  generateDocs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// watch-docs.js shares the project discovery; scripts/verify-feedback-dialog.js
// checks the follow-up cut
module.exports = {
  locateProject,
  feedbackDialogHtml,
  // For scripts/verify-brand.js: where brand text enters the page
  siteTextHtml,
  buildPageChrome,
  escapeBrandText,
  // For scripts/verify-media-shortcodes.js
  expandImageShortcodes,
  expandMediaShortcodes,
};
