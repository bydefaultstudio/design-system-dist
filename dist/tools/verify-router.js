#!/usr/bin/env node
/**
 * verify-router.js — the router check for any docs-kit site
 *
 * Run from a site's root (or pass it):  npx bd-verify-router [site-root]
 * In this repo:                         node tools/verify-router.js
 *
 * Every site runs the kit's router (barba-docs.js, engine parity C3), which
 * names no module: each script has to survive a page swap on its own. Four
 * failure modes are silent, the page renders, the console stays clean and a
 * component simply does nothing, so this proves them against source:
 *
 *   1. Every script the site ships has a declared strategy, in the kit's
 *      ledger (cms/generator/router-ledger.js, engine scripts by file name)
 *      or the site's (cms/router-ledger.js, its own scripts by path).
 *   2. Each declared strategy is true of the script's source.
 *   3. Every init the router calls by name is defined somewhere.
 *   4. Every page carrying a Barba container loads the full script set and
 *      the kit's router, and no page loads a router of its own. Head scripts
 *      are never synced across a navigation, so a module missing from the
 *      page a reader started on is never loaded at all.
 *
 * And, for the kit itself: the generator's transition names match the
 * router's library, so a `transitions` choice the build accepts always
 * exists in the browser.
 *
 * Out of scope: inline <script> blocks inside a container. Those re-run on
 * every arrival (reExecuteContainerScripts) and are audited by hand.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Where things are ──

// The site: an explicit argument, or the first directory upward from cwd
// holding docs/ or cms/docs.config.js (the generator's own rule).
function locateSite(arg) {
  if (arg) return path.resolve(arg);
  let dir = process.cwd();
  for (;;) {
    for (const candidate of ['docs', 'cms']) {
      if (fs.existsSync(path.join(dir, candidate, 'docs.config.js'))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      console.error(`bd-verify-router: no docs/docs.config.js or cms/docs.config.js from ${process.cwd()} upward.`);
      process.exit(1);
    }
    dir = parent;
  }
}

// The kit: dist/docs-kit beside dist/tools in the package, cms/generator in
// this repo.
function locateKit() {
  const packaged = path.join(__dirname, '..', 'docs-kit');
  if (fs.existsSync(path.join(packaged, 'generate-docs.js'))) return packaged;
  return path.join(__dirname, '..', 'cms', 'generator');
}

const SITE = locateSite(process.argv[2]);
const KIT = locateKit();
const CONTENT_DIR = fs.existsSync(path.join(SITE, 'docs', 'docs.config.js')) ? path.join(SITE, 'docs') : path.join(SITE, 'cms');
const config = require(path.join(CONTENT_DIR, 'docs.config.js'));
const KIT_LEDGER = require(path.join(KIT, 'router-ledger.js'));
const SITE_LEDGER_FILE = path.join(CONTENT_DIR, 'router-ledger.js');
const SITE_LEDGER = fs.existsSync(SITE_LEDGER_FILE) ? require(SITE_LEDGER_FILE) : {};
const MANIFEST = require(path.join(KIT, 'component-modules.json'));
const ROUTER = path.join(KIT, 'assets', 'js', 'barba-docs.js');
const ROUTER_TAGS = ['assets/docs-kit/vendor/barba.min.js', 'assets/docs-kit/barba-docs.js'];

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
}

// ── What the site ships ──

const fileName = (src) => path.basename(String(src).split(/[?#]/)[0]);

// The generator writes nav.js itself; it ships on every page.
const HARDCODED_SCRIPTS = ['assets/js/nav.js'];

// uiScripts unset is the kit's set, served from assets/docs-kit/ (less any
// file the site lists itself, as the generator does).
function uiScripts() {
  if (Array.isArray(config.uiScripts)) return config.uiScripts;
  const own = new Set((config.extraScripts || []).map((s) => fileName(s).toLowerCase()));
  const searchOn = config.search === undefined ? !!config.install : config.search === true;
  return MANIFEST.kitUiScripts
    .filter((f) => !own.has(f.toLowerCase()))
    .filter((f) => f !== 'search.js' || searchOn)
    .map((f) => `assets/docs-kit/${f}`);
}

function feedbackScripts() {
  if (!config.feedback) return [];
  return [config.feedbackScript || 'assets/docs-kit/feedback.js'];
}

function glossaryScripts() {
  const on = config.glossaryDrawer !== false && fs.existsSync(path.join(CONTENT_DIR, 'glossary'));
  return on ? ['assets/docs-kit/glossary.js', 'assets/docs-kit/glossary-init.js'] : [];
}

// The installed apps (engine parity phase B), resolved by the module the
// generator uses: the brand's two generated files, then libraries and apps.
let appsDirs = null;
let appScriptsCache = null;
function appScripts() {
  if (appScriptsCache) return appScriptsCache;
  if (!config.install) return (appScriptsCache = []);
  const apps = require(path.join(KIT, 'apps.js'));
  const registry = apps.loadApps({ generatorDir: KIT, siteAppsDir: path.join(CONTENT_DIR, 'apps') });
  appsDirs = registry;
  const brandFile = path.join(SITE, config.brandManifest || path.join(path.basename(CONTENT_DIR), 'brand.json'));
  const brand = fs.existsSync(brandFile) ? JSON.parse(fs.readFileSync(brandFile, 'utf8')) : null;
  const engineHome = !!brand && brand.slug === require(path.join(KIT, 'brand.js')).ENGINE_HOME_SLUG;
  const resolved = apps.resolveInstall(registry, config.install, {
    engineHome, accessGate: !!config.accessGate, allowDraft: !!config.install.allowDraft,
  });
  if (resolved.errors.length) throw new Error(`the install list doesn't resolve: ${resolved.errors.join('; ')}`);
  const outputs = Object.assign({ themeConfig: 'assets/js/theme-config.js', logoManifest: 'assets/js/logo-manifest.js' }, config.brandOutputs || {});
  // The brand's two files are written by the build too
  appFiles = new Set([outputs.themeConfig, outputs.logoManifest, ...resolved.scripts]);
  appScriptsCache = [...(brand ? [outputs.themeConfig, outputs.logoManifest] : []), ...resolved.scripts];
  return appScriptsCache;
}

function shippedScripts() {
  return [...HARDCODED_SCRIPTS, ...uiScripts(), ...appScripts(), ...(config.extraScripts || []), ...feedbackScripts(), ...glossaryScripts()];
}

// A script's source: the site's copy, else the package's app files, else
// the kit's own assets. The generator copies the kit's files into a site at
// build time, so a site checked before its first build still reads them.
function sourcePath(src) {
  const own = path.join(SITE, src);
  // A script the site declares as its own must exist where it says, and is
  // never read from the kit. An engine file (a kit-ledger name) may be
  // absent before the build or bd-sync writes it, so its kit copy stands in.
  if (SITE_LEDGER[src] && !isAppFile(src)) return fs.existsSync(own) ? own : null;
  const candidates = [own];
  if (appsDirs && appsDirs.filesRoot) candidates.push(path.join(appsDirs.filesRoot, src));
  candidates.push(path.join(KIT, 'assets', 'js', fileName(src)));
  // From this repo the engine's files sit in the repo's own assets/js
  candidates.push(path.join(KIT, '..', '..', 'assets', 'js', fileName(src)));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let appFiles = new Set();
function isAppFile(src) {
  appScripts();
  return appFiles.has(src);
}

// A kit entry covers the engine's file wherever the site serves it. A site
// that keeps its own file under an engine name gives it a site entry, which
// wins, and its source is then read from the site only.
function ledgerEntry(src) {
  return SITE_LEDGER[src] || KIT_LEDGER[fileName(src)] || null;
}

// ── Check 1: the ledgers describe what ships ──

function checkLedgerCoverage(shipped) {
  const undeclared = shipped.filter((src) => !ledgerEntry(src));
  check(
    'every shipped script is declared in a ledger',
    undeclared.length === 0,
    `${undeclared.join(', ')} (engine scripts go in ${path.relative(SITE, path.join(KIT, 'router-ledger.js'))}, the site's own in ${path.relative(SITE, SITE_LEDGER_FILE)})`
  );

  // Only the site's ledger: the kit's lists every engine script, and a site
  // installs some of them.
  const stale = Object.keys(SITE_LEDGER).filter((src) => !shipped.includes(src));
  check('every entry in the site ledger is still shipped', stale.length === 0, stale.join(', '));
}

// ── Check 2: each declared strategy is true of the source ──

// Lifecycle events every module binds regardless of strategy. Counting them
// as proof of delegation would make the check unfalsifiable: a module that
// binds per-element listeners inside the container would pass on its
// DOMContentLoaded line alone, which is the exact failure this catches.
const LIFECYCLE_EVENTS = new Set([
  'DOMContentLoaded',
  'load',
  'bd:after-nav',
  'studio:after-nav',
  'bd:before-nav',
  'studio:before-nav',
  // Fired once per document (header-account.js, bd-animate.js, bd-intro.js)
  'bd:session',
  'bd:ready',
  'bd:intro-leaving',
  'bd:intro-complete',
]);

function provesDelegation(source) {
  for (const match of source.matchAll(/(?:document|window)\.addEventListener\(\s*["']([^"']+)["']/g)) {
    if (!LIFECYCLE_EVENTS.has(match[1])) return true;
  }
  return false;
}

// A registration, not a mention: the router contains the literal because it
// dispatches the event.
function provesSelfRegistration(source) {
  return /addEventListener\(\s*["']bd:after-nav["']/.test(source);
}

// The other half: bd:after-nav never fires on a hard load (Barba's once path
// runs no after hook), so a module that starts only there is dead until the
// first navigation.
function provesLoadStart(source) {
  return /addEventListener\(\s*["']DOMContentLoaded["']/.test(source)
    || /document\.readyState\s*[!=]==?/.test(source);
}

function provesRouterOption(source) {
  return /window\.bdBarbaOptions\s*=/.test(source) && /\.motion\s*=/.test(source);
}

function callsInit(source, name) {
  return new RegExp(`window\\.${name}\\s*\\(`).test(source);
}

function checkStrategies(shipped, routerSource) {
  for (const src of shipped) {
    const entry = ledgerEntry(src);
    if (!entry) continue;
    const file = sourcePath(src);
    if (!file) {
      check(`${src} — source found`, false, 'no file at the site path or in the kit');
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');

    for (const strategy of entry.strategies) {
      if (strategy === 'none') continue;
      if (strategy === 'delegated') {
        check(`${src} — delegates to document/window`, provesDelegation(source),
          'declared delegated but binds no document/window listener');
      } else if (strategy === 'self-registered') {
        check(`${src} — self-registers on bd:after-nav`, provesSelfRegistration(source),
          'declared self-registered but never listens for bd:after-nav: it will die after the first navigation (cms/js-code-structure.md)');
        check(`${src} — starts on a hard load too`, !!entry.hardLoad || provesLoadStart(source),
          'declared self-registered but never starts on DOMContentLoaded: bd:after-nav does not fire on a hard load, so it does nothing until the first navigation');
      } else if (strategy === 'central-list') {
        check(`${src} — window.${entry.init} is called by the router`, !!entry.init && callsInit(routerSource, entry.init),
          `declared central-list but the router never calls window.${entry.init}`);
      } else if (strategy === 'router-option') {
        check(`${src} — registers a router option`, provesRouterOption(source),
          'declared router-option but never sets window.bdBarbaOptions.motion');
      } else {
        check(`${src} — known strategy`, false, `"${strategy}" is not a strategy`);
      }
    }
  }
}

// ── Check 2b: declared load order ──

function checkLoadOrder(shipped) {
  const position = new Map();
  shipped.forEach((src, i) => { if (!position.has(fileName(src))) position.set(fileName(src), i); });
  for (const src of shipped) {
    const entry = ledgerEntry(src);
    if (!entry || !Array.isArray(entry.loadsAfter)) continue;
    for (const first of entry.loadsAfter) {
      if (!position.has(first)) continue;
      check(`${src} loads after ${first}`, position.get(first) < position.get(fileName(src)),
        `its bd:after-nav listener would run before ${first}'s; load ${first} first`);
    }
  }
}

// ── Check 3: every init the router calls exists ──

function checkNoPhantomCalls(shipped, routerSource) {
  const sources = [
    ...shipped.map(sourcePath).filter(Boolean),
    path.join(KIT, 'template.html'),
    // nav.js is written by the generator, from strings in this file
    path.join(KIT, 'generate-docs.js'),
  ];
  const defined = new Set();
  for (const file of sources) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/window\.([A-Za-z0-9_$]+)\s*=(?!=)/g)) {
      defined.add(match[1]);
    }
  }
  const phantoms = new Set();
  for (const match of routerSource.matchAll(/window\.((?:bd|init|refresh)[A-Za-z0-9_$]*)\s*\(/g)) {
    if (!defined.has(match[1])) phantoms.add(match[1]);
  }
  check('the router calls no undefined globals', phantoms.size === 0,
    [...phantoms].map((n) => `window.${n}`).join(', '));
}

// ── Check 4: every Barba page loads the full set, and one router ──

// experiments/ is scratch (never deployed), the content folder holds the
// sources, and the rest is not the site's pages.
const SKIP_DIRS = new Set(['node_modules', '_site', 'dist', 'experiments', path.basename(CONTENT_DIR)]);

function htmlFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, found);
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

// A src as the site path it points at: ../../assets/js/x.js, /assets/js/x.js
// and assets/js/x.js are the same file.
function normaliseSrc(src) {
  return src.split(/[?#]/)[0].replace(/^(?:\.\.\/|\.\/)+/, '').replace(/^\//, '');
}

function checkScriptParity() {
  const required = [...HARDCODED_SCRIPTS, ...uiScripts(), ...appScripts(), ...(config.extraScripts || []),
    ...feedbackScripts(), ...glossaryScripts(), ...ROUTER_TAGS]
    .filter((src) => !/^https?:/.test(src))
    .map(normaliseSrc);
  const outputDir = config.outputDir ? path.join(SITE, config.outputDir) : SITE;
  const root = fs.existsSync(outputDir) ? outputDir : SITE;

  const drifted = [];
  const misplaced = [];
  const ownRouter = [];
  let scanned = 0;

  for (const file of htmlFiles(root).sort()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-barba="container"')) continue;
    scanned++;
    const page = path.relative(SITE, file);
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => normaliseSrc(m[1]));
    const loaded = new Set(srcs);

    const missing = required.filter((src) => !loaded.has(src));
    if (missing.length) drifted.push(`${page} -> ${missing.join(', ')}`);

    // A second router (a site's own, or the retired barba-init.js) would
    // intercept every click twice.
    const routers = srcs.filter((src) => /barba/i.test(src) && !ROUTER_TAGS.includes(src));
    if (routers.length) ownRouter.push(`${page} -> ${routers.join(', ')}`);

    // A module tag inside the container is re-executed on every arrival,
    // stacking one more bd:after-nav listener each time.
    const close = html.search(/<!-- *\/\[?data-barba="container"\]? *-->/);
    if (close === -1) {
      misplaced.push(`${page} -> no container close marker to check against`);
      continue;
    }
    // The container's opening tag, not the first mention of the attribute
    // (inline CSS or a script may name it too)
    const opening = html.match(/<[a-z][^>]*\sdata-barba="container"/i);
    if (!opening || opening.index > close) {
      misplaced.push(`${page} -> no container opening tag before its close marker`);
      continue;
    }
    const inside = [...html.slice(opening.index, close).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
      .map((m) => normaliseSrc(m[1]))
      .filter((src) => required.includes(src));
    if (inside.length) misplaced.push(`${page} -> ${inside.join(', ')} loaded inside the container`);
  }

  check(`all ${scanned} Barba pages load the full script set and the router`, drifted.length === 0,
    drifted.length ? `\n     ${drifted.join('\n     ')}` : '');
  check('no page loads a router of its own', ownRouter.length === 0,
    ownRouter.length ? `\n     ${ownRouter.join('\n     ')}` : '');
  check('no module is loaded inside a Barba container', misplaced.length === 0,
    misplaced.length ? `\n     ${misplaced.join('\n     ')}` : '');
}

// ── The kit: the generator's transition names are the router's ──

function checkTransitionLibrary(routerSource) {
  const generator = fs.readFileSync(path.join(KIT, 'generate-docs.js'), 'utf8');
  const namesMatch = generator.match(/const TRANSITION_NAMES = \[([^\]]*)\]/);
  const defaultsMatch = generator.match(/const TRANSITION_DEFAULTS = \{([^}]*)\}/);
  const libraryMatch = routerSource.match(/var TRANSITIONS = \{([\s\S]*?)\n  \};/);
  const mapMatch = routerSource.match(/var TRANSITION_MAP = \{([^}]*)\}/);
  if (!namesMatch || !defaultsMatch || !libraryMatch || !mapMatch) {
    check('the transition library is readable', false, 'TRANSITION_NAMES/TRANSITION_DEFAULTS (generate-docs.js) or TRANSITIONS/TRANSITION_MAP (barba-docs.js) not found');
    return;
  }
  const quoted = (text) => [...text.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  const pairs = (text) => [...text.matchAll(/'?([a-z-]+)'?\s*:\s*'([a-z-]+)'/g)].map((m) => `${m[1]}=${m[2]}`).sort().join(' ');
  const names = quoted(namesMatch[1]).sort().join(' ');
  const library = [...libraryMatch[1].matchAll(/^ {4}'([a-z-]+)': \{/gm)].map((m) => m[1]).sort().join(' ');
  check('the generator\'s transition names are the router\'s library', names === library,
    `generator: ${names}; router: ${library}`);
  check('the generator\'s defaults are the router\'s map', pairs(defaultsMatch[1]) === pairs(mapMatch[1]),
    `generator: ${pairs(defaultsMatch[1])}; router: ${pairs(mapMatch[1])}`);
}

// ── Run ──

function run() {
  if (!fs.existsSync(ROUTER)) {
    console.error(`bd-verify-router: the kit's router is missing at ${ROUTER}. Reinstall the package.`);
    process.exit(1);
  }
  const routerSource = fs.readFileSync(ROUTER, 'utf8');
  const shipped = shippedScripts();

  if (config.pageTransitions !== undefined) {
    check('docs.config.js has no pageTransitions', false, 'every site runs the kit router now: delete the key');
  }

  checkLedgerCoverage(shipped);
  checkStrategies(shipped, routerSource);
  checkLoadOrder(shipped);
  checkNoPhantomCalls(shipped, routerSource);
  checkScriptParity();
  checkTransitionLibrary(routerSource);

  let failed = 0;
  for (const result of results) {
    if (!result.passed) failed++;
    const detail = !result.passed && result.detail ? `  — ${result.detail}` : '';
    console.log(`${result.passed ? '✓' : '✗'}  ${result.name}${detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} router checks passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
